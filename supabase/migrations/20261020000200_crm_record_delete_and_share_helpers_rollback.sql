-- ROLLBACK for 20261020000100. NOT APPLIED.
-- Removes the functions and their grants only. It does NOT restore deleted rows or
-- activity/visit/status links that were detached to 0; those need a backup restore.
revoke execute on function public.crm_delete_record(text, integer) from authenticated;
revoke execute on function public.crm_record_dependents(text, integer) from authenticated;
revoke execute on function public.crm_can_manage_record(text, integer) from authenticated;
drop function if exists public.crm_delete_record(text, integer);
drop function if exists public.crm_record_dependents(text, integer);
drop function if exists public.crm_can_manage_record(text, integer);
