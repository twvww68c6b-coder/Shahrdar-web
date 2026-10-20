-- Local only. Copies the production policy shapes (from pg_policies) onto the test mirror.
alter table clients enable row level security;
alter table properties enable row level security;
grant select, insert, update, delete on all tables in schema public to authenticated;
create policy clients_update_own_or_admin on clients for update to authenticated using (crm_is_admin() or owner_user_id = current_crm_user_id() or created_by = current_crm_telegram_id())
  with check (crm_is_admin() or ((owner_user_id is null or owner_user_id = current_crm_user_id()) and created_by = current_crm_telegram_id()));
create policy properties_update_own_or_admin on properties for update to authenticated using (crm_is_admin() or owner_user_id = current_crm_user_id() or created_by = current_crm_telegram_id())
  with check (crm_is_admin() or ((owner_user_id is null or owner_user_id = current_crm_user_id()) and created_by = current_crm_telegram_id()));
create policy p_select on properties for select to authenticated using (current_crm_user_id() is not null);
create policy c_select on clients for select to authenticated using (current_crm_user_id() is not null);
