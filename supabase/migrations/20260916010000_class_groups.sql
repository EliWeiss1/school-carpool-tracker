-- Class groups — the admin-editable list of classes a student can be
-- assigned to, replacing the old hardcoded CLASS_GROUPS array in code.
--
-- students.class_group stays a free-text column (unchanged) -- this table is
-- only the list of suggestions offered on the pickers in /admin, /announce
-- and /display. Deleting a row here never touches a student's existing
-- class_group value, the same "convenience list on top of free text" design
-- the code comment it replaces already had.
--
-- Trust model matches students, not carpools: /display's class filter and
-- /announce's narrow-by-class control both need this with no PIN, so it is
-- publicly readable like students. Writes go only through the service-role
-- Edge Function (classes-write).

create table public.class_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

comment on table public.class_groups is
  'The admin-editable list of classes offered on student/roster pickers. students.class_group itself stays free text -- deleting a row here never touches an existing student.';

-- Case-insensitive, same reasoning as carpools.name.
create unique index class_groups_name_key on public.class_groups (lower(name));
create index class_groups_sort_order_idx on public.class_groups (sort_order);

alter table public.class_groups enable row level security;
revoke all on public.class_groups from anon, authenticated;
grant select on public.class_groups to anon, authenticated;

create policy "class groups are publicly readable"
  on public.class_groups
  for select
  to anon, authenticated
  using (true);

-- Seeded with today's known classes, in the order they should be offered:
-- the four EC classes before kindergarten, matching the real EC roster
-- export's class names exactly so importing that file needs no further
-- correction once the header bug (see the csv-import.ts fix) is fixed.
insert into public.class_groups (name, sort_order) values
  ('EC Hummingbirds', 0),
  ('EC Chickadees', 1),
  ('EC Robins', 2),
  ('EC Eagles', 3),
  ('K1', 4),
  ('K2', 5),
  ('1st', 6),
  ('2nd', 7),
  ('3rd', 8),
  ('4th', 9),
  ('5th', 10);
