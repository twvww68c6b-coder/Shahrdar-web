-- Panel notifications (bell) and per-user daily snapshots for home growth indicators.
-- Additive only: creates two new tables, RLS policies, trigger functions and triggers.
-- No existing row is read back, updated, or deleted. Triggers fire only on future changes to is_urgent.

-- 1) Notifications: one row per recipient per event (unique event_key prevents duplicates).
create table if not exists public.panel_notifications (
  id bigint generated always as identity primary key,
  recipient_user_id integer not null references public.users(id),
  created_by_user_id integer references public.users(id),
  kind text not null,
  title text not null,
  body text not null default '',
  entity_kind text,
  entity_id integer,
  event_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint panel_notifications_event_unique unique (recipient_user_id, event_key)
);
create index if not exists panel_notifications_recipient_created_idx
  on public.panel_notifications (recipient_user_id, created_at desc);

alter table public.panel_notifications enable row level security;

drop policy if exists panel_notifications_select_own on public.panel_notifications;
create policy panel_notifications_select_own on public.panel_notifications
  for select to authenticated
  using (recipient_user_id = public.current_crm_user_id());

drop policy if exists panel_notifications_update_own on public.panel_notifications;
create policy panel_notifications_update_own on public.panel_notifications
  for update to authenticated
  using (recipient_user_id = public.current_crm_user_id())
  with check (recipient_user_id = public.current_crm_user_id());

-- Users may create share notifications only as themselves and only for another user.
drop policy if exists panel_notifications_insert_share on public.panel_notifications;
create policy panel_notifications_insert_share on public.panel_notifications
  for insert to authenticated
  with check (
    kind in ('share_file', 'share_client')
    and created_by_user_id = public.current_crm_user_id()
    and recipient_user_id <> created_by_user_id
  );

revoke all on public.panel_notifications from anon, authenticated;
grant select on public.panel_notifications to authenticated;
grant insert (recipient_user_id, created_by_user_id, kind, title, body, entity_kind, entity_id, event_key)
  on public.panel_notifications to authenticated;
grant update (read_at) on public.panel_notifications to authenticated;

-- 2) Urgent events create notifications for the record's owner and follow-up consultant.
--    Two functions (one per table) so each only references its own columns.
create or replace function public.notify_urgent_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid integer;
  ev text;
begin
  if new.is_urgent = 1 and (tg_op = 'INSERT' or coalesce(old.is_urgent, 0) <> 1) then
    ev := 'urgent:client:' || new.id || ':' || extract(epoch from coalesce(new.urgent_at, now()))::bigint;
    for rid in
      select distinct x from (values (new.owner_user_id), (new.follow_up_user_id)) v(x) where x is not null
    loop
      insert into public.panel_notifications
        (recipient_user_id, kind, title, body, entity_kind, entity_id, event_key)
      values (rid, 'urgent_client', 'مشتری فوری',
              coalesce(new.name, 'مشتری') || ' — ' || coalesce(new.area, ''),
              'client', new.id, ev)
      on conflict (recipient_user_id, event_key) do nothing;
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.notify_urgent_property()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rid integer;
  ev text;
begin
  if new.is_urgent = 1 and (tg_op = 'INSERT' or coalesce(old.is_urgent, 0) <> 1) then
    ev := 'urgent:property:' || new.id || ':' || extract(epoch from coalesce(new.urgent_at, now()))::bigint;
    for rid in
      select distinct x from (values (new.owner_user_id), (new.follow_up_user_id)) v(x) where x is not null
    loop
      insert into public.panel_notifications
        (recipient_user_id, kind, title, body, entity_kind, entity_id, event_key)
      values (rid, 'urgent_file', 'فایل فوری',
              coalesce(new.code, 'فایل') || ' — ' || coalesce(new.area, ''),
              'property', new.id, ev)
      on conflict (recipient_user_id, event_key) do nothing;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_notify_urgent on public.clients;
create trigger clients_notify_urgent
  after insert or update of is_urgent on public.clients
  for each row execute function public.notify_urgent_client();

drop trigger if exists properties_notify_urgent on public.properties;
create trigger properties_notify_urgent
  after insert or update of is_urgent on public.properties
  for each row execute function public.notify_urgent_property();

-- Realtime: panel subscribes to inserts; RLS still limits each user to their own rows.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'panel_notifications'
  ) then
    alter publication supabase_realtime add table public.panel_notifications;
  end if;
end $$;

-- 3) Daily snapshot per consultant, taken by the panel the first time it loads home on a day.
create table if not exists public.home_stat_snapshots (
  user_id integer not null references public.users(id),
  snap_date date not null,
  clients_total integer not null,
  active_files integer not null,
  urgent_files integer not null,
  followups_today integer not null,
  contracts integer not null,
  taken_at timestamptz not null default now(),
  primary key (user_id, snap_date)
);

alter table public.home_stat_snapshots enable row level security;

drop policy if exists home_stat_snapshots_select_own on public.home_stat_snapshots;
create policy home_stat_snapshots_select_own on public.home_stat_snapshots
  for select to authenticated
  using (user_id = public.current_crm_user_id());

drop policy if exists home_stat_snapshots_insert_own on public.home_stat_snapshots;
create policy home_stat_snapshots_insert_own on public.home_stat_snapshots
  for insert to authenticated
  with check (user_id = public.current_crm_user_id());

revoke all on public.home_stat_snapshots from anon, authenticated;
grant select, insert on public.home_stat_snapshots to authenticated;
