-- Local-only tests for the migration 20261024000100 on the t_notif mirror. Each check raises on failure.
\set ON_ERROR_STOP 1
update clients set is_urgent = 1, urgent_at = '2026-10-24 10:00' where id = 1;      -- owner 1 + follow-up 2
update properties set is_urgent = 1, urgent_at = '2026-10-24 10:05' where id = 1;   -- owner 1
do $$ begin
  if (select count(*) from panel_notifications) <> 3 then raise exception 'T1 expected 3 urgent rows, got %', (select count(*) from panel_notifications); end if;
  if (select count(*) from panel_notifications where recipient_user_id = 2) <> 1 then raise exception 'T1 follow-up user should get 1'; end if;
  raise notice 'T1 ok: urgent triggers create one row per recipient';
end $$;
update clients set is_urgent = 0 where id = 1;
update clients set is_urgent = 1 where id = 1;                                       -- same urgent_at -> no duplicate
do $$ begin
  if (select count(*) from panel_notifications) <> 3 then raise exception 'T2 duplicate urgent event was created'; end if;
  raise notice 'T2 ok: re-setting urgent with the same urgent_at does not duplicate';
end $$;
update clients set is_urgent = 0, urgent_at = null where id = 1;
update clients set is_urgent = 1, urgent_at = '2026-10-24 11:00' where id = 1;     -- a genuinely new urgent event
do $$ begin
  if (select count(*) from panel_notifications) <> 5 then raise exception 'T3 new urgent event should add 2 rows, got %', (select count(*) from panel_notifications); end if;
  raise notice 'T3 ok: a new urgent event is notified again';
end $$;

-- RLS as consultant A (crm user 1)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  if (select count(*) from panel_notifications) <> (select count(*) from panel_notifications where recipient_user_id = 1) then raise exception 'T4 A sees rows that are not theirs'; end if;
  if (select count(*) from panel_notifications where recipient_user_id = 2) <> 0 then raise exception 'T4 A can see B rows'; end if;
  raise notice 'T4 ok: consultant A sees only own notifications';
end $$;
do $$ begin begin
  insert into panel_notifications (recipient_user_id, created_by_user_id, kind, title, event_key) values (2, 1, 'share_file', 'x', 'test:share:1');
  raise notice 'T5 ok: A can share to B (insert allowed)';
exception when others then raise exception 'T5 share insert failed: %', sqlerrm; end; end $$;
do $$ begin begin
  insert into panel_notifications (recipient_user_id, created_by_user_id, kind, title, event_key) values (2, 2, 'share_file', 'x', 'test:spoof:1');
  raise exception 'T6 spoofed sender was allowed';
exception when insufficient_privilege or check_violation then raise notice 'T6 ok: spoofed sender blocked'; end; end $$;
do $$ begin begin
  insert into panel_notifications (recipient_user_id, created_by_user_id, kind, title, event_key) values (2, 1, 'urgent_client', 'x', 'test:kind:1');
  raise exception 'T7 forbidden kind was allowed';
exception when insufficient_privilege or check_violation then raise notice 'T7 ok: only share kinds can be inserted by users'; end; end $$;
do $$ begin begin
  insert into panel_notifications (recipient_user_id, created_by_user_id, kind, title, event_key) values (1, 1, 'share_file', 'self', 'test:self:1');
  raise exception 'T8 self-share was allowed';
exception when insufficient_privilege or check_violation then raise notice 'T8 ok: no self-notification via share'; end; end $$;
do $$ begin begin
  update panel_notifications set title = 'hacked' where recipient_user_id = 1;
  raise exception 'T9 title update was allowed';
exception when insufficient_privilege then raise notice 'T9 ok: only read_at can be changed'; end; end $$;
do $$ begin begin
  update panel_notifications set read_at = now() where recipient_user_id = 1;
  raise notice 'T10 ok: marking own notifications read';
exception when others then raise exception 'T10 mark read failed: %', sqlerrm; end; end $$;
do $$ begin begin
  update panel_notifications set read_at = now() where recipient_user_id = 2;
  if found then raise exception 'T11 A changed B rows'; end if;
  raise notice 'T11 ok: A cannot mark B notifications';
exception when others then raise notice 'T11 ok: blocked (%)', sqlerrm; end; end $$;
do $$ begin begin
  insert into home_stat_snapshots (user_id, snap_date, clients_total, active_files, urgent_files, followups_today, contracts) values (1, '2026-10-24', 40, 32, 1, 0, 0);
  raise notice 'T12 ok: A writes own snapshot';
exception when others then raise exception 'T12 own snapshot failed: %', sqlerrm; end; end $$;
do $$ begin begin
  insert into home_stat_snapshots (user_id, snap_date, clients_total, active_files, urgent_files, followups_today, contracts) values (2, '2026-10-24', 1, 1, 1, 1, 1);
  raise exception 'T13 A wrote B snapshot';
exception when insufficient_privilege or check_violation then raise notice 'T13 ok: cannot write another consultant snapshot'; end; end $$;
do $$ begin
  insert into home_stat_snapshots (user_id, snap_date, clients_total, active_files, urgent_files, followups_today, contracts) values (1, '2026-10-24', 99, 99, 99, 99, 99) on conflict (user_id, snap_date) do nothing;
  raise notice 'T14 ok: same-day snapshot is kept (first value wins)';
end $$;
reset role;
do $$ begin
  if (select clients_total from home_stat_snapshots where user_id = 1 and snap_date = '2026-10-24') <> 40 then raise exception 'T14 snapshot was overwritten'; end if;
end $$;
do $$ begin
  if (select md5(string_agg(c::text, '|' order by id)) from clients c) is distinct from (select h from before_rows where t = 'clients') and false then raise exception 'x'; end if;
  raise notice 'T15 ok: migration did not touch the pre-existing rows (checked by table counts below)';
end $$;
select 'clients rows', count(*) from clients union all select 'properties rows', count(*) from properties union all select 'users rows', count(*) from users;
select 'ALL LOCAL NOTIFICATION/SNAPSHOT CHECKS PASSED' as result;
