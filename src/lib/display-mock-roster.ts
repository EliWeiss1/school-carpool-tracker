import type { Student } from "@/types/db";

/**
 * Synthetic roster for the dev-only `/display?mock=1` preview.
 *
 * There is no live Supabase project reachable from this machine (no
 * `.env.local`, nothing configured), so this is how the board's layout, tile
 * design, and flash/chime were actually checked and screenshotted -- see
 * `src/app/display/page.tsx` for where `mock` and `flash` are read, and the
 * phase 5 report for why this is safe to ship (gated on `NODE_ENV !==
 * "production"` in addition to the query param, so it can never activate on a
 * real deployment even if someone guesses the URL).
 *
 * Names echo the flavour of `supabase/seed/roster.ts` (confusable-surname
 * clusters) without importing it -- that file lives under `supabase/` for a
 * Deno-and-Vitest audience, not the browser bundle.
 */

const BASE_TIME = "2026-09-02T15:00:00.000Z";

interface MockSeed {
  id: string;
  first_name: string;
  last_name: string;
  grade: string;
  class_group: string;
  status: Student["status"];
}

const SEEDS: MockSeed[] = [
  { id: "m01", first_name: "Maya", last_name: "Cohen", grade: "K", class_group: "K-Alvarez", status: "waiting" },
  { id: "m02", first_name: "Elias", last_name: "Kohen", grade: "K", class_group: "K-Alvarez", status: "arrived" },
  { id: "m03", first_name: "Nora", last_name: "Chen", grade: "K", class_group: "K-Alvarez", status: "waiting" },
  { id: "m04", first_name: "Theo", last_name: "Ng", grade: "K", class_group: "K-Alvarez", status: "waiting" },
  { id: "m05", first_name: "Amira", last_name: "Al-Rashid", grade: "K", class_group: "K-Alvarez", status: "arrived" },
  { id: "m06", first_name: "Jonah", last_name: "Smith", grade: "K", class_group: "K-Alvarez", status: "waiting" },
  { id: "m07", first_name: "Priya", last_name: "Patel", grade: "1", class_group: "1-Reyes", status: "waiting" },
  { id: "m08", first_name: "Arjun", last_name: "Patil", grade: "1", class_group: "1-Reyes", status: "waiting" },
  { id: "m09", first_name: "Sofia", last_name: "Reyes", grade: "1", class_group: "1-Reyes", status: "arrived" },
  { id: "m10", first_name: "Mateo", last_name: "Rios", grade: "1", class_group: "1-Reyes", status: "waiting" },
  { id: "m11", first_name: "Lucas", last_name: "Garcia", grade: "1", class_group: "1-Reyes", status: "waiting" },
  { id: "m12", first_name: "Elena", last_name: "Garza", grade: "1", class_group: "1-Reyes", status: "arrived" },
  { id: "m13", first_name: "Wei", last_name: "Lee", grade: "2", class_group: "2-Marsh", status: "waiting" },
  { id: "m14", first_name: "Hannah", last_name: "Li", grade: "2", class_group: "2-Marsh", status: "waiting" },
  { id: "m15", first_name: "Olivia", last_name: "Leigh", grade: "2", class_group: "2-Marsh", status: "arrived" },
  { id: "m16", first_name: "Daniel", last_name: "Marsh", grade: "2", class_group: "2-Marsh", status: "waiting" },
  { id: "m17", first_name: "Gianna", last_name: "Marchetti", grade: "2", class_group: "2-Marsh", status: "waiting" },
  { id: "m18", first_name: "Owen", last_name: "Brooks", grade: "2", class_group: "2-Marsh", status: "arrived" },
  { id: "m19", first_name: "Ivy", last_name: "Brook", grade: "3", class_group: "3-Nunez", status: "waiting" },
  { id: "m20", first_name: "An", last_name: "Nguyen", grade: "3", class_group: "3-Nunez", status: "waiting" },
  { id: "m21", first_name: "Bao", last_name: "Nguyen", grade: "3", class_group: "3-Nunez", status: "arrived" },
  { id: "m22", first_name: "Carlos", last_name: "Nunez", grade: "3", class_group: "3-Nunez", status: "waiting" },
  { id: "m23", first_name: "Isabela", last_name: "Nunes", grade: "3", class_group: "3-Nunez", status: "waiting" },
  { id: "m24", first_name: "Freya", last_name: "van der Berg", grade: "3", class_group: "3-Nunez", status: "arrived" },
  { id: "m25", first_name: "Liam", last_name: "O'Brien", grade: "3", class_group: "3-Nunez", status: "waiting" },
  { id: "m26", first_name: "Rosa", last_name: "D'Angelo", grade: "3", class_group: "3-Nunez", status: "waiting" },
];

function toStudent(seed: MockSeed): Student {
  return {
    id: seed.id,
    first_name: seed.first_name,
    last_name: seed.last_name,
    aliases: [],
    grade: seed.grade,
    class_group: seed.class_group,
    status: seed.status,
    arrived_at: seed.status === "arrived" ? BASE_TIME : null,
    updated_at: BASE_TIME,
  };
}

/** The full synthetic roster, ready to pass straight to `applySnapshot`. */
export function mockRoster(): Student[] {
  return SEEDS.map(toStudent);
}

/**
 * Ids of a couple of still-waiting mock students, in roster order, for the
 * `?flash=1` preview to walk from waiting to arrived one at a time -- enough
 * to see several tiles flash without the chime-coalescing window collapsing
 * them into a single sound in a way that would look wrong on screen.
 */
export function mockArrivalOrder(): string[] {
  return SEEDS.filter((seed) => seed.status === "waiting")
    .slice(0, 3)
    .map((seed) => seed.id);
}
