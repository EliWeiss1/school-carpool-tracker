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
-- note_pair_failure
-- ---------------------------------------------------------------------------

create or replace function public.note_pair_failure(
  p_school_id uuid,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_locked timestamptz;
begin
  -- One UPDATE, so two wrong codes arriving together are both counted. Every
  -- right-hand side reads the row as it was before this statement.
  update public.school_secrets s
  set failed_attempts = case
        when s.failed_window_started_at is null
          or p_now - s.failed_window_started_at > interval '10 minutes'
        then 1 else s.failed_attempts + 1 end,
      failed_window_started_at = case
        when s.failed_window_started_at is null
          or p_now - s.failed_window_started_at > interval '10 minutes'
        then p_now else s.failed_window_started_at end,
      locked_until = case
        when (case
                when s.failed_window_started_at is null
                  or p_now - s.failed_window_started_at > interval '10 minutes'
                then 1 else s.failed_attempts + 1 end) >= 10
        then p_now + interval '15 minutes'
        else s.locked_until end,
      updated_at = p_now
  where s.school_id = p_school_id
  returning s.failed_attempts, s.locked_until into v_attempts, v_locked;

  -- A lockout only ever stops new pairings. Nothing here touches school_devices.
  return pg_catalog.jsonb_build_object(
    'failed_attempts', coalesce(v_attempts, 0),
    'locked_until', v_locked
  );
end;
$$;

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
-- pair_device
-- ---------------------------------------------------------------------------

create or replace function public.pair_device(
  p_school_id uuid,
  p_user_id uuid,
  p_can_announce boolean,
  p_can_display boolean,
  p_label text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secrets public.school_secrets%rowtype;
  v_row public.school_devices%rowtype;
begin
  select * into v_secrets
  from public.school_secrets s where s.school_id = p_school_id;
  if not found then
    raise exception 'school not found';
  end if;

  insert into public.school_devices as d
    (school_id, user_id, can_announce, can_display,
     announce_code_version, display_code_version, label, last_seen_at)
  values
    (p_school_id, p_user_id, p_can_announce, p_can_display,
     case when p_can_announce then v_secrets.announce_code_version end,
     case when p_can_display then v_secrets.display_code_version end,
     p_label, now())
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

  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke all on function public.create_school(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.note_pair_failure(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.set_school_code(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.pair_device(uuid, uuid, boolean, boolean, text) from public, anon, authenticated;

grant execute on function public.create_school(uuid, text, text, text) to service_role;
grant execute on function public.note_pair_failure(uuid, timestamptz) to service_role;
grant execute on function public.set_school_code(uuid, text, text, boolean) to service_role;
grant execute on function public.pair_device(uuid, uuid, boolean, boolean, text) to service_role;
