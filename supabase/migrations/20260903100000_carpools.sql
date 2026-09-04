-- Carpools — a callable group of students who arrive together.
--
-- Trust model matches status_events, not students: /display never needs a
-- carpool's name, only /announce and /admin do, and both reach this table only
-- through an Edge Function holding the service-role key. So carpools gets RLS
-- enabled with NO policy and NO grants at all -- anon and authenticated can
-- neither read nor write it, and the service role bypasses RLS as always.
-- students.carpool_id is still anon-readable (it rides along with the rest of
-- the row under the existing "students are publicly readable" policy), but a
-- bare UUID with no name attached tells a browser nothing.

create table public.carpools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.carpools is
  'A named, callable group of students who arrive together (siblings, a shared ride). Not publicly readable -- only /announce and /admin need a carpool''s name.';
comment on column public.carpools.aliases is
  'Alternate spellings fed to the matcher, same role as students.aliases.';

-- Case-insensitive: "Weiss Carpool" and "weiss carpool" are one group to a
-- staff member typing it into /admin twice by mistake.
create unique index carpools_name_key on public.carpools (lower(name));

alter table public.students
  add column carpool_id uuid references public.carpools(id) on delete set null;
comment on column public.students.carpool_id is
  'Nulled rather than cascaded when the carpool is deleted -- removing a carpool must never delete or orphan a child (see students_id FK on status_events for the same pattern).';

create index students_carpool_id_idx on public.students (carpool_id)
  where carpool_id is not null;

-- Lets a false accept that fanned out from a carpool collapse be told apart,
-- later, from three independent false accepts -- the corpus MATCH_POLICY is
-- meant to be retuned from. Nulled on delete for the same reason student_id is.
alter table public.status_events
  add column carpool_id uuid references public.carpools(id) on delete set null;
comment on column public.status_events.carpool_id is
  'Set when this status change came from confirming a whole carpool at once. Nulled, not cascaded, when the carpool is later deleted.';

create or replace function public.carpools_touch_updated_at()
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

create trigger carpools_touch_updated_at
  before update on public.carpools
  for each row execute function public.carpools_touch_updated_at();

alter table public.carpools enable row level security;
revoke all on public.carpools from anon, authenticated;
-- No policy of any kind: with RLS enabled and no policy, anon and
-- authenticated can neither read nor write this table. The service role
-- bypasses RLS and remains the only way in, exactly like status_events.
