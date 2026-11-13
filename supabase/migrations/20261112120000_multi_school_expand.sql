-- Multi-school -- the EXPAND step.
--
-- The app served one school with no school column anywhere. This adds the
-- tenancy tables, puts every existing row into "school #1", and makes a
-- cross-school link impossible in the database itself (composite keys), while
-- the OLD application code keeps running unchanged: it never sends a school
-- id, reads with the anon key, and calls the old RPC signatures. Every
-- allowance made for that old code is marked LEGACY below; a later contract
-- migration removes them (drops the school_id defaults, the anon policies and
-- the old RPC signatures).
--
-- Not touched here on purpose: reset_board_to_waiting, nightly_reset_board,
-- the pg_cron schedule, the realtime publication and replica identity. Later
-- phases own those.
--
-- Written for PostgreSQL 17 (the hosted version); nothing newer is used.

-- This takes short ACCESS EXCLUSIVE locks on the six data tables. If one of
-- them is busy (a long read, a class being removed), give up and roll back
-- rather than queue every /display read behind this migration. Apply it
-- outside pickup hours and away from the 8 PM reset. Session-level rather
-- than SET LOCAL so it holds whether or not the migration runner wraps the
-- file in a transaction; before retrying after a timeout, confirm the failed
-- run left nothing behind (no public.schools table).
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$'),
  timezone text not null default 'America/Los_Angeles',
  reset_hour smallint not null default 20 check (reset_hour between 0 and 23),
  -- Weekday numbers (0 = Sunday) of the evenings the nightly reset runs.
  reset_days smallint[] not null default '{0,1,2,3,4,5,6}'
    check (reset_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  last_reset_on date,
  voice_enabled boolean not null default false,
  -- null means no cap.
  voice_monthly_limit integer default 1000
    check (voice_monthly_limit is null or voice_monthly_limit >= 0),
  created_at timestamptz not null default now()
);

comment on table public.schools is
  'One row per school (tenant). Readable only by that school''s members and connected devices.';

-- School #1 is the school that already exists. Its id is fixed so the
-- constant column defaults below can name it. The name and slug are
-- PLACEHOLDERS: the owner renames them at rollout. Nightly reset keeps today's
-- behaviour: 8 PM Pacific, Sunday-Thursday evenings (not Friday or Saturday).
insert into public.schools
  (id, name, slug, timezone, reset_hour, reset_days, voice_enabled, voice_monthly_limit)
values
  ('00000000-0000-4000-8000-000000000001', 'My School', 'my-school',
   'America/Los_Angeles', 20, '{0,1,2,3,4}', true, null);

