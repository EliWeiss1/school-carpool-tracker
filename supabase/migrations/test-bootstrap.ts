import type { PGlite } from "@electric-sql/pglite";

/**
 * What the Supabase platform provides and a bare Postgres does not, recreated
 * for the PGlite migration tests: the three API roles, the realtime
 * publication, and a stub of the `auth` schema (users, `auth.uid()`,
 * `auth.jwt()`), so row-level security that depends on *who is asking* can be
 * tested by execution.
 *
 * Version note: PGlite 0.5.x is PostgreSQL 18, while the hosted project is 17
 * (`supabase/config.toml`, `major_version`). A migration that uses an
 * 18-only feature (`uuidv7()`, virtual generated columns, `NOT ENFORCED`
 * constraints) passes here and fails on deploy. Stay within 17.
 */
export const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  -- Supabase grants table privileges to anon, authenticated AND service_role
  -- platform-side by default (RLS, and each migration's own explicit
  -- REVOKE, are what actually narrow that); default privileges are the
  -- closest local equivalent. Granting only service_role here would make
  -- every "anon is denied" assertion below pass because anon was never
  -- granted anything in the first place, not because a migration's REVOKE
  -- did its job -- a regression guard that can't fail is not a guard.
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  create publication supabase_realtime;

  -- The auth stub. On the platform this schema belongs to Supabase Auth;
  -- only the pieces migrations and policies reference are recreated.
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    is_anonymous boolean not null default false,
    created_at timestamptz not null default now()
  );
  -- Same contract as the platform: the caller's claims arrive in the
  -- request.jwt.claims setting, and a missing or empty setting means
  -- "nobody" rather than an error.
  create function auth.jwt() returns jsonb
    language sql stable
    as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $$;
  create function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.jwt()
    to anon, authenticated, service_role;
  grant all on auth.users to service_role;
`;

/** Runs `fn` as a database role, restoring the previous role afterwards. */
export async function asRoleOn<T>(
  db: PGlite,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

export interface AsUserOptions {
  /** True for a device session (Supabase anonymous sign-in). */
  anonymous?: boolean;
}

/**
 * Runs `fn` the way PostgREST runs a signed-in request: role `authenticated`,
 * with the user's id in the JWT claims. The identity is cleared afterwards
 * even if `fn` throws, so one test's caller can never leak into the next.
 */
export async function asUserOn<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>,
  options: AsUserOptions = {},
): Promise<T> {
  const claims = JSON.stringify({
    sub: userId,
    role: "authenticated",
    is_anonymous: options.anonymous === true,
  });
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    claims,
  ]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

export interface AuthUserInput {
  email?: string;
  anonymous?: boolean;
}

/** Inserts a row into the stub `auth.users` and returns its id. */
export async function insertAuthUser(
  db: PGlite,
  input: AuthUserInput = {},
): Promise<string> {
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email, is_anonymous) values ($1, $2) returning id",
    [input.email ?? null, input.anonymous === true],
  );
  return res.rows[0].id;
}
