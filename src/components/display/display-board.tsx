"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { BoardGrid } from "@/components/display/board-grid";
import { SoundToggle } from "@/components/display/sound-toggle";
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { createChimeCoalescer, createChimePlayer } from "@/lib/display-chime";
import { mockArrivalOrder, mockRoster } from "@/lib/display-mock-roster";
import {
  applySnapshot,
  reconcile,
  type DisplayRoster,
  type StudentChangePayload,
} from "@/lib/realtime-reconcile";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Student } from "@/types/db";

/**
 * The realtime status grid. Public, unauthenticated, read-only -- the anon
 * key grants `select` on `students` and nothing else (see the migration),
 * which is exactly the access this screen needs.
 *
 * Everything genuinely tricky about a realtime UI is delegated to
 * `realtime-reconcile.ts` (pure, unit-tested) and `display-chime.ts` (the
 * coalescing window is pure and unit-tested; only the `HTMLAudioElement`
 * wrapper is not, because it cannot be under Vitest's node environment).
 * This component is glue: it owns the Supabase subscription, the two pieces
 * of state that cannot be pure (which tiles are mid-flash, whether sound is
 * blocked), and translating the wire payload shape into the one
 * `realtime-reconcile.ts` actually understands.
 */

/** Two 1.6s animation iterations, plus a small margin -- see tailwind.config.ts. */
const FLASH_DURATION_MS = 3400;

/** Several children can arrive in the same second; this is the floor between two audible chimes. */
const CHIME_COALESCE_WINDOW_MS = 2000;

type ConnectionState = "connecting" | "live" | "error";

/**
 * `students` carries FULL replica identity, so a genuine payload always has a
 * complete row in `old` for UPDATE/DELETE -- but the wire *type* only
 * promises `Partial<T>`, because supabase-js has no way to know a given
 * table's replica identity. This is the one place that gap is bridged, with a
 * runtime check rather than a blind cast.
 */
function fullRowOrNull(
  row: Partial<Student> | Record<string, never>,
): Student | null {
  return "id" in row && "status" in row && "updated_at" in row
    ? (row as Student)
    : null;
}

function toChangePayload(
  payload: RealtimePostgresChangesPayload<Student>,
): StudentChangePayload | null {
  if (payload.eventType === "DELETE") {
    const old = fullRowOrNull(payload.old);
    // Cannot happen given REPLICA IDENTITY FULL on students, but a payload
    // with no identifiable row is not something this board can reconcile --
    // silently dropping one malformed delete beats crashing the board.
    if (!old) return null;
    return { eventType: "DELETE", new: null, old };
  }

  return {
    eventType: payload.eventType,
    new: payload.new,
    old: fullRowOrNull(payload.old),
  };
}