create table public.school_secrets (
  school_id uuid primary key references public.schools (id) on delete cascade,
  -- Device pairing codes. null = not set, so nothing can pair.
  announce_code text,
  display_code text,
  -- Bumped when a code changes; a device row remembers the version it paired
  -- with, so "change code and disconnect devices" is a comparison.
  announce_code_version integer not null default 1,
  display_code_version integer not null default 1,
  -- Wrong-code lockout. Blocks new pairings only, never connected devices.
  failed_attempts integer not null default 0,
  failed_window_started_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.school_secrets is
  'Device codes and lockout state. No client access at all: service role only.';

insert into public.school_secrets (school_id)
values ('00000000-0000-4000-8000-000000000001');

create table public.school_members (
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (school_id, user_id)
);

create index school_members_user_idx on public.school_members (user_id);

create table public.school_devices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  -- One row per device session (an anonymous Supabase user).
  user_id uuid not null unique references auth.users (id) on delete cascade,
  can_announce boolean not null default false,
  can_display boolean not null default false,
  announce_code_version integer,
  display_code_version integer,
  label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index school_devices_school_idx on public.school_devices (school_id);

create table public.school_usage (
  school_id uuid not null references public.schools (id) on delete cascade,
  -- First day of the month.
  month date not null,
  voice_sessions integer not null default 0 check (voice_sessions >= 0),
  primary key (school_id, month)
);

-- Same posture as the other tables: RLS on, everything revoked, then exactly
-- what is needed granted back (the policies further down open reads).
alter table public.schools enable row level security;
alter table public.school_secrets enable row level security;
alter table public.school_members enable row level security;
alter table public.school_devices enable row level security;
alter table public.school_usage enable row level security;

revoke all on public.schools from anon, authenticated;
revoke all on public.school_secrets from anon, authenticated;
revoke all on public.school_members from anon, authenticated;
revoke all on public.school_devices from anon, authenticated;
revoke all on public.school_usage from anon, authenticated;

grant select, insert, update, delete on public.schools to service_role;
grant select, insert, update, delete on public.school_secrets to service_role;
grant select, insert, update, delete on public.school_members to service_role;
grant select, insert, update, delete on public.school_devices to service_role;
grant select, insert, update, delete on public.school_usage to service_role;

-- ---------------------------------------------------------------------------
-- private.current_school_ids() -- the one definition of "my schools"
-- ---------------------------------------------------------------------------

-- The `private` schema is not in the API's exposed-schemas list, so nothing
-- here is reachable as RPC. Security definer so it can read school_members and
-- school_devices through their own RLS without recursing into policies. A
-- policy expression runs with the querying role's privileges, so
-- `authenticated` needs usage on the schema and execute on the function; anon
-- gets neither, which is how an anonymous visitor reads nothing.
create schema if not exists private;

create or replace function private.current_school_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.school_id from public.school_members m
   where m.user_id = (select auth.uid())
  union
  select d.school_id from public.school_devices d
   where d.user_id = (select auth.uid())
$$;

revoke all on schema private from public, anon;
revoke all on function private.current_school_ids() from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.current_school_ids() to authenticated, service_role;

-- A caller sees only its own membership / device row, and its own school.
grant select on public.schools to authenticated;
grant select on public.school_members to authenticated;
grant select on public.school_devices to authenticated;

create policy "members and devices read their own schools"
  on public.schools
  for select
  to authenticated
  using (id in (select private.current_school_ids()));

create policy "callers read their own membership"
  on public.school_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "callers read their own device row"
  on public.school_devices
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- school_id on the data tables
-- ---------------------------------------------------------------------------

-- LEGACY: the constant default is deliberate. Existing rows fill instantly,
-- and the old code's inserts (which never send a school id) keep landing in
-- school #1. The contract migration drops these defaults; new code must always
-- set school_id explicitly.
alter table public.students
  add column school_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.schools (id) on delete cascade;
alter table public.class_groups
  add column school_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.schools (id) on delete cascade;
alter table public.carpools
  add column school_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.schools (id) on delete cascade;
alter table public.status_events
  add column school_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.schools (id) on delete cascade;
alter table public.student_parents
  add column school_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.schools (id) on delete cascade;
alter table public.student_classes
  add column school_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.schools (id) on delete cascade;

-- Targets for the composite foreign keys. (school_id, id) is also the index
-- that serves "this school's rows".
alter table public.students
  add constraint students_school_id_id_key unique (school_id, id);
alter table public.class_groups
  add constraint class_groups_school_id_id_key unique (school_id, id);
alter table public.carpools
  add constraint carpools_school_id_id_key unique (school_id, id);

-- The tables that are only ever children need their own school_id index
-- (RLS filters on it; school deletes cascade through it).
create index status_events_school_idx on public.status_events (school_id);
create index student_parents_school_idx on public.student_parents (school_id);
create index student_classes_school_idx on public.student_classes (school_id);

-- ---------------------------------------------------------------------------
-- Composite foreign keys: a cross-school link is impossible
-- ---------------------------------------------------------------------------

-- Each swap is ONE statement (drop + add together). PostgREST embeds such as
-- students -> student_classes -> class_groups fail with an ambiguity error if
-- two relationships between the same pair of tables ever coexist, even for a
-- moment on a live database. The column-list form of SET NULL keeps today's
-- behaviour (a deleted student or carpool nulls only the id column, never
-- school_id, which is NOT NULL).
--
-- MATCH SIMPLE (the default) means a null carpool_id / student_id skips the
-- check, exactly as the old single-column keys did.
alter table public.students
  drop constraint students_carpool_id_fkey,
  add constraint students_carpool_fkey
    foreign key (school_id, carpool_id)
    references public.carpools (school_id, id)
    on delete set null (carpool_id);

alter table public.status_events
  drop constraint status_events_student_id_fkey,
  add constraint status_events_student_fkey
    foreign key (school_id, student_id)
    references public.students (school_id, id)
    on delete set null (student_id);

alter table public.status_events
  drop constraint status_events_carpool_id_fkey,
  add constraint status_events_carpool_fkey
    foreign key (school_id, carpool_id)
    references public.carpools (school_id, id)
    on delete set null (carpool_id);

-- student_parents is one row per student, and PostgREST only embeds a
-- relationship as a single object (rather than an array) when the foreign key
-- columns are EXACTLY a primary or unique key. The old key was (student_id),
-- the primary key, so the embed was one-to-one. Widening it to
-- (school_id, student_id) without a unique key of that shape would turn the
-- embed into an array, and the deployed functions throw on that
-- ("student_parents embedded as an array") for every roster read. Hence the
-- unique constraint, added in the same statement as the swap.
alter table public.student_parents
  add constraint student_parents_school_id_student_id_key
    unique (school_id, student_id),
  drop constraint student_parents_student_id_fkey,
  add constraint student_parents_student_fkey
    foreign key (school_id, student_id)
    references public.students (school_id, id)
    on delete cascade;

alter table public.student_classes
  drop constraint student_classes_student_id_fkey,
  add constraint student_classes_student_fkey
    foreign key (school_id, student_id)
    references public.students (school_id, id)
    on delete cascade;

alter table public.student_classes
  drop constraint student_classes_class_group_id_fkey,
  add constraint student_classes_class_group_fkey
    foreign key (school_id, class_group_id)
    references public.class_groups (school_id, id)
    on delete cascade;

-- ---------------------------------------------------------------------------
-- Names unique per school
-- ---------------------------------------------------------------------------

-- Same index names as before (nothing in the repo matches on them, but a
-- deployed function might); only the key widens to include the school.
drop index public.carpools_name_key;
create unique index carpools_name_key
  on public.carpools (school_id, lower(name));

drop index public.class_groups_name_key;
create unique index class_groups_name_key
  on public.class_groups (school_id, lower(name));

-- ---------------------------------------------------------------------------
-- Row-level security on the readable roster tables
-- ---------------------------------------------------------------------------

drop policy "students are publicly readable" on public.students;
drop policy "class groups are publicly readable" on public.class_groups;
drop policy "student classes are publicly readable" on public.student_classes;

-- LEGACY, TEMPORARY: the old code reads with the anon key and no identity, so
-- the anon key may still read school #1 (and only school #1). The contract
-- migration drops these three policies.
create policy "legacy anon reads school 1 students"
  on public.students
  for select
  to anon
  using (school_id = '00000000-0000-4000-8000-000000000001');

create policy "legacy anon reads school 1 class groups"
  on public.class_groups
  for select
  to anon
  using (school_id = '00000000-0000-4000-8000-000000000001');

create policy "legacy anon reads school 1 student classes"
  on public.student_classes
  for select
  to anon
  using (school_id = '00000000-0000-4000-8000-000000000001');

create policy "members and devices read their school students"
  on public.students
  for select
  to authenticated
  using (school_id in (select private.current_school_ids()));

create policy "members and devices read their school class groups"
  on public.class_groups
  for select
  to authenticated
  using (school_id in (select private.current_school_ids()));

create policy "members and devices read their school student classes"
  on public.student_classes
  for select
  to authenticated
  using (school_id in (select private.current_school_ids()));

-- ---------------------------------------------------------------------------
-- School-scoped RPCs
-- ---------------------------------------------------------------------------

-- No default arguments on the new overloads: a default would make a
-- positional call ambiguous with the old signatures. A row that belongs to
-- another school is treated exactly like one that does not exist, and every
-- insert into student_classes sets school_id explicitly.

create or replace function public.set_student_classes(
  p_school_id uuid,
  p_student_id uuid,
  p_class_group_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wanted uuid[];
begin
  -- NO KEY UPDATE: serializes concurrent calls for this student without
  -- conflicting with the FK's KEY SHARE lock.
  perform 1 from public.students
   where id = p_student_id and school_id = p_school_id
     for no key update;
  if not found then
    raise exception 'Student % does not exist.', p_student_id
      using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct x), '{}')
    into wanted
    from unnest(coalesce(p_class_group_ids, '{}')) as t(x)
   where x is not null;

  delete from public.student_classes
   where school_id = p_school_id
     and student_id = p_student_id
     and class_group_id <> all (wanted);

  -- A class from another school (or none) fails the composite FK: 23503,
  -- the same code an unknown class gives.
  insert into public.student_classes (school_id, student_id, class_group_id)
  select p_school_id, p_student_id, x from unnest(wanted) as t(x)
  on conflict do nothing;
