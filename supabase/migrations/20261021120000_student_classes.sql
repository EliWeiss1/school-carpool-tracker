-- Students in more than one class -- the EXPAND step.
--
-- A student used to carry exactly one free-text students.class_group. This
-- adds the student_classes junction table (one row per student-in-a-class),
-- backfills it from that column, and adds the atomic database functions the
-- Edge Functions use to change memberships (supabase-js has no transactions,
-- so anything that must be all-or-nothing lives here).
--
-- students.class_group is deliberately LEFT IN PLACE: the frontend and Edge
-- Functions deploy separately from the database, so old code must keep
-- working until the new code is live. A later contract migration re-runs the
-- idempotent backfill and drops the column.
--
-- Every function below is security invoker with an empty search_path (all
-- names schema-qualified), and is revoked from public/anon/authenticated the
-- same way nightly_reset_board() is: callable only by the service-role store.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table public.student_classes (
  student_id uuid not null references public.students (id) on delete cascade,
  class_group_id uuid not null references public.class_groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A student cannot be in the same class twice. The PK index also serves
  -- "classes of a student" (leading column student_id).
  primary key (student_id, class_group_id)
);

comment on table public.student_classes is
  'Which classes each student belongs to (many-to-many). Deleting a student or a class cascades to its links only; retiring a class with sole members goes through remove_class_group().';

-- "Students of a class": /display sections, drawers, filters.
create index student_classes_class_idx
  on public.student_classes (class_group_id, student_id);

-- Same trust model as students/class_groups: publicly readable (the board and
-- the announce filter need it with no PIN), written only by the service role.
alter table public.student_classes enable row level security;
revoke all on public.student_classes from anon, authenticated;
grant select on public.student_classes to anon, authenticated;

create policy "student classes are publicly readable"
  on public.student_classes
  for select
  to anon, authenticated
  using (true);

-- /display listens for membership edits. Guarded like the init migration so a
-- re-push onto a project that already publishes the table does not fail. The
-- primary key carries both columns, so a DELETE event still says which link
-- went without needing FULL replica identity.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'student_classes'
  ) then
    alter publication supabase_realtime add table public.student_classes;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- backfill_student_classes() -- free-text class_group -> links
-- ---------------------------------------------------------------------------

-- Idempotent: run by this migration and again by the contract migration, to
-- catch anything old code wrote during the deploy window.
--
-- 1. Any non-blank class_group with no case/whitespace-insensitive match in
--    class_groups gets a new class_groups row, so no student loses a class.
--    The trimmed original spelling is kept (the alphabetically first one when
--    several spellings differ only by case), appended after the current max
--    sort_order in name order.
-- 2. Every student with a non-blank class_group gets a link to the matching
--    class; an existing link is left alone.
create or replace function public.backfill_student_classes()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  with wanted as (
    select lower(btrim(s.class_group, E' \t\r\n')) as key,
           -- collate "C": byte order, so the chosen spelling does not depend
           -- on the database's collation.
           min(btrim(s.class_group, E' \t\r\n') collate "C") as name
      from public.students s
     where nullif(btrim(s.class_group, E' \t\r\n'), '') is not null
     group by lower(btrim(s.class_group, E' \t\r\n'))
  ), missing as (
    select w.name
      from wanted w
     where not exists (
       select 1 from public.class_groups g
        where lower(btrim(g.name, E' \t\r\n')) = w.key
     )
  ), base as (
    select coalesce(max(sort_order), -1) as top from public.class_groups
  )
  insert into public.class_groups (name, sort_order)
  select m.name, b.top + row_number() over (order by m.name)
    from missing m cross join base b
  -- A concurrent writer adding the same name (class_groups_name_key) is not
  -- an error: the link step below matches whichever row won.
  on conflict do nothing;

  insert into public.student_classes (student_id, class_group_id)
  select s.id, g.id
    from public.students s
    join lateral (
      -- One class per student even if two class_groups rows differ only by
      -- surrounding whitespace (the unique index is on lower(name), untrimmed).
      select g.id
        from public.class_groups g
       where lower(btrim(g.name, E' \t\r\n')) = lower(btrim(s.class_group, E' \t\r\n'))
       order by g.sort_order, g.id
       limit 1
    ) g on true
   where nullif(btrim(s.class_group, E' \t\r\n'), '') is not null
  on conflict do nothing;
