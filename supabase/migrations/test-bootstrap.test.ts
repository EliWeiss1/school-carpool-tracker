import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BOOTSTRAP,
  asRoleOn,
  asUserOn,
  insertAuthUser,
} from "./test-bootstrap";

/**
 * The harness is what every tenant-isolation test stands on, so it gets its
 * own tests: a stub `auth.uid()` that quietly returned null would make every
 * "school B is invisible" assertion pass for the wrong reason.
 */

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(BOOTSTRAP);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function currentUid(): Promise<string | null> {
  const res = await db.query<{ uid: string | null }>(
    "select auth.uid() as uid",
  );
  return res.rows[0].uid;
}

async function currentRole(): Promise<string> {
  const res = await db.query<{ role: string }>("select current_user as role");
  return res.rows[0].role;
}

describe("the Supabase auth stub", () => {
  it("has no caller identity outside asUserOn", async () => {
    expect(await currentUid()).toBeNull();
  });

  it("runs as the authenticated role with the given user id", async () => {
    const uid = await insertAuthUser(db);
    await asUserOn(db, uid, async () => {
      expect(await currentUid()).toBe(uid);
      expect(await currentRole()).toBe("authenticated");
    });
  });

  it("exposes the claims through auth.jwt()", async () => {
    const uid = await insertAuthUser(db, { anonymous: true });
    await asUserOn(
      db,
      uid,
      async () => {
        const res = await db.query<{ claims: Record<string, unknown> }>(
          "select auth.jwt() as claims",
        );
        expect(res.rows[0].claims).toMatchObject({
          sub: uid,
          role: "authenticated",
          is_anonymous: true,
        });
      },
      { anonymous: true },
    );
  });

  it("clears the identity and the role afterwards, even when the body throws", async () => {
    const uid = await insertAuthUser(db);
    const superuser = await currentRole();
    await expect(
      asUserOn(db, uid, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await currentUid()).toBeNull();
    expect(await currentRole()).toBe(superuser);
  });

  it("gives the anon role no identity", async () => {
    await asRoleOn(db, "anon", async () => {
      expect(await currentUid()).toBeNull();
      expect(await currentRole()).toBe("anon");
    });
  });

  it("keeps auth.users unreadable by anon and authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      await asRoleOn(db, role, async () => {
        await expect(db.query("select * from auth.users")).rejects.toThrow();
      });
    }
  });

  it("records whether a user is anonymous", async () => {
    const device = await insertAuthUser(db, { anonymous: true });
    const person = await insertAuthUser(db, { email: "office@example.test" });
    const res = await db.query<{ id: string; is_anonymous: boolean }>(
      "select id, is_anonymous from auth.users where id = any($1::uuid[])",
      [[device, person]],
    );
    const byId = new Map(res.rows.map((r) => [r.id, r.is_anonymous]));
    expect(byId.get(device)).toBe(true);
    expect(byId.get(person)).toBe(false);
  });
});
