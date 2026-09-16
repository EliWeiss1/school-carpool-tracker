-- Parent names — up to two per student, for admin identification and for
-- resolving a spoken parent name to their child at pickup.
--
-- A separate table, not two new columns on students, and that choice is
-- load-bearing rather than stylistic. students carries REPLICA IDENTITY
-- FULL (see the init migration) so /display's realtime payload always
-- carries the previous row; Postgres requires a publication's column list
-- to cover the ENTIRE replica identity when it is FULL, so restricting the
-- supabase_realtime publication's columns to hide parent names would make
-- every UPDATE and DELETE on students fail outright (proved by running
-- schema.test.ts against an earlier column-based draft of this migration --
-- "cannot update table students" -- not merely hide the two columns). A
-- column-level REVOKE alone would still leave them reachable through
-- Realtime, which authorizes per-row via RLS, not per-column.
--
-- A separate table sidesteps the conflict entirely: it is simply never
-- added to any publication, so there is no column list to reconcile with a
-- replica identity. Trust model matches carpools/status_events, not
-- students: RLS enabled with NO policy and NO grants at all, so anon and
-- authenticated can neither read nor write it, and only the service role
-- (roster-list for /admin, resolve-name for matching) ever reaches it.

create table public.student_parents (
  student_id uuid primary key references public.students(id) on delete cascade,
  parent1_name text,
  parent2_name text,
  updated_at timestamptz not null default now()
);

comment on table public.student_parents is
  'Up to two parent/guardian names per student, for admin identification and voice-match resolution. Not publicly readable and never published to Realtime -- more sensitive than a child''s own name. Row deleted along with the student (unlike status_events/carpools'' on-delete-set-null pattern) since there is no audit reason to keep an orphaned parent name around.';

create or replace function public.student_parents_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger student_parents_touch_updated_at
  before update on public.student_parents
  for each row execute function public.student_parents_touch_updated_at();

alter table public.student_parents enable row level security;
revoke all on public.student_parents from anon, authenticated;
-- No policy of any kind: with RLS enabled and no policy, anon and
-- authenticated can neither read nor write this table. The service role
-- bypasses RLS and remains the only way in, exactly like carpools.