end;
$$;

comment on function public.backfill_student_classes() is
  'Idempotently copies students.class_group into student_classes, creating any class_groups row the free text names but the list lacks. Safe to re-run.';

-- ---------------------------------------------------------------------------
-- set_student_classes() -- replace one student's set
-- ---------------------------------------------------------------------------

-- Makes the student's links exactly p_class_group_ids: deletes the rest,
-- inserts the missing. One transaction, so a failure (unknown student: P0002;
-- unknown class: 23503 from the FK) leaves the previous set untouched. The
-- student row is locked so two concurrent replacements for the same student
-- serialize instead of interleaving into the union of both sets.
-- Null array or null elements are treated as "nothing"; duplicates are fine.
create or replace function public.set_student_classes(
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
  -- NO KEY UPDATE: still serializes concurrent calls for this student, but
  -- does not conflict with the FK's KEY SHARE lock (no deadlock with
  -- remove_class_group(..., move_to) inserting links for the same student).
  perform 1 from public.students where id = p_student_id for no key update;
  if not found then
    raise exception 'Student % does not exist.', p_student_id
      using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct x), '{}')
    into wanted
    from unnest(coalesce(p_class_group_ids, '{}')) as t(x)
   where x is not null;

  delete from public.student_classes
   where student_id = p_student_id
     and class_group_id <> all (wanted);

  insert into public.student_classes (student_id, class_group_id)
  select p_student_id, x from unnest(wanted) as t(x)
  on conflict do nothing;
end;
$$;

comment on function public.set_student_classes(uuid, uuid[]) is
  'Atomically makes a student''s class links exactly the given set. Raises P0002 for an unknown student and 23503 for an unknown class, changing nothing.';

-- ---------------------------------------------------------------------------
-- change_class_members() -- bulk add/remove for one class
-- ---------------------------------------------------------------------------

-- No sole-member guard here: removing a student's last class through this
-- call (or after a remove_class_group check has passed) can leave them with
-- no class. That is accepted -- the guard covers one remove_class_group call.
--
-- Drives the bulk-assign UI. Removes are applied before adds, so an id in
-- both lists ends up a member (never silently loses a class). Adding an
-- existing member is a no-op; removing a non-member is a no-op. Ids that are
-- not on the roster at all (from either list) are skipped and returned in
-- ignored_ids rather than failing the whole batch. The class row is share-
-- locked so remove_class_group() cannot delete it mid-batch.
-- Returns {"member_count": <members after>, "ignored_ids": [uuid...]}.
create or replace function public.change_class_members(
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
  perform 1 from public.class_groups where id = p_class_group_id for share;
  if not found then
    raise exception 'Class % does not exist.', p_class_group_id
      using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}')
    into ignored
    from unnest(coalesce(p_add_ids, '{}') || coalesce(p_remove_ids, '{}')) as t(x)
   where x is not null
     and not exists (select 1 from public.students s where s.id = x);

  delete from public.student_classes
   where class_group_id = p_class_group_id
     and student_id = any (coalesce(p_remove_ids, '{}'));

  insert into public.student_classes (student_id, class_group_id)
  select s.id, p_class_group_id
    from public.students s
   where s.id = any (coalesce(p_add_ids, '{}'))
  on conflict do nothing;

  select count(*) into members
    from public.student_classes
   where class_group_id = p_class_group_id;

  return jsonb_build_object(
    'member_count', members,
    'ignored_ids', to_jsonb(ignored)
  );
end;
$$;

comment on function public.change_class_members(uuid, uuid[], uuid[]) is
  'Atomically adds and removes members of one class. Unknown student ids are returned in ignored_ids, not raised. Raises P0002 if the class does not exist.';

-- ---------------------------------------------------------------------------
-- remove_class_group() -- retire a class without stranding students
-- ---------------------------------------------------------------------------

