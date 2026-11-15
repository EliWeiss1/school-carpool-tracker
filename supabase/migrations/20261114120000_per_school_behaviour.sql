-- Per-school behaviour: each school's own board-reset schedule, the monthly
-- cap on paid voice sessions, and a sweep for device sessions that never paired.
--
-- Expand-style: nothing here changes or removes anything the running code or
-- today's cron job uses. The legacy job ('nightly-board-reset', which calls
-- nightly_reset_board()) keeps running untouched; the new hourly job is guarded
-- by schools.last_reset_on, so both firing in the same hour only resets once
-- (the legacy one resets, the new one then finds nothing arrived, and a second
-- reset of an empty board is a no-op). The switch-over -- unscheduling the
-- legacy job -- is a rollout step, kept out of this file on purpose:
-- _rollout/unschedule_legacy_nightly_reset.sql.txt.
--
-- Every function below is security definer with an empty search_path and fully
-- qualified names, revoked from public/anon/authenticated and granted to
-- service_role only: left alone they would be callable as RPC by anyone with
-- the anon key.

-- ---------------------------------------------------------------------------
-- Board reset
-- ---------------------------------------------------------------------------

-- One school's reset. Mirrors reset_board_to_waiting() (only genuinely arrived
-- rows are touched or logged, one source 'admin' audit row each) but names the
-- school on both the update and the audit rows.
create or replace function public.reset_school_board(p_school_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
begin
  with reset as (
    update public.students
       set status = 'waiting'
     where school_id = p_school_id
       and status = 'arrived'
    returning id
  ), logged as (
    insert into public.status_events (school_id, student_id, changed_to, source)
    select p_school_id, id, 'waiting', 'admin' from reset
  )
  select count(*) into moved from reset;

  return moved;
end;
$$;

comment on function public.reset_school_board(uuid) is
  'Sets one school''s arrived students back to waiting and writes one admin audit row each, in that school. Returns how many moved. Unconditional -- run_due_board_resets() decides whether it is time.';

-- The hourly "is it anyone's time?" check. pg_cron is UTC-only, so it fires
-- every hour at minute 0 and this decides, per school, from that school's own
-- wall clock. That is what keeps 8 PM at 8 PM through every daylight-saving
-- change in every zone, with nobody editing a schedule.
--
-- A school is due when its local hour is reset_hour, its local weekday
-- (0 = Sunday) is in reset_days, and it has not already been reset on this
-- local date. last_reset_on is both the "only once" guard (a clock change can
-- show the same local hour twice) and, via the claim below, the answer to
-- "what if two runs overlap".
--
-- `p_now` is a parameter only so tests can ask "what if it were...?".
create or replace function public.run_due_board_resets(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  local_ts timestamp;
  local_date date;
  claimed uuid;
  schools_done integer := 0;
  students_done integer := 0;
  moved integer;
begin
  -- skip locked: a second run that overlaps this one passes over any school
  -- the first is still handling instead of waiting behind it and repeating it.
  for s in
    select id, timezone, reset_hour, reset_days
      from public.schools
     order by id
       for update skip locked
  loop
    -- One school's bad data (an unknown time zone) must not stop the others.
    -- The block is a subtransaction: a failure undoes that school's partial work.
    begin
      local_ts := p_now at time zone s.timezone;
      local_date := local_ts::date;

      if extract(hour from local_ts)::integer <> s.reset_hour
         or not (extract(dow from local_ts)::smallint = any (s.reset_days)) then
        continue;
      end if;

      -- The claim: only the run that moves last_reset_on forward may reset.
      update public.schools
         set last_reset_on = local_date
       where id = s.id
         and (last_reset_on is null or last_reset_on < local_date)
      returning id into claimed;

      if claimed is null then
        continue;
      end if;

      moved := public.reset_school_board(s.id);
      schools_done := schools_done + 1;
      students_done := students_done + moved;
    exception when others then
      raise warning 'run_due_board_resets: skipped school %: %', s.id, sqlerrm;
    end;
    claimed := null;
  end loop;

  return jsonb_build_object(
    'schools_reset', schools_done,
    'students_reset', students_done
  );
end;
$$;

comment on function public.run_due_board_resets(timestamptz) is
  'Resets each school whose own local clock says it is time (reset_hour, reset_days, once per local date via last_reset_on). Returns {schools_reset, students_reset}. A school with a bad time zone is skipped. Fired hourly by pg_cron.';

-- ---------------------------------------------------------------------------
-- Voice sessions
-- ---------------------------------------------------------------------------

-- Atomically claims one paid voice session for a school this month.
--
-- The cap check and the increment are the same statement: the limit is the
-- `where` of the insert ... on conflict do update that adds one. Postgres
-- re-evaluates that `where` against the locked, latest row version, so two
-- parallel claims cannot both take the last slot, which a select-then-update
-- would allow. A refusal moves nothing.
create or replace function public.claim_voice_session(
  p_school_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_limit integer;
  v_month date := date_trunc('month', p_now at time zone 'UTC')::date;
  v_used integer;
begin
  select voice_enabled, voice_monthly_limit
    into v_enabled, v_limit
    from public.schools
   where id = p_school_id;

  -- Not found leaves v_enabled null: an unknown school gets no voice.
  if v_enabled is not true then
    return jsonb_build_object('allowed', false, 'reason', 'disabled');
  end if;

  -- The upsert's `where` only guards the update branch; a first claim of the
  -- month would insert regardless, so a limit of zero is refused up front.
  if v_limit is not null and v_limit <= 0 then
    return jsonb_build_object(
      'allowed', false, 'reason', 'limit', 'used', 0, 'limit', v_limit
    );
  end if;

  insert into public.school_usage as u (school_id, month, voice_sessions)
  values (p_school_id, v_month, 1)
  on conflict (school_id, month) do update
     set voice_sessions = u.voice_sessions + 1
   where v_limit is null or u.voice_sessions < v_limit
  returning u.voice_sessions into v_used;

  if v_used is null then
    -- The where was false: the month's count has reached the limit.
    select voice_sessions into v_used
      from public.school_usage
     where school_id = p_school_id and month = v_month;
    return jsonb_build_object(
      'allowed', false, 'reason', 'limit',
      'used', coalesce(v_used, 0), 'limit', v_limit
    );
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit);
end;
$$;

comment on function public.claim_voice_session(uuid, timestamptz) is
  'Claims one voice session for the school''s current UTC month, or refuses ({allowed:false, reason:disabled|limit}). The cap check and the increment are one insert ... on conflict statement so parallel claims cannot overshoot.';

-- This month's numbers for the office screen. Read-only.
create or replace function public.school_voice_usage(
  p_school_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used', coalesce((
      select u.voice_sessions from public.school_usage u
       where u.school_id = s.id
         and u.month = date_trunc('month', p_now at time zone 'UTC')::date
    ), 0),
    'limit', s.voice_monthly_limit,
    'enabled', s.voice_enabled
  )
  from public.schools s
  where s.id = p_school_id
