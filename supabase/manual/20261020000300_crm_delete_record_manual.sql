-- MANUAL STEP (run once in Supabase SQL Editor after reviewing). Depends on: helper functions crm_can_manage_record, crm_record_dependents (already installed) and the original_* columns (already installed).
-- Creates crm_delete_record. Deleting data happens ONLY when a permitted consultant confirms in the panel. Nothing runs at apply time.
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
    update activities set original_property_id = p_id, property_id = 0 where property_id = p_id;
    update visits set original_property_id = p_id, property_id = 0 where property_id = p_id;
    update status_events set original_property_id = p_id, property_id = 0 where property_id = p_id;
    delete from properties where id = p_id;
  elsif p_kind = 'client' then
    update activities set status = 'لغو' where activity_type = 'پیگیری' and client_id = p_id and coalesce(status, 'باز') = 'باز';
    update activities set original_client_id = p_id, client_id = 0 where client_id = p_id;
    update visits set original_client_id = p_id, client_id = 0 where client_id = p_id;
    delete from clients where id = p_id;
  else
    raise exception 'bad_kind';
  end if;
  return res;
end $$;

revoke all on function public.crm_delete_record(text, integer) from public, anon;
grant execute on function public.crm_delete_record(text, integer) to authenticated;
