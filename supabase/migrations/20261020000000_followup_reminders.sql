-- Follow-up reminders: additive columns, indexes, policies, RPCs, and cron scheduler.
-- The cron secret value is NOT in this file: create it once in Supabase Vault:
--   select vault.create_secret('<long random value>', 'followup_cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.activities
  add column if not exists due_at timestamptz,
  add column if not exists status text,
  add column if not exists completed_at timestamptz,
  add column if not exists responsible_user_id integer,
  add column if not exists reminder_status text,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists reminder_error text,
  add column if not exists reminder_attempts integer not null default 0,
  add column if not exists reminder_next_try timestamptz;

create index if not exists activities_followup_due_idx
  on public.activities (due_at) where activity_type = 'پیگیری';
create index if not exists activities_responsible_idx
  on public.activities (responsible_user_id);

drop policy if exists activities_select_responsible on public.activities;
create policy activities_select_responsible on public.activities for select to authenticated
  using (responsible_user_id is not null and responsible_user_id = public.current_crm_user_id());

drop policy if exists activities_update_responsible on public.activities;
create policy activities_update_responsible on public.activities for update to authenticated
  using (responsible_user_id = public.current_crm_user_id())
  with check (responsible_user_id = public.current_crm_user_id());

create or replace function public.followup_cron_secret()
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret::text from vault.decrypted_secrets where name = 'followup_cron_secret' limit 1;
$$;

create or replace function public.claim_due_followups(p_limit integer default 50)
returns table(id integer, client_name text, property_code text, note text, due_at timestamptz,
              telegram_id bigint, responsible_name text, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select a.id from public.activities a
    where a.activity_type = 'پیگیری'
      and a.due_at is not null and a.due_at <= now()
      and coalesce(a.status, 'باز') = 'باز'
      and (
        a.reminder_status is null
        or (a.reminder_status = 'error' and a.reminder_attempts < 3 and coalesce(a.reminder_next_try, now()) <= now())
        or (a.reminder_status = 'sending' and a.reminder_attempts < 3 and a.reminder_next_try <= now())
      )
    order by a.due_at asc
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ),
  claimed as (
    update public.activities a
       set reminder_status = 'sending',
           reminder_attempts = a.reminder_attempts + 1,
           reminder_next_try = now() + interval '5 minutes'
      from due d where a.id = d.id
    returning a.*
  )
  select c.id, cl.name::text, pr.code::text, c.note, c.due_at, u.telegram_id::bigint, u.name::text, c.reminder_attempts
  from claimed c
  left join public.clients cl on cl.id = c.client_id
  left join public.properties pr on pr.id = c.property_id
  left join public.users u on u.id = c.responsible_user_id;
end $$;

create or replace function public.mark_followup_reminder(p_id integer, p_due timestamptz, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.activities set
    reminder_status = case when p_ok then 'sent' else 'error' end,
    reminder_sent_at = case when p_ok then now() else reminder_sent_at end,
    reminder_error = case when p_ok then null else left(coalesce(p_error, 'خطای ناشناخته'), 500) end,
    reminder_next_try = case when p_ok then null else now() + interval '2 minutes' end
  where id = p_id and due_at = p_due;
$$;

revoke all on function public.followup_cron_secret() from public, anon, authenticated;
revoke all on function public.claim_due_followups(integer) from public, anon, authenticated;
revoke all on function public.mark_followup_reminder(integer, timestamptz, boolean, text) from public, anon, authenticated;
grant execute on function public.followup_cron_secret() to service_role;
grant execute on function public.claim_due_followups(integer) to service_role;
grant execute on function public.mark_followup_reminder(integer, timestamptz, boolean, text) to service_role;

-- Scheduler: runs every minute inside Supabase, independent of the panel.
select cron.schedule('followup-reminders-every-minute', '* * * * *', $$
  select net.http_post(
    url := 'https://igunsreoursotuxqpyfs.supabase.co/functions/v1/followup-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.followup_cron_secret()),
    body := '{}'::jsonb
  );
$$);
