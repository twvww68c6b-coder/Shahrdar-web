-- Local-only test (never run on production). Builds a tiny mirror of the parts the migration touches.
drop database if exists t_notif;
create database t_notif;
\connect t_notif
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table users (id integer generated always as identity primary key, telegram_id bigint, name text, role text, created_at timestamp default now());
create table web_user_access (id bigint generated always as identity primary key, auth_user_id uuid unique references auth.users(id), crm_user_id integer unique references users(id), enabled boolean default true, username text);
create table clients (id integer generated always as identity primary key, name text, area text, owner_user_id integer, follow_up_user_id integer, is_urgent integer default 0, urgent_at timestamp, created_by bigint, created_at timestamp default now());
create table properties (id integer generated always as identity primary key, code text, area text, owner_user_id integer, follow_up_user_id integer, is_urgent integer default 0, urgent_at timestamp, created_by bigint, created_at timestamp default now());
create function current_crm_user_id() returns integer language sql stable security definer as $$
  select u.id from web_user_access a join users u on u.id = a.crm_user_id where a.auth_user_id = auth.uid() and a.enabled = true limit 1 $$;
do $$ begin if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if; end $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function current_crm_user_id() to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
insert into users (telegram_id, name, role) values (1001, 'مشاور الف', 'مشاور'), (1002, 'مشاور ب', 'مشاور'), (1003, 'مدیر', 'مدیر');
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
insert into web_user_access (auth_user_id, crm_user_id, username) values
  ('00000000-0000-0000-0000-00000000000a', 1, 'alef'), ('00000000-0000-0000-0000-00000000000b', 2, 'bb');
insert into clients (name, area, owner_user_id, follow_up_user_id) values ('مشتری یک', 'شهرک شریعتی', 1, 2), ('مشتری دو', 'شهرک بستان شمالی', 2, null);
insert into properties (code, area, owner_user_id) values ('P-1', 'خانی‌آباد نو شمالی', 1);
-- Existing rows snapshot (must be identical after the migration).
create table before_rows as select 'clients' t, md5(string_agg(c::text, '|' order by id)) h from clients c;
insert into before_rows select 'properties', md5(string_agg(p::text, '|' order by id)) from properties p;
