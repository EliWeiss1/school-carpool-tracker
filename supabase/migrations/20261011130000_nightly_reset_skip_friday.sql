-- The nightly reset skips Friday night as well as Saturday night, so it runs
-- Sunday through Thursday at 8 PM Pacific. Replaces the guard from
-- 20261011120000_nightly_board_reset.sql; the pg_cron schedule (03:00 and
-- 04:00 UTC) and the revoked grants are unchanged, and create or replace
-- keeps the existing privileges.
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

  -- dow: 0 = Sunday ... 5 = Friday, 6 = Saturday. Judged on the Pacific date,
  -- so the 03:00 UTC firing that lands on a Saturday/Sunday UTC date is the
  -- Friday/Saturday evening here.
  if extract(dow from pacific) in (5, 6) then
    return null;
  end if;

  return public.reset_board_to_waiting();
end;
$$;

comment on function public.nightly_reset_board(timestamptz) is
  'Runs reset_board_to_waiting() only at 8 PM Pacific, Sunday through Thursday; otherwise returns null. Fired twice daily by pg_cron (03:00 and 04:00 UTC) to survive daylight saving.';