end;
$$;

comment on function public.set_student_classes(uuid, uuid, uuid[]) is
  'Atomically makes a student''s class links exactly the given set, within one school. Raises P0002 for an unknown (or other-school) student and 23503 for an unknown (or other-school) class, changing nothing.';

create or replace function public.change_class_members(
  p_school_id uuid,
  p_class_group_id uuid,
  p_add_ids uuid[],
  p_remove_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ignored uuid[];
  members integer;
begin
  perform 1 from public.class_groups
   where id = p_class_group_id and school_id = p_school_id
     for share;
  if not found then
    raise exception 'Class % does not exist.', p_class_group_id
      using errcode = 'P0002';
  end if;

  -- Another school's students are "not on the roster" for this school.
  select coalesce(array_agg(distinct x order by x), '{}')
    into ignored
    from unnest(coalesce(p_add_ids, '{}') || coalesce(p_remove_ids, '{}')) as t(x)
   where x is not null
     and not exists (
       select 1 from public.students s
        where s.id = x and s.school_id = p_school_id
     );

  delete from public.student_classes
   where school_id = p_school_id
     and class_group_id = p_class_group_id
     and student_id = any (coalesce(p_remove_ids, '{}'));

  insert into public.student_classes (school_id, student_id, class_group_id)
  select p_school_id, s.id, p_class_group_id
    from public.students s
   where s.school_id = p_school_id
     and s.id = any (coalesce(p_add_ids, '{}'))
  on conflict do nothing;

  select count(*) into members
    from public.student_classes
   where school_id = p_school_id
     and class_group_id = p_class_group_id;

  return jsonb_build_object(
    'member_count', members,
    'ignored_ids', to_jsonb(ignored)
  );
end;
$$;

comment on function public.change_class_members(uuid, uuid, uuid[], uuid[]) is
  'Atomically adds and removes members of one class within one school. Ids not on this school''s roster are returned in ignored_ids. Raises P0002 if the class is not in this school.';

create or replace function public.remove_class_group(
  p_school_id uuid,
  p_class_group_id uuid,
  p_move_to uuid,
  p_force boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  members integer;
  sole_count integer;
  sample jsonb;
begin
  perform 1 from public.class_groups
   where id = p_class_group_id and school_id = p_school_id
     for update;
  if not found then
    raise exception 'Class % does not exist.', p_class_group_id
      using errcode = 'P0002';
  end if;

  if p_move_to is not null then
    if p_move_to = p_class_group_id then
      raise exception 'Cannot move students into the class being removed.'
        using errcode = '22023';
    end if;
    -- The target must be in the same school; another school's class is
    -- reported exactly like a missing one.
    perform 1 from public.class_groups
     where id = p_move_to and school_id = p_school_id
       for share;
    if not found then
      raise exception 'Target class % does not exist.', p_move_to
        using errcode = '22023';
    end if;
  end if;

  perform 1
     from public.student_classes sc
    where sc.school_id = p_school_id
      and sc.student_id in (
        select m.student_id from public.student_classes m
         where m.school_id = p_school_id
           and m.class_group_id = p_class_group_id
      )
      for update;

  select count(*) into members
    from public.student_classes
   where school_id = p_school_id
     and class_group_id = p_class_group_id;

  if p_move_to is not null then
    insert into public.student_classes (school_id, student_id, class_group_id)
    select p_school_id, student_id, p_move_to
      from public.student_classes
     where school_id = p_school_id
       and class_group_id = p_class_group_id
    on conflict do nothing;

    delete from public.class_groups
     where id = p_class_group_id and school_id = p_school_id;
    return jsonb_build_object('deleted', true, 'moved_count', members);
  end if;

  -- coalesce: a NULL p_force must fail closed (keep the guard).
  if not coalesce(p_force, false) then
    select count(*) into sole_count
      from public.student_classes m
     where m.school_id = p_school_id
       and m.class_group_id = p_class_group_id
       and not exists (
         select 1 from public.student_classes o
          where o.school_id = p_school_id
            and o.student_id = m.student_id
            and o.class_group_id <> p_class_group_id
       );

    if sole_count > 0 then
      select coalesce(jsonb_agg(
               jsonb_build_object('id', x.id, 'first_name', x.first_name, 'last_name', x.last_name)
               order by x.last_name, x.first_name, x.id
             ), '[]'::jsonb)
        into sample
        from (
          select s.id, s.first_name, s.last_name
            from public.student_classes m
            join public.students s
              on s.school_id = m.school_id and s.id = m.student_id
           where m.school_id = p_school_id
             and m.class_group_id = p_class_group_id
             and not exists (
               select 1 from public.student_classes o
                where o.school_id = p_school_id
                  and o.student_id = m.student_id
                  and o.class_group_id <> p_class_group_id
             )
           order by s.last_name, s.first_name, s.id
           limit 10
        ) x;

      return jsonb_build_object(
        'deleted', false,
        'member_count', members,
        'sole_member_count', sole_count,
        'sole_members', sample
      );
    end if;
  end if;

  delete from public.class_groups
   where id = p_class_group_id and school_id = p_school_id;
  return jsonb_build_object('deleted', true, 'moved_count', 0);
end;
$$;

comment on function public.remove_class_group(uuid, uuid, uuid, boolean) is
  'Retires a class within one school atomically. Refuses (deleted=false, with a sample) when students would be left with no class, unless p_move_to or p_force says what to do. Raises P0002 / 22023.';

-- LEGACY: the three old signatures become thin wrappers over school #1, so
-- there is one implementation and the already-deployed code keeps working.
-- The contract migration drops them. (create or replace keeps the old
-- argument names and defaults, which is all that is allowed.)
create or replace function public.set_student_classes(
  p_student_id uuid,
  p_class_group_ids uuid[]
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select public.set_student_classes(
    '00000000-0000-4000-8000-000000000001'::uuid,
    p_student_id,
    p_class_group_ids
  )
$$;

create or replace function public.change_class_members(
  p_class_group_id uuid,
  p_add_ids uuid[],
  p_remove_ids uuid[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.change_class_members(
    '00000000-0000-4000-8000-000000000001'::uuid,
    p_class_group_id,
    p_add_ids,
    p_remove_ids
  )
$$;

create or replace function public.remove_class_group(
  p_class_group_id uuid,
  p_move_to uuid default null,
  p_force boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.remove_class_group(
    '00000000-0000-4000-8000-000000000001'::uuid,
    p_class_group_id,
    p_move_to,
    p_force
  )
$$;

-- Same privilege treatment as the originals: callable by the service-role
-- store only (Postgres and Supabase would otherwise expose them as RPC).
revoke all on function public.set_student_classes(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.change_class_members(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.remove_class_group(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.set_student_classes(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.change_class_members(uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.remove_class_group(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.set_student_classes(uuid, uuid, uuid[]) to service_role;
grant execute on function public.change_class_members(uuid, uuid, uuid[], uuid[]) to service_role;
grant execute on function public.remove_class_group(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.set_student_classes(uuid, uuid[]) to service_role;
grant execute on function public.change_class_members(uuid, uuid[], uuid[]) to service_role;
grant execute on function public.remove_class_group(uuid, uuid, boolean) to service_role;
