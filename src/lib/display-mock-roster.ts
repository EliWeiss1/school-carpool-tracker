import { CLASS_GROUPS } from "@/lib/classes";
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
 * 105 students (7 classes x 15), matching the real seeded roster's scale --
 * the dense "all classes" view and its tile-size floor were tuned against
 * this count, not the old 26-student mock. Names echo the flavour of
 * `supabase/seed/roster.ts` (Jewish names, confusable-surname clusters, a mix
 * of long and very short surnames) without importing it -- that file lives
 * under `supabase/` for a Deno-and-Vitest audience, not the browser bundle.
 */

const BASE_TIME = "2026-09-02T15:00:00.000Z";

/** One cycle of 15 name pairs, varied in length (short "Oz"/"Tal" through long "Steinberg"/"Rosenthal") so every class gets the same spread of tile widths to render. */
const NAME_POOL: Array<[string, string]> = [
  ["Maya", "Cohen"],
  ["Ari", "Kohen"],
  ["Noa", "Koen"],
  ["Eitan", "Levi"],
  ["Shira", "Levy"],
  ["Mira", "Stein"],
  ["Talia", "Klein"],
  ["Ezra", "Shapiro"],
  ["Liora", "Rosen"],
  ["Dov", "Rosenberg"],
  ["Naomi", "Weiss"],
  ["Judah", "Berg"],
  ["Rivka", "Steinberg"],
  ["Miriam", "Rosenthal"],
  ["Rebekah", "Tal"],
];

interface MockSeed {
  id: string;
  first_name: string;
  last_name: string;
  class_group: string;
  status: Student["status"];
}

const SEEDS: MockSeed[] = CLASS_GROUPS.flatMap((classGroup, classIndex) =>
  NAME_POOL.map(([firstName, lastName], nameIndex) => {
    const seq = classIndex * NAME_POOL.length + nameIndex;
    return {
      id: `m${String(seq + 1).padStart(3, "0")}`,
      first_name: firstName,
      last_name: lastName,
      class_group: classGroup,
      // Roughly a third arrived, spread across the roster rather than
      // clustered in one class, so the flash/chime preview and the
      // red/green mix both look realistic.
      status: seq % 3 === 0 ? "arrived" : "waiting",
    };
  }),
);

function toStudent(seed: MockSeed): Student {
  return {
    id: seed.id,
    first_name: seed.first_name,
    last_name: seed.last_name,
    aliases: [],
    class_group: seed.class_group,
    status: seed.status,
    arrived_at: seed.status === "arrived" ? BASE_TIME : null,
    updated_at: BASE_TIME,
    carpool_id: null,
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