export function DisplayBoard({
  mockMode = false,
  mockEmpty = false,
  flashPreview = false,
}: {
  /** Dev-only: seeds synthetic data instead of calling Supabase. Gated in src/app/display/page.tsx so it can never activate in production. */
  mockMode?: boolean;
  /** Dev-only, requires mockMode: seeds zero students instead of the sample roster, so the empty state can be screenshotted too. */
  mockEmpty?: boolean;
  /** Dev-only: walks a few mock students from waiting to arrived shortly after load, so the flash + chime can actually be screenshotted with no live backend. */
  flashPreview?: boolean;
}) {
  const [roster, setRoster] = useState<DisplayRoster>({});
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [configError, setConfigError] = useState<string | null>(null);
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());
  const [soundBlocked, setSoundBlocked] = useState(false);

  const coalescerRef = useRef(
    createChimeCoalescer({ windowMs: CHIME_COALESCE_WINDOW_MS }),
  );
  const playerRef = useRef(createChimePlayer("/chime.wav"));
  const flashTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );

  /**
   * Flashes the given tiles and fires at most one chime for the whole batch.
   * The chime is driven directly by `arrivals` from `reconcile`, never by an
   * `animationend` listener -- so `prefers-reduced-motion`, which collapses
   * the CSS animation to near-zero duration, cannot silence it as a side
   * effect. Read the phase 5 report for why that separation matters.
   */
  const handleArrivals = useCallback((ids: string[]) => {
    if (ids.length === 0) return;

    setFlashingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });

    for (const id of ids) {
      const existing = flashTimeoutsRef.current.get(id);
      if (existing) clearTimeout(existing);

      const timeout = setTimeout(() => {
        setFlashingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        flashTimeoutsRef.current.delete(id);
      }, FLASH_DURATION_MS);

      flashTimeoutsRef.current.set(id, timeout);
    }

    if (coalescerRef.current.notify()) {
      void playerRef.current.play().then((played) => setSoundBlocked(!played));
    }
  }, []);

  // --- Dev-only preview: no Supabase project is reachable from this
  // environment, so this is the path actually used to build and screenshot
  // the board. See src/lib/display-mock-roster.ts. ---
  useEffect(() => {
    if (!mockMode) return;

    setRoster(applySnapshot({}, mockEmpty ? [] : mockRoster()));
    setConnection("live");
    if (!flashPreview || mockEmpty) return;

    const ids = mockArrivalOrder();
    const timeouts = ids.map((id, index) =>
      setTimeout(
        () => {
          setRoster((prev) => {
            const current = prev[id];
            if (!current) return prev;
            const now = new Date().toISOString();
            const payload: StudentChangePayload = {
              eventType: "UPDATE",
              new: {
                ...current,
                status: "arrived",
                arrived_at: now,
                updated_at: now,
              },
              old: current,
            };
            const result = reconcile(prev, payload);
            handleArrivals(result.arrivals);
            return result.roster;
          });
        },
        900 + index * 260,
      ),
    );

    return () => timeouts.forEach(clearTimeout);
  }, [mockMode, mockEmpty, flashPreview, handleArrivals]);

  // --- Live mode. Subscribe first, then fetch: the channel is opened before
  // any snapshot query runs, so a change that lands in the gap between
  // opening the socket and the fetch resolving is not lost -- it is just an
  // UPDATE payload reconciled against a roster that has not been seeded yet,
  // which `applySnapshot`'s freshness check then merges correctly whichever
  // order the two actually resolve in.
  //
  // Every time the channel reports SUBSCRIBED -- the first connection and
  // every reconnect after a dropped socket -- a fresh fetch runs. That is
  // what makes a reconnect refetch current state rather than wait for the
  // next event. ---
  useEffect(() => {
    if (mockMode) return;

    let client: ReturnType<typeof getBrowserClient>;
    try {
      client = getBrowserClient();
    } catch (error: unknown) {
      // getBrowserClient() throws env.ts's message, written for a developer
      // reading the repo ("Copy .env.example to .env.local..."). Nobody
      // looking at a hallway TV can act on that -- log it there for whoever
      // eventually opens dev tools, and show the board a sentence a staff
      // member can actually act on instead.
      if (error instanceof Error) console.error(error);
      setConfigError(
        "This screen isn't set up yet. Ask the office to check the Supabase settings.",
      );
      setConnection("error");
      return;
    }

    let cancelled = false;

    async function fetchSnapshot() {
      const { data, error } = await client.from("students").select("*");
      if (cancelled) return;
      if (error) {
        setConnection("error");
        return;
      }
      setRoster((prev) => applySnapshot(prev, data ?? []));
      setConnection("live");
    }

    const channel = client
      .channel("display-students")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "students" },
        (payload: RealtimePostgresChangesPayload<Student>) => {
          const changePayload = toChangePayload(payload);
          if (!changePayload) return;
          setRoster((prev) => {
            const result = reconcile(prev, changePayload);
            handleArrivals(result.arrivals);
            return result.roster;
          });
        },
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          void fetchSnapshot();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("error");
        }
      });

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [mockMode, handleArrivals]);

  useEffect(() => {
    const timeouts = flashTimeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) clearTimeout(timeout);
    };
  }, []);

  const students = useMemo(
    () =>
      Object.values(roster).sort((a, b) => {
        const byLastName = a.last_name.localeCompare(b.last_name);
        return byLastName !== 0
          ? byLastName
          : a.first_name.localeCompare(b.first_name);
      }),
    [roster],
  );

  const waitingCount = students.filter((s) => s.status === "waiting").length;
  const arrivedCount = students.length - waitingCount;

  function enableSound() {
    void playerRef.current.play().then((played) => setSoundBlocked(!played));
  }

  return (
    // h-screen, not min-h-screen: a board screwed to a wall is exactly one
    // screen tall and nobody is going to scroll it. A definite height is also
    // what lets the grid's `1fr` rows divide the space instead of resolving to
    // their content -- with min-h-screen the last row simply fell off a 1080p
    // display. If a roster is long enough that the rows hit their legibility
    // floor, the grid itself scrolls; the header stays put.
    <main className="flex h-screen flex-col overflow-hidden bg-ink">
      <PageHeader
        eyebrow="Pickup line · live"
        title="Display"
        action={
          <div className="flex items-center gap-3">
            {soundBlocked && <SoundToggle onEnable={enableSound} />}
            {!configError && (
              <p className="whitespace-nowrap font-mono text-xs">
                <span className="text-waiting-screen">
                  {waitingCount} waiting
                </span>
                <span className="text-white/40"> · </span>
                <span className="text-arrived-screen">
                  {arrivedCount} arrived
                </span>
              </p>
            )}
          </div>
        }
      />

      {/* aria-live region for arrivals: /display is a wall-mounted TV, not a
          screen reader stop, but a stray screen reader user should still be
          told who just arrived, not left to infer it from a colour change. */}
      <p aria-live="polite" className="sr-only">
        {students
          .filter((student) => flashingIds.has(student.id))
          .map(
            (student) => `${student.first_name} ${student.last_name} arrived`,
          )
          .join(". ")}
      </p>

      {configError && (
        <div className="p-4 sm:p-6">
          <ErrorBanner message={configError} />
        </div>
      )}

      {!configError && connection === "connecting" && (
        <div className="p-4 sm:p-6">
          <LoadingState label="Connecting to the pickup board" rows={6} />
        </div>
      )}

      {!configError && connection === "error" && (
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <ErrorBanner
            tone="warning"
            message={
              students.length > 0
                ? "Live connection lost. Showing the last known status while it reconnects."
                : "The board is not reachable right now. It will pick back up on its own once the connection returns."
            }
          />
        </div>
      )}

      {!configError && connection === "live" && students.length === 0 && (
        <div className="p-4 sm:p-6">
          <EmptyState
            title="No students yet"
            hint="Add students in Admin to see them here."
          />
        </div>
      )}

      {!configError && students.length > 0 && (
        <BoardGrid students={students} flashingIds={flashingIds} />
      )}
    </main>
  );
}
