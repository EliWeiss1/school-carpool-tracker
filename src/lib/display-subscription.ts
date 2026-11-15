import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import type { StudentChangePayload } from "@/lib/realtime-reconcile";
import type { Student } from "@/types/db";

/**
 * The realtime wiring for `/display`, kept out of the component so the one
 * rule that is easy to get wrong -- "a class-membership change refetches and
 * never counts as an arrival" -- is unit-tested with a fake client.
 *
 * Two tables are watched:
 *
 * - `students`: row changes go to `onStudentChange`, which the board reduces
 *   with `reconcile` (and so may flash and chime).
 * - `student_classes`: membership changes carry no status, so they can never
 *   be an arrival. Each one just schedules a snapshot refetch, debounced
 *   because a bulk edit in /admin lands as a burst of row events and one
 *   refetch after the burst is all the board needs.
 */

/** Quiet period after the last membership event before refetching. */
export const MEMBERSHIP_REFETCH_DEBOUNCE_MS = 300;

/** The slice of a supabase-js realtime channel this module uses. */
interface ChannelLike {
  on(
    type: "postgres_changes",
    filter: {
      event: "*";
      schema: "public";
      table: string;
      filter?: string;
    },
    listener: (payload: never) => void,
  ): ChannelLike;
  subscribe(callback: (status: string) => void): ChannelLike;
}

/** The slice of the supabase-js client this module uses (also what tests fake). */
export interface BoardClient {
  channel(name: string): ChannelLike;
  removeChannel(channel: never): Promise<unknown>;
}

export interface BoardHandlers {
  /** A `students` row changed; reduce it into the roster. */
  onStudentChange(payload: StudentChangePayload): void;
  /** Fetch the full roster: on every (re)connect and after membership edits. */
  onSnapshotNeeded(): void;
  /** The channel errored or timed out. */
  onConnectionError(): void;
}

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

export function toChangePayload(
  payload: RealtimePostgresChangesPayload<Student>,
): StudentChangePayload | null {
  if (payload.eventType === "DELETE") {
    // Postgres Changes sends only the primary key for a delete, so demanding a
    // full row here used to drop every live delete. The id is all `reconcile`
    // needs: it removes a tile it holds and ignores an id it does not (which
    // is how another school's delete, unfilterable on the wire, is shrugged
    // off). A payload with no id at all cannot be reconciled; dropping that
    // beats crashing the board.
    const id = (payload.old as { id?: unknown }).id;
    if (typeof id !== "string") return null;
    return { eventType: "DELETE", new: null, old: { id } };
  }

  return {
    eventType: payload.eventType,
    new: payload.new,
    old: fullRowOrNull(payload.old),
  };
}

/**
 * Opens the board's channel. Subscribe first, then fetch: the channel is open
 * before any snapshot runs, so a change in the gap is reconciled rather than
 * lost. Every SUBSCRIBED (first connect and each reconnect) fetches again,
 * which is what makes a reconnect refetch current state instead of waiting for
 * the next event. Returns a disconnect function that also cancels a pending
 * membership refetch.
 */
export function connectBoard(
  client: BoardClient,
  handlers: BoardHandlers,
  schoolId: string | null = null,
): () => void {
  let closed = false;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleMembershipRefetch() {
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      if (!closed) handlers.onSnapshotNeeded();
    }, MEMBERSHIP_REFETCH_DEBOUNCE_MS);
  }

  // With a school, both subscriptions carry a server-side row filter and the
  // channel name is per school so two boards never share one channel. Deletes
  // cannot be filtered by Postgres Changes; `reconcile` ignores ids the board
  // does not hold. Without a school this is exactly the legacy wiring.
  const scope = schoolId === null ? {} : { filter: `school_id=eq.${schoolId}` };
  const channelName =
    schoolId === null ? "display-students" : `display-students:${schoolId}`;

  const channel = client
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "students", ...scope },
      (payload: RealtimePostgresChangesPayload<Student>) => {
        if (closed) return;
        const change = toChangePayload(payload);
        if (change) handlers.onStudentChange(change);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "student_classes", ...scope },
      () => {
        if (!closed) scheduleMembershipRefetch();
      },
    )
    .subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        handlers.onSnapshotNeeded();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        handlers.onConnectionError();
      }
    });

  return () => {
    closed = true;
    if (refetchTimer) clearTimeout(refetchTimer);
    refetchTimer = null;
    void client.removeChannel(channel as never);
  };
}

/** Orders overlapping snapshot fetches; see `createFetchSequencer`. */
export interface FetchSequencer {
  /** Call as a fetch starts; hand the token back to `shouldApply`. */
  begin(): number;
  /** Call once the fetch resolves: true means apply it, false means drop it. */
  shouldApply(token: number): boolean;
}

/**
 * Guards against two overlapping snapshot fetches resolving out of order (a
 * reconnect's fetch and a debounced membership refetch, say). The snapshot's
 * class memberships win unconditionally in `applySnapshot`, so an older
 * response landing last would leave stale memberships on the board until the
 * next membership event. A result is applied only if no NEWER fetch has
 * already been applied -- tracking what was applied, not what was started,
 * so a slow first load is still used when the fetch after it never lands.
 */
export function createFetchSequencer(): FetchSequencer {
  let started = 0;
  let latestApplied = 0;
  return {
    begin() {
      started += 1;
      return started;
    },
    shouldApply(token) {
      if (token <= latestApplied) return false;
      latestApplied = token;
      return true;
    },
  };
}
