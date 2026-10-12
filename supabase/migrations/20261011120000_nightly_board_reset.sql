-- Nightly "clear the board": every student still marked arrived goes back to
-- waiting at 8:00 PM Pacific, Sunday through Friday (Saturday night is skipped).
--
-- This does what /admin's "Reset all to waiting" does (roster-reset), but
-- inside the database so it runs even if Vercel or the Edge Functions are down.
-- Flipping `status` is enough for the display: the students_sync_status_timestamps
-- trigger clears arrived_at and Realtime pushes the change to every open board.

-- ---------------------------------------------------------------------------
-- The reset itself
-- ---------------------------------------------------------------------------

-- Only rows that are genuinely `arrived` are touched or logged, so a reset of
-- an already-red board writes nothing and fires no realtime event -- the same
-- guarantee roster-reset gives. One audit row per child moved, source 'admin',
-- matching what the button writes.
create or replace function public.reset_board_to_waiting()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  with reset as (
    update public.students
       set status = 'waiting'
     where status = 'arrived'
    returning id
  ), logged as (
    insert into public.status_events (student_id, changed_to, source)
    select id, 'waiting', 'admin' from reset
  )
  select count(*) into moved from reset;

  return moved;
end;
$$;

comment on function public.reset_board_to_waiting() is
  'Sets every arrived student back to waiting and writes one admin audit row each. Returns how many moved. Unconditional -- the nightly schedule goes through nightly_reset_board(), which decides whether it is time.';

-- ---------------------------------------------------------------------------
-- The "is it time?" guard
-- ---------------------------------------------------------------------------

-- pg_cron schedules in UTC and Supabase does not let us change that, and 8 PM
-- Pacific is 03:00 UTC in daylight time but 04:00 UTC in standard time. So the
-- job fires at BOTH UTC hours and this function does nothing unless the Pacific
-- wall clock actually says 20:xx -- which keeps it at 8 PM through every
-- daylight-saving change with nobody editing a schedule twice a year.
--
-- Saturday is judged on the Pacific date too: the 03:00 UTC firing that lands
-- on Sunday UTC is Saturday 8 PM here, and is the one skipped. `at` is a
-- parameter only so the tests can ask "what if it were...?" without waiting.
create or replace function public.nightly_reset_board(at timestamptz default now())
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pacific timestamp := at at time zone 'America/Los_Angeles';
begin
  if extract(hour from pacific) <> 20 then
    return null;
  end if;

  -- dow: 0 = Sunday ... 6 = Saturday.
  if extract(dow from pacific) = 6 then
    return null;
  end if;

  return public.reset_board_to_waiting();
end;
$$;

comment on function public.nightly_reset_board(timestamptz) is
  'Runs reset_board_to_waiting() only at 8 PM Pacific, never on Saturday; otherwise returns null. Fired hourly-twice by pg_cron to survive daylight saving.';

-- Postgres grants EXECUTE on new functions to PUBLIC, and Supabase's default
-- privileges add anon/authenticated on top. Both are callable as RPC through
-- the public API, which would let anyone with the anon key reset the board.
-- pg_cron runs as the owner, so nothing here needs a grant.
revoke all on function public.reset_board_to_waiting() from public, anon, authenticated;
revoke all on function public.nightly_reset_board(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------

-- Guarded because the local PGlite test harness has no pg_cron; on Supabase the
-- extension is available and this installs and schedules it. Re-running is safe:
-- cron.schedule on an existing job name replaces that job.
do $schedule$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'nightly-board-reset',
      '0 3,4 * * *',
      'select public.nightly_reset_board()'
    );
  end if;
end
$schedule$;
