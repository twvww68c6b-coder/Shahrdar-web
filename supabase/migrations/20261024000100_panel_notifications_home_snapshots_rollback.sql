-- ROLLBACK (do not run unless the owner asks). Removes only the objects created by 20261024000100.
drop trigger if exists clients_notify_urgent on public.clients;
drop trigger if exists properties_notify_urgent on public.properties;
drop function if exists public.notify_urgent_client();
drop function if exists public.notify_urgent_property();
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'panel_notifications') then
    alter publication supabase_realtime drop table public.panel_notifications;
  end if;
end $$;
drop table if exists public.home_stat_snapshots;
drop table if exists public.panel_notifications;
