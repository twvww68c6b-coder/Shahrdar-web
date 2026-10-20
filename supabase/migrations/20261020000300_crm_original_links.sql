-- NOT APPLIED. Adds nullable "original link" columns and updates the delete path to keep the
-- previous id before detaching it to 0. Additive: existing rows and ORM/bot queries are unaffected.
alter table public.activities
  add column if not exists original_property_id integer,
  add column if not exists original_client_id integer;
alter table public.visits
  add column if not exists original_property_id integer,
  add column if not exists original_client_id integer;
alter table public.status_events
  add column if not exists original_property_id integer;

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
