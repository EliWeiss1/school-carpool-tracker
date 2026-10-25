import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  connectBoard,
  createFetchSequencer,
  MEMBERSHIP_REFETCH_DEBOUNCE_MS,
  type BoardClient,
} from "./display-subscription";
import type { StudentChangePayload } from "./realtime-reconcile";

type Listener = (payload: never) => void;

/** A stand-in for supabase-js's channel: records `.on` filters, lets a test fire events. */
function fakeClient() {
  const listeners = new Map<string, Listener>();
  let onStatus: (status: string) => void = () => {};
  const removed: unknown[] = [];

  const channel = {
    on(_type: string, filter: { table: string }, listener: Listener) {
      listeners.set(filter.table, listener);
      return channel;
    },
    subscribe(callback: (status: string) => void) {
      onStatus = callback;
      return channel;
    },
  };
  const client: BoardClient = {
    channel: () => channel,
    removeChannel: (c) => {
      removed.push(c);
      return Promise.resolve("ok");
    },
  };
  return {
    client,
    removed,
    fire: (table: string, payload: unknown) =>
      listeners.get(table)?.(payload as never),
    status: (s: string) => onStatus(s),
    tables: () => [...listeners.keys()].sort(),
  };
}

const studentRow = {
  id: "s1",
  first_name: "A",
  last_name: "B",
  aliases: [],
  status: "arrived",
  arrived_at: null,
  updated_at: "2026-09-02T12:00:00.000Z",
  carpool_id: null,
};

function connect() {
  const fake = fakeClient();
  const onStudentChange = vi.fn<(p: StudentChangePayload) => void>();
  const onSnapshotNeeded = vi.fn();
  const onConnectionError = vi.fn();
  const disconnect = connectBoard(fake.client, {
    onStudentChange,
    onSnapshotNeeded,
    onConnectionError,
  });
  return { fake, onStudentChange, onSnapshotNeeded, onConnectionError, disconnect };
}

describe("connectBoard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("listens to both students and student_classes", () => {
    const { fake } = connect();
    expect(fake.tables()).toEqual(["student_classes", "students"]);
  });

  it("fetches a snapshot immediately each time the channel reports SUBSCRIBED", () => {
    const { fake, onSnapshotNeeded } = connect();
    fake.status("SUBSCRIBED");
    expect(onSnapshotNeeded).toHaveBeenCalledTimes(1);
    fake.status("SUBSCRIBED");
    expect(onSnapshotNeeded).toHaveBeenCalledTimes(2);
  });

  it("reports a channel error or timeout", () => {
    const { fake, onConnectionError } = connect();
    fake.status("CHANNEL_ERROR");
    fake.status("TIMED_OUT");
    expect(onConnectionError).toHaveBeenCalledTimes(2);
  });

  it("passes a students change through as a change payload", () => {
    const { fake, onStudentChange } = connect();
    fake.fire("students", { eventType: "UPDATE", new: studentRow, old: {} });
    expect(onStudentChange).toHaveBeenCalledWith({
      eventType: "UPDATE",
      new: studentRow,
      old: null,
    });
  });

  it("a student_classes event triggers one debounced refetch and no arrival", () => {
    const { fake, onStudentChange, onSnapshotNeeded } = connect();

    // A bulk membership edit lands as a burst of row events.
    fake.fire("student_classes", { eventType: "INSERT", new: {}, old: {} });
    fake.fire("student_classes", { eventType: "DELETE", new: {}, old: {} });
    fake.fire("student_classes", { eventType: "INSERT", new: {}, old: {} });
    expect(onSnapshotNeeded).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MEMBERSHIP_REFETCH_DEBOUNCE_MS);

    expect(onSnapshotNeeded).toHaveBeenCalledTimes(1);
    expect(onStudentChange).not.toHaveBeenCalled();
  });

  it("clears a pending refetch on disconnect", () => {
    const { fake, disconnect, onSnapshotNeeded } = connect();
    fake.fire("student_classes", { eventType: "INSERT", new: {}, old: {} });
    disconnect();

    vi.advanceTimersByTime(MEMBERSHIP_REFETCH_DEBOUNCE_MS * 2);

    expect(onSnapshotNeeded).not.toHaveBeenCalled();
    expect(fake.removed).toHaveLength(1);
  });

  it("ignores a status callback that arrives after disconnect", () => {
    const { fake, disconnect, onSnapshotNeeded } = connect();
    disconnect();
    fake.status("SUBSCRIBED");
    expect(onSnapshotNeeded).not.toHaveBeenCalled();
  });
});

describe("createFetchSequencer", () => {
  it("applies fetches that resolve in the order they started", () => {
    const seq = createFetchSequencer();
    const first = seq.begin();
    const second = seq.begin();
    expect(seq.shouldApply(first)).toBe(true);
    expect(seq.shouldApply(second)).toBe(true);
  });

  it("drops an older fetch that resolves after a newer one was applied", () => {
    const seq = createFetchSequencer();
    const older = seq.begin();
    const newer = seq.begin();
    expect(seq.shouldApply(newer)).toBe(true);
    expect(seq.shouldApply(older)).toBe(false);
  });

  it("applies a single fetch", () => {
    const seq = createFetchSequencer();
    expect(seq.shouldApply(seq.begin())).toBe(true);
  });

  it("applies a slow first load when nothing newer has been applied", () => {
    // A newer fetch that started but never applied (failed, or still in
    // flight) must not make the first load's good data get thrown away.
    const seq = createFetchSequencer();
    const firstLoad = seq.begin();
    seq.begin();
    expect(seq.shouldApply(firstLoad)).toBe(true);
  });
});
