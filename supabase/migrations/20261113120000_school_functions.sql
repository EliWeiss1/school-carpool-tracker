-- School functions for the pair-device and school-write Edge Functions.
--
-- Each is one atomic step the Edge Functions would otherwise have to
-- assemble from several round trips: creating a school with its owner, counting
-- a wrong device code, changing a code and disconnecting devices, pairing a
-- device. All are security definer with an empty search_path, revoked from every
-- API role and granted to service_role only, like the class functions in the
-- expand migration: PostgREST would otherwise expose them as RPC to anyone.

-- ---------------------------------------------------------------------------
-- create_school
-- ---------------------------------------------------------------------------

create or replace function public.create_school(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_timezone text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school public.schools%rowtype;
begin
  -- Serialises two simultaneous sign-ups by the same account (a double click),
  -- which the primary key of school_members would not stop: it allows one user
  -- in many schools.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select s.* into v_school
  from public.school_members m
  join public.schools s on s.id = m.school_id
  where m.user_id = p_user_id
  order by m.created_at
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'status', 'exists',
      'school', pg_catalog.jsonb_build_object(
        'id', v_school.id, 'name', v_school.name,
        'slug', v_school.slug, 'timezone', v_school.timezone
      )
    );
  end if;

  begin
    insert into public.schools (name, slug, timezone, voice_enabled)
    values (pg_catalog.btrim(p_name), p_slug, p_timezone, true)
    returning * into v_school;
  exception when unique_violation then
    -- Another sign-up took the slug between any check and this insert. The
    -- unique constraint is the arbiter, so this is the one place it is read.
    return pg_catalog.jsonb_build_object('status', 'slug-taken');
  end;

  insert into public.school_secrets (school_id) values (v_school.id);
  insert into public.school_members (school_id, user_id, role)
  values (v_school.id, p_user_id, 'owner');

  return pg_catalog.jsonb_build_object(
    'status', 'created',
    'school', pg_catalog.jsonb_build_object(
      'id', v_school.id, 'name', v_school.name,
      'slug', v_school.slug, 'timezone', v_school.timezone
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- school_pair_attempts: wrong-code counters per school and client address
-- ---------------------------------------------------------------------------

create table public.school_pair_attempts (
  school_id uuid not null references public.schools (id) on delete cascade,
  client_ip text not null,
  attempts integer not null default 0,
  window_started_at timestamptz not null,
  locked_until timestamptz,
  primary key (school_id, client_ip)
);

comment on table public.school_pair_attempts is
  'Wrong device codes per school and client address. Service role only.';

alter table public.school_pair_attempts enable row level security;
revoke all on public.school_pair_attempts from anon, authenticated;
grant select, insert, update, delete on public.school_pair_attempts to service_role;

-- ---------------------------------------------------------------------------
-- set_school_code
-- ---------------------------------------------------------------------------

create or replace function public.set_school_code(
  p_school_id uuid,
  p_which text,
  p_code text,
  p_disconnect boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_announce boolean := p_which in ('announce', 'both');
  v_display boolean := p_which in ('display', 'both');
  v_secrets public.school_secrets%rowtype;
  v_users uuid[] := '{}';
begin
  if p_which is null or p_which not in ('announce', 'display', 'both') then
    raise exception 'which must be announce, display or both';
  end if;

  update public.school_secrets s
  set announce_code = case when v_announce then p_code else s.announce_code end,
      display_code = case when v_display then p_code else s.display_code end,
      announce_code_version = s.announce_code_version
        + case when v_announce then 1 else 0 end,
      display_code_version = s.display_code_version
        + case when v_display then 1 else 0 end,
      -- A new code is the office's answer to a lockout.
      failed_attempts = 0,
      failed_window_started_at = null,
      locked_until = null,
      updated_at = now()
  where s.school_id = p_school_id
  returning * into v_secrets;

  if not found then
    raise exception 'school not found';
  end if;

  -- A new code makes every earlier guess moot.
  delete from public.school_pair_attempts a where a.school_id = p_school_id;

  if p_disconnect then
    with gone as (
      delete from public.school_devices d
      where d.school_id = p_school_id
        and ((v_announce and d.can_announce) or (v_display and d.can_display))
      returning d.user_id
    )
    select coalesce(pg_catalog.array_agg(g.user_id), '{}') into v_users from gone g;
  end if;

  return pg_catalog.jsonb_build_object(
    'announce_code', v_secrets.announce_code,
    'display_code', v_secrets.display_code,
    'disconnected_user_ids', pg_catalog.to_jsonb(v_users)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- attempt_pairing
-- ---------------------------------------------------------------------------
--
-- The whole pairing decision in one transaction: look the school up, check its
-- locks, compare the code, count a failure or record the device. Everything
-- runs under a row lock on the school's school_secrets row, which is also the
-- row set_school_code updates, so
--   * a burst of parallel guesses is counted one at a time, not all against the
--     same stale counter;
--   * a device cannot be inserted with a code that set_school_code has just
--     replaced: it either commits first (and is then disconnected) or waits and
--     is compared against the new code.
-- A lockout only ever refuses a new pairing. It never touches school_devices.

create or replace function public.attempt_pairing(
  p_slug text,
  p_code text,
  p_user_id uuid,
  p_label text,
  p_client_ip text,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school public.schools%rowtype;
  v_secrets public.school_secrets%rowtype;
  v_ip public.school_pair_attempts%rowtype;
  v_announce boolean;
  v_display boolean;
  v_ip_attempts integer;
  v_ceiling integer;
  v_ceiling_started timestamptz;
  v_row public.school_devices%rowtype;
begin
  select s.* into v_school from public.schools s where s.slug = p_slug;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'refused');
  end if;

  select * into v_secrets
  from public.school_secrets s
  where s.school_id = v_school.id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'refused');
  end if;

  -- School-wide ceiling: many addresses together cannot grind through codes.
  if v_secrets.locked_until is not null and v_secrets.locked_until > p_now then
    return pg_catalog.jsonb_build_object(
      'status', 'locked', 'locked_until', v_secrets.locked_until);
  end if;

  delete from public.school_pair_attempts a
  where a.school_id = v_school.id
    and a.window_started_at < p_now - interval '1 day';

  insert into public.school_pair_attempts (school_id, client_ip, attempts, window_started_at)
  values (v_school.id, p_client_ip, 0, p_now)
  on conflict (school_id, client_ip) do nothing;

  select * into v_ip
  from public.school_pair_attempts a
  where a.school_id = v_school.id and a.client_ip = p_client_ip
  for update;

  if p_now - v_ip.window_started_at > interval '10 minutes' then
    update public.school_pair_attempts a
    set attempts = 0,
        window_started_at = p_now,
        -- An unexpired lock outlives the counting window.
        locked_until = case when a.locked_until > p_now then a.locked_until end
    where a.school_id = v_school.id and a.client_ip = p_client_ip
    returning * into v_ip;
  end if;

  -- Per-address lock: one network's guessing locks that network, not the school.
  if v_ip.locked_until is not null and v_ip.locked_until > p_now then
    return pg_catalog.jsonb_build_object(
      'status', 'locked', 'locked_until', v_ip.locked_until);
  end if;

  -- Hash against hash, both codes always evaluated, so timing does not follow
  -- how much of a code matched. A null or empty stored code never matches.
  v_announce := coalesce(v_secrets.announce_code, '') <> ''
    and pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_code, ''), 'UTF8'))
      = pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_secrets.announce_code, ''), 'UTF8'));
  v_display := coalesce(v_secrets.display_code, '') <> ''
    and pg_catalog.sha256(pg_catalog.convert_to(coalesce(p_code, ''), 'UTF8'))
      = pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_secrets.display_code, ''), 'UTF8'));

  if not v_announce and not v_display then
    v_ip_attempts := v_ip.attempts + 1;
    update public.school_pair_attempts a
    set attempts = v_ip_attempts,
        locked_until = case when v_ip_attempts >= 10
          then p_now + interval '15 minutes' else a.locked_until end
    where a.school_id = v_school.id and a.client_ip = p_client_ip;

    if v_secrets.failed_window_started_at is null
       or p_now - v_secrets.failed_window_started_at > interval '1 hour' then
      v_ceiling := 1;
      v_ceiling_started := p_now;
    else
      v_ceiling := v_secrets.failed_attempts + 1;
      v_ceiling_started := v_secrets.failed_window_started_at;
    end if;
    update public.school_secrets s
    set failed_attempts = v_ceiling,
        failed_window_started_at = v_ceiling_started,
        locked_until = case when v_ceiling >= 100
          then p_now + interval '15 minutes' else s.locked_until end,
        updated_at = p_now
    where s.school_id = v_school.id;

    return pg_catalog.jsonb_build_object('status', 'refused');
  end if;

  -- A success is not counted against either limit.
  insert into public.school_devices as d
    (school_id, user_id, can_announce, can_display,
     announce_code_version, display_code_version, label, last_seen_at)
  values
    (v_school.id, p_user_id, v_announce, v_display,
     case when v_announce then v_secrets.announce_code_version end,
     case when v_display then v_secrets.display_code_version end,
     p_label, p_now)
  on conflict (user_id) do update
  set -- Same school: what the device could already do is kept and added to.
      -- Another school: nothing carries over.
      can_announce = excluded.can_announce
        or (d.school_id = excluded.school_id and d.can_announce),
      can_display = excluded.can_display
        or (d.school_id = excluded.school_id and d.can_display),
      announce_code_version = case
        when excluded.can_announce then excluded.announce_code_version
        when d.school_id = excluded.school_id then d.announce_code_version
        end,
      display_code_version = case
        when excluded.can_display then excluded.display_code_version
        when d.school_id = excluded.school_id then d.display_code_version
        end,
      label = coalesce(excluded.label,
        case when d.school_id = excluded.school_id then d.label end),
      created_at = case
        when d.school_id = excluded.school_id then d.created_at
        else excluded.created_at end,
      school_id = excluded.school_id,
      last_seen_at = excluded.last_seen_at
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'status', 'paired',
    'school', pg_catalog.jsonb_build_object(
      'id', v_school.id, 'name', v_school.name, 'slug', v_school.slug),
    'can_announce', v_announce,
    'can_display', v_display
  );
end;
$$;

revoke all on function public.create_school(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.set_school_code(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.attempt_pairing(text, text, uuid, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.create_school(uuid, text, text, text) to service_role;
grant execute on function public.set_school_code(uuid, text, text, boolean) to service_role;
grant execute on function public.attempt_pairing(text, text, uuid, text, text, timestamptz) to service_role;
