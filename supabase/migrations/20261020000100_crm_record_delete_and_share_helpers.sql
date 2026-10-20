-- NOT APPLIED YET. Reviewed and pending approval; apply only after the rehearsal in the PR notes passes.
create or replace function public.crm_can_manage_record(p_kind text, p_id integer)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare ok boolean := false;
begin
  if p_kind = 'property' then
    select (public.crm_is_admin() or p.owner_user_id = public.current_crm_user_id() or p.created_by = public.current_crm_telegram_id())
      into ok from public.properties p where p.id = p_id;
  elsif p_kind = 'client' then
    select (public.crm_is_admin() or c.owner_user_id = public.current_crm_user_id() or c.created_by = public.current_crm_telegram_id())
      into ok from public.clients c where c.id = p_id;
  end if;
  return coalesce(ok, false);
end $$;

create or replace function public.crm_record_dependents(p_kind text, p_id integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.crm_can_manage_record(p_kind, p_id) then raise exception 'not_allowed'; end if;
  if p_kind = 'property' then
    return jsonb_build_object(
      'photos', (select count(*) from property_photos where property_id = p_id),
      'videos', (select count(*) from property_videos where property_id = p_id),
      'ads', (select count(*) from property_ads where property_id = p_id),
      'activities', (select count(*) from activities where property_id = p_id),
      'visits', (select count(*) from visits where property_id = p_id),
      'status_events', (select count(*) from status_events where property_id = p_id));
  elsif p_kind = 'client' then
    return jsonb_build_object(
      'activities', (select count(*) from activities where client_id = p_id),
      'visits', (select count(*) from visits where client_id = p_id));
  end if;
  raise exception 'bad_kind';
end $$;

-- Deletes the record and its own media/ads/videos. Activities, visits and status history are kept
-- and detached with the bot's "no link" value 0. Open follow-ups for the record are cancelled.
create or replace function public.crm_delete_record(p_kind text, p_id integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.crm_can_manage_record(p_kind, p_id) then raise exception 'not_allowed'; end if;
  res := public.crm_record_dependents(p_kind, p_id);
  if p_kind = 'property' then
    update activities set status = 'لغو' where activity_type = 'پیگیری' and property_id = p_id and coalesce(status, 'باز') = 'باز';
    delete from property_photos where property_id = p_id;
    delete from property_videos where property_id = p_id;
    delete from property_ads where property_id = p_id;
    update activities set property_id = 0 where property_id = p_id;
    update visits set property_id = 0 where property_id = p_id;
    update status_events set property_id = 0 where property_id = p_id;
    delete from properties where id = p_id;
  elsif p_kind = 'client' then
    update activities set status = 'لغو' where activity_type = 'پیگیری' and client_id = p_id and coalesce(status, 'باز') = 'باز';
    update activities set client_id = 0 where client_id = p_id;
    update visits set client_id = 0 where client_id = p_id;
    delete from clients where id = p_id;
  else
    raise exception 'bad_kind';
  end if;
  return res;
end $$;

revoke all on function public.crm_can_manage_record(text, integer) from public, anon;
revoke all on function public.crm_record_dependents(text, integer) from public, anon;
revoke all on function public.crm_delete_record(text, integer) from public, anon;
grant execute on function public.crm_can_manage_record(text, integer) to authenticated;
grant execute on function public.crm_record_dependents(text, integer) to authenticated;
grant execute on function public.crm_delete_record(text, integer) to authenticated;