$$;

comment on function public.school_voice_usage(uuid, timestamptz) is
  'The school''s voice sessions used this UTC month, its monthly limit (null = none) and whether voice is on. Null for an unknown school.';

-- ---------------------------------------------------------------------------
-- Stale anonymous users
-- ---------------------------------------------------------------------------

-- Every device signs in anonymously before it pairs, so a device that never
-- completes pairing leaves an auth user behind. Paired devices have a
-- school_devices row and are never touched; neither is any non-anonymous user.
create or replace function public.delete_stale_anonymous_users(
  p_older_than interval default interval '1 day'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  with gone as (
    delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - p_older_than
       and not exists (
         select 1 from public.school_devices d where d.user_id = u.id
       )
    returning u.id
  )
  select count(*) into removed from gone;

  return removed;
end;
$$;

comment on function public.delete_stale_anonymous_users(interval) is
  'Deletes anonymous auth users older than the interval that never paired (no school_devices row). Returns how many.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.reset_school_board(uuid)
  from public, anon, authenticated;
revoke all on function public.run_due_board_resets(timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_voice_session(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.school_voice_usage(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.delete_stale_anonymous_users(interval)
  from public, anon, authenticated;

grant execute on function public.reset_school_board(uuid) to service_role;
grant execute on function public.run_due_board_resets(timestamptz) to service_role;
grant execute on function public.claim_voice_session(uuid, timestamptz) to service_role;
grant execute on function public.school_voice_usage(uuid, timestamptz) to service_role;
grant execute on function public.delete_stale_anonymous_users(interval) to service_role;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------

-- Guarded exactly like 20261011120000: PGlite has no pg_cron. New job names;
-- the legacy 'nightly-board-reset' job is deliberately left running.
do $schedule$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'per-school-board-reset',
      '0 * * * *',
      'select public.run_due_board_resets()'
    );
    perform cron.schedule(
      'purge-stale-anonymous-users',
      '30 4 * * *',
      'select public.delete_stale_anonymous_users()'
    );
  end if;
end
$schedule$;
