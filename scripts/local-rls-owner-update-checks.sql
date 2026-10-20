-- Fixture: property 2 is OWNED by consultant 2 but CREATED by telegram 333 (consultant 3).
update properties set owner_user_id = 2 where id = 2;
set role authenticated;

create or replace function pg_temp.try_update(p_uid text, p_tg text, p_sql text) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('app.uid', p_uid, false); perform set_config('app.tg', p_tg, false); perform set_config('app.is_admin','off',false);
  execute p_sql;
  get diagnostics n = row_count;
  return 'rows=' || n;
exception when insufficient_privilege or others then
  return 'ERROR: ' || sqlerrm;
end $$;

select 'OWNER-NOT-CREATOR update' as case, pg_temp.try_update('2','222', 'update properties set description = ''x'' where id = 2') as result;
select 'NON-OWNER NON-CREATOR (uid1/tg111; owner=2, creator=333) update (must be error)' as case, pg_temp.try_update('1','111', 'update properties set address = ''x'' where id = 2') as result;
select 'CREATOR update (own record)' as case, pg_temp.try_update('2','222', 'update properties set description = ''y'' where id = 1') as result;
