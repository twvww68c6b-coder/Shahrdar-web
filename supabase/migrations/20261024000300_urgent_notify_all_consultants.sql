-- Urgent events notify every active consultant and manager with panel web access,
-- plus the record's owner and follow-up (kept so nobody linked to the record is missed).
-- Only the two trigger functions are replaced. No table, policy, or existing row is changed.
-- Duplicate protection is unchanged: unique (recipient_user_id, event_key).

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
      select distinct r.id from (
        select u.id from public.users u
          where u.role in ('مشاور', 'مدیر')
            and exists (select 1 from public.web_user_access w where w.crm_user_id = u.id and w.enabled)
        union
        select x from (values (new.owner_user_id), (new.follow_up_user_id)) v(x) where x is not null
      ) r
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
      select distinct r.id from (
        select u.id from public.users u
          where u.role in ('مشاور', 'مدیر')
            and exists (select 1 from public.web_user_access w where w.crm_user_id = u.id and w.enabled)
        union
        select x from (values (new.owner_user_id), (new.follow_up_user_id)) v(x) where x is not null
      ) r
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

revoke execute on function public.notify_urgent_client(), public.notify_urgent_property() from public, anon, authenticated;
