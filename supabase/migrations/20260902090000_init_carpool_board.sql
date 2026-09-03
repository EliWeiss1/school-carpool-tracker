-- Carpool Pickup Board — initial schema, RLS, and realtime wiring.
--
-- Trust model: the anon key is handed out to every browser (the /display screen
-- is deliberately public), so it must be able to read the roster and do nothing
-- else. Every write arrives through an Edge Function holding the service-role
-- key, which bypasses RLS. There are therefore no insert/update/delete policies
-- anywhere in this file — that absence is the security boundary, not an
-- oversight.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  aliases text[] not null default '{}',
  grade text,
  class_group text,
  status text not null default 'waiting' check (status in ('waiting', 'arrived')),
  arrived_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.students is
  'Enrolled roster plus current pickup-line status. Publicly readable; writable only via the service role.';
comment on column public.students.aliases is
  'Alternate spellings/transliterations fed to the matcher, e.g. Kohen and Cohn for Cohen. Display always uses last_name.';

create table public.status_events (
  id uuid primary key default gen_random_uuid(),
  -- Nulled rather than cascaded when a student leaves the roster: this is an
  -- audit log for retuning match thresholds, so the rows must outlive roster edits.
  student_id uuid references public.students(id) on delete set null,
  changed_to text not null,
  source text not null check (source in ('voice', 'manual', 'admin')),
  match_confidence numeric,
  raw_transcript text,
  created_at timestamptz not null default now()
);

comment on table public.status_events is
  'Append-only audit log. Never shown on /display — it exists so false accepts can be reviewed and matching thresholds retuned.';
comment on column public.status_events.raw_transcript is
  'What Deepgram heard. Audio itself is never persisted.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- /display renders waiting-first; /admin lists by name.
create index students_status_idx on public.students (status);
create index students_last_name_idx on public.students (lower(last_name));
-- The announce page narrows the Deepgram keyterm list by class.
create index students_class_group_idx on public.students (class_group)
  where class_group is not null;
create index status_events_created_at_idx on public.status_events (created_at desc);
create index status_events_student_id_idx on public.status_events (student_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- arrived_at is derived from the status transition rather than trusted from the
-- caller, so an 'arrived' row can never exist without a timestamp and a reset to
-- 'waiting' can never leave a stale one behind.
create or replace function public.students_sync_status_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  if new.status = 'arrived' and (tg_op = 'INSERT' or old.status is distinct from 'arrived') then
    new.arrived_at := now();
  elsif new.status = 'waiting' then
    new.arrived_at := null;
  end if;

  return new;
end;
$$;

create trigger students_sync_status_timestamps
  before insert or update on public.students
  for each row execute function public.students_sync_status_timestamps();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.students enable row level security;
alter table public.status_events enable row level security;

-- Belt and braces: Supabase grants anon/authenticated table privileges by
-- default, and RLS is what actually stops them. Dropping the grants means a
-- future policy added by mistake still cannot open up a write path.
revoke all on public.students from anon, authenticated;
revoke all on public.status_events from anon, authenticated;
grant select on public.students to anon, authenticated;

-- The /display screen is intentionally unauthenticated.
create policy "students are publicly readable"
  on public.students
  for select
  to anon, authenticated
  using (true);

-- status_events gets no policy of any kind. With RLS enabled and no policy,
-- anon and authenticated can neither read nor write it; the service role
-- bypasses RLS and remains the only way in.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- FULL replica identity so an UPDATE payload carries the previous row. /display
-- needs the old status to tell a genuine waiting -> arrived transition (flash and
-- chime) from an unrelated edit (rename, grade change) that must stay silent.
-- The roster is a few hundred rows; the extra WAL is irrelevant here.
alter table public.students replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'students'
  ) then
    alter publication supabase_realtime add table public.students;
  end if;
end;
$$;

-- status_events is deliberately NOT published: it can contain a raw transcript,
-- and nothing in the UI subscribes to it.