-- The sole-member guard applies to this call only: a separate, later
-- change_class_members removal can still leave a student with no class, and
-- that is accepted. NULL p_force means false; NULL p_move_to means absent.
--
-- A "sole member" is a student whose only class is this one. Outcomes:
--   * no sole members, or p_force             -> delete the class
--                                               {"deleted": true, "moved_count": 0}
--   * p_move_to set                           -> link EVERY member (sole or
--                                               not) to p_move_to, then delete
--                                               {"deleted": true, "moved_count": <members>}
--   * sole members, neither option            -> delete nothing, report
--                                               {"deleted": false, "member_count", "sole_member_count",
--                                                "sole_members": [{id, first_name, last_name}] (max 10)}
-- Errors (the whole call rolls back): P0002 the class does not exist;
-- 22023 p_move_to is this class or does not exist.
--
-- Locking: the class row is locked FOR UPDATE, which blocks any concurrent
-- insert of a link to it (the FK check needs a KEY SHARE lock on that row), so
-- nobody can join the class after the sole-member check. Every member's link
-- rows (in all classes) are then locked FOR UPDATE before the check runs, so a
-- concurrent removal of a member's *other* class either commits first (and
-- the check, a fresh statement, sees it) or waits for this call to finish.
create or replace function public.remove_class_group(
  p_class_group_id uuid,
  p_move_to uuid default null,
  p_force boolean default false
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
  perform 1 from public.class_groups where id = p_class_group_id for update;
  if not found then
    raise exception 'Class % does not exist.', p_class_group_id
      using errcode = 'P0002';
  end if;

  if p_move_to is not null then
    if p_move_to = p_class_group_id then
      raise exception 'Cannot move students into the class being removed.'
        using errcode = '22023';
    end if;
    perform 1 from public.class_groups where id = p_move_to for share;
    if not found then
      raise exception 'Target class % does not exist.', p_move_to
        using errcode = '22023';
    end if;
  end if;

  perform 1
     from public.student_classes sc
    where sc.student_id in (
      select m.student_id from public.student_classes m
       where m.class_group_id = p_class_group_id
    )
    for update;

  select count(*) into members
    from public.student_classes
   where class_group_id = p_class_group_id;

  if p_move_to is not null then
    insert into public.student_classes (student_id, class_group_id)
    select student_id, p_move_to
      from public.student_classes
     where class_group_id = p_class_group_id
    on conflict do nothing;

    delete from public.class_groups where id = p_class_group_id;
    return jsonb_build_object('deleted', true, 'moved_count', members);
  end if;

  -- coalesce: a NULL p_force must fail closed (keep the guard), not skip it.
  if not coalesce(p_force, false) then
    select count(*) into sole_count
      from public.student_classes m
     where m.class_group_id = p_class_group_id
       and not exists (
         select 1 from public.student_classes o
          where o.student_id = m.student_id
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
            join public.students s on s.id = m.student_id
           where m.class_group_id = p_class_group_id
             and not exists (
               select 1 from public.student_classes o
                where o.student_id = m.student_id
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

  delete from public.class_groups where id = p_class_group_id;
  return jsonb_build_object('deleted', true, 'moved_count', 0);
end;
$$;

comment on function public.remove_class_group(uuid, uuid, boolean) is
  'Retires a class atomically. Refuses (deleted=false, with a sample) when students would be left with no class, unless p_move_to or p_force says what to do. Raises P0002 / 22023.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Postgres grants EXECUTE to PUBLIC on new functions and Supabase adds
-- anon/authenticated, which would expose all of these as RPC to anyone with
-- the anon key. Only the service-role store calls them, so grant that back
-- explicitly rather than relying on a platform default.
revoke all on function public.backfill_student_classes() from public, anon, authenticated;
revoke all on function public.set_student_classes(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.change_class_members(uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.remove_class_group(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public.backfill_student_classes() to service_role;
grant execute on function public.set_student_classes(uuid, uuid[]) to service_role;
grant execute on function public.change_class_members(uuid, uuid[], uuid[]) to service_role;
grant execute on function public.remove_class_group(uuid, uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill now
-- ---------------------------------------------------------------------------

select public.backfill_student_classes();
