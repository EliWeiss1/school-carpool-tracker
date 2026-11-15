"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { CodeGate } from "@/components/school/code-gate";
import { GateFrame } from "@/components/school/gate-frame";
import { ErrorBanner } from "@/components/ui/error-banner";
import { LoadingState } from "@/components/ui/loading-state";
import {
  type AccessIdentity,
  decideAccess,
  decideRecheck,
  type DeviceFacts,
  type DeviceLookup,
  type NeedsCodeReason,
  officeLoginHref,
  RECHECK_INTERVAL_MS,
  rememberLastSchool,
  sameAccess,
  type ScreenNeed,
} from "@/lib/school-access";
import {
  ScreenAccessProvider,
  type SchoolSummary,
  scopedStorageKey,
} from "@/lib/screen-access";
import { getOfficeBrowserClient } from "@/lib/supabase/browser";
import { getDeviceClient } from "@/lib/supabase/device";
import type { TokenSession } from "@/lib/session-token";
import { useSchoolSession } from "@/lib/use-school-session";
import type { Database, SchoolDevice } from "@/types/db";

type GateNeed = ScreenNeed;

/** What the screens under a gate may ask about who is using them. */
export interface SchoolAccessInfo {
  kind: "office" | "device";
  canAnnounce: boolean;
  canDisplay: boolean;
  school: SchoolSummary;
}

const SchoolAccessContext = createContext<SchoolAccessInfo | null>(null);

/** Only valid under a `SchoolGate`. */
export function useSchoolAccess(): SchoolAccessInfo {
  const value = useContext(SchoolAccessContext);
  if (value === null) {
    throw new Error("useSchoolAccess must be used inside a SchoolGate.");
  }
  return value;
}

type GateState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "code"; reason: NeedsCodeReason }
  | {
      phase: "ready";
      info: SchoolAccessInfo;
      client: SupabaseClient;
      session: TokenSession | null;
    };

const UNREACHABLE =
  "Could not reach CarpoolCaller. Check the wifi, then try again.";

type DeviceRead =
  | { status: "no-session" }
  | { status: "failed" }
  | {
      status: "ok";
      client: SupabaseClient;
      session: TokenSession;
      school: SchoolSummary | null;
      device: DeviceFacts | null;
    };

/** This device's own row for a school; a failure is `ok: false`, never "gone". */
async function lookupDeviceRow(
  client: SupabaseClient,
  schoolId: string,
): Promise<DeviceLookup> {
  const result = await client
    .from("school_devices")
    .select("can_announce, can_display")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (result.error) return { ok: false };
  const row = result.data as Pick<
    SchoolDevice,
    "can_announce" | "can_display"
  > | null;
  return {
    ok: true,
    device: row && {
      canAnnounce: row.can_announce,
      canDisplay: row.can_display,
    },
  };
}

/**
 * Reads what this browser's device session may do at the school. `known` is the
 * school the server already found for an office visitor; for anyone else the
 * slug is looked up through the device's own session, where row-level security
 * shows only the school it is paired with (so "not paired" and "no such school"
 * look the same, and the gate never confirms a school exists).
 */
async function readDevice(
  slug: string,
  known: SchoolSummary | null,
): Promise<DeviceRead> {
  const client = getDeviceClient();
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) return { status: "no-session" };

  let school = known;
  if (!school) {
    const found = await client
      .from("schools")
      .select("id, name, slug")
      .eq("slug", slug)
      .maybeSingle();
    if (found.error) return { status: "failed" };
    school = found.data as SchoolSummary | null;
    if (!school) {
      return { status: "ok", client, session, school: null, device: null };
    }
  }

  const lookup = await lookupDeviceRow(client, school.id);
  if (!lookup.ok) return { status: "failed" };
  return { status: "ok", client, session, school, device: lookup.device };
}

function redirectToLogin(): GateState {
  window.location.assign(
    officeLoginHref(window.location.pathname + window.location.search),
  );
  return { phase: "loading" };
}

function identityOf(state: GateState): AccessIdentity | null {
  return state.phase === "ready"
    ? {
        kind: state.info.kind,
        schoolId: state.info.school.id,
        canAnnounce: state.info.canAnnounce,
        canDisplay: state.info.canDisplay,
      }
    : null;
}

/**
 * What a silent re-check does with its answer. An unchanged access keeps the
 * very same state object (no re-render, screen state survives), and a failed
 * look never replaces a working screen with an error: a board keeps showing
 * what it has until it is told otherwise.
 */
function settleState(prev: GateState, next: GateState): GateState {
  if (prev.phase === "ready" && next.phase === "error") return prev;
  const before = identityOf(prev);
  const after = identityOf(next);
  return before && after && sameAccess(before, after) ? prev : next;
}

/**
 * Stands in front of a school's screens and decides which session they run
 * under. A paired device that already has what the screen needs always runs on
 * its own session; an office login (found by the server page) is the fallback,
 * and anyone else gets the code prompt. Like `PinGate` it only decides what is
 * on screen; the Edge Functions and row-level security check every request.
 */
export function SchoolGate({
  slug,
  need,
  office,
  children,
}: {
  slug: string;
  need: GateNeed;
  /** Set by the server page when the signed-in account belongs to this school. */
  office: SchoolSummary | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<GateState>(() =>
    // The hub makes no calls and needs no token, so an office visitor sees it
    // with no wait (and with nothing a sign-out elsewhere could knock off).
    office && need === "hub"
      ? {
          phase: "ready",
          client: getOfficeBrowserClient(),
          session: null,
          info: {
            kind: "office",
            canAnnounce: true,
            canDisplay: true,
            school: office,
          },
        }
      : { phase: "loading" },
  );

  const resolve = useCallback(async (): Promise<GateState> => {
    try {
      const officeClient = office ? getOfficeBrowserClient() : null;
      const officeSession = officeClient
        ? (await officeClient.auth.getSession()).data.session
        : null;
      const device =
        need === "office"
          ? ({ status: "no-session" } as const)
          : await readDevice(slug, office);

      const decision = decideAccess(
        {
          isOffice: office !== null && officeSession !== null,
          device: device.status === "ok" ? device.device : null,
        },
        need,
      );

      switch (decision.kind) {
        case "office":
          if (!office || !officeClient || !officeSession) {
            return redirectToLogin();
          }
          return {
            phase: "ready",
            client: officeClient,
            session: officeSession,
            info: {
              kind: "office",
              canAnnounce: true,
              canDisplay: true,
              school: office,
            },
          };
        case "device":
          if (device.status !== "ok" || !device.school) {
            return { phase: "code", reason: "not-connected" };
          }
          return {
            phase: "ready",
            client: device.client,
            session: device.session,
            info: {
              kind: "device",
              canAnnounce: decision.canAnnounce,
              canDisplay: decision.canDisplay,
              school: device.school,
            },
          };
        case "needs-office-login":
          return redirectToLogin();
        case "needs-code":
          // A lookup that failed is not an answer: say so rather than ask for
          // a code the device may already have.
          return device.status === "failed"
            ? { phase: "error", message: UNREACHABLE }
            : { phase: "code", reason: decision.reason };
      }
    } catch {
      return { phase: "error", message: UNREACHABLE };
    }
  }, [office, slug, need]);

  // First resolve, and again when the gate is asked to (retry, connected, a
  // device's 401, an office sign-out).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (office && need === "hub") return;
    let cancelled = false;
    void resolve().then((next) => {
      if (!cancelled) setState((prev) => settleState(prev, next));
    });
    return () => {
      cancelled = true;
    };
  }, [resolve, attempt, office, need]);

  // A mounted device keeps checking it is still connected. The wall board
  // never calls an Edge Function, so nothing else would notice the office
  // disconnecting it: row-level security would just return no rows and the
  // board would look live with stale tiles.
  const deviceSchoolId =
    state.phase === "ready" && state.info.kind === "device"
      ? state.info.school.id
      : null;
  const deviceClient =
    state.phase === "ready" && state.info.kind === "device"
      ? state.client
      : null;
  useEffect(() => {
    if (!deviceSchoolId || !deviceClient || need === "office") return;
    const screenNeed: Exclude<ScreenNeed, "office"> = need;
    let stopped = false;
    let running = false;

    async function check(client: SupabaseClient, schoolId: string) {
      if (running) return;
      running = true;
      try {
        const lookup = await lookupDeviceRow(client, schoolId);
        if (stopped) return;
        setState((prev) => {
          if (prev.phase !== "ready" || prev.info.kind !== "device")
            return prev;
          const outcome = decideRecheck(screenNeed, prev.info, lookup);
          if (outcome.action === "show-code") {
            return { phase: "code", reason: outcome.reason };
          }
          if (outcome.action === "update") {
            return {
              ...prev,
              info: {
                ...prev.info,
                canAnnounce: outcome.canAnnounce,
                canDisplay: outcome.canDisplay,
              },
            };
          }
          return prev;
        });
      } catch {
        // A failed look changes nothing; the next tick tries again.
      } finally {
        running = false;
      }
    }

    const run = () => void check(deviceClient, deviceSchoolId);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    const timer = window.setInterval(run, RECHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
    };
  }, [deviceSchoolId, deviceClient, need]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  const ground = need === "display" ? "ink" : "light";

  if (state.phase === "loading") {
    return (
      <GateFrame ground={ground}>
        <LoadingState
          label="Checking this device"
          rows={2}
          className="w-full max-w-md"
        />
      </GateFrame>
    );
  }

  if (state.phase === "error") {
    return (
      <GateFrame ground={ground}>
        <div className="w-full max-w-md">
          <ErrorBanner
            message={state.message}
            retry={{
              label: "Try again",
              onClick: () => {
                setState({ phase: "loading" });
                recheck();
              },
            }}
          />
        </div>
      </GateFrame>
    );
  }

  if (state.phase === "code") {
    return (
      <CodeGate
        slug={slug}
        need={need === "office" ? "hub" : need}
        reason={state.reason}
        onConnected={() => {
          setState({ phase: "loading" });
          recheck();
        }}
      />
    );
  }

  return (
    <ConnectedScreens
      client={state.client}
      info={state.info}
      session={state.session}
      onRecheck={recheck}
    >
      {children}
    </ConnectedScreens>
  );
}

/** Mounts the screens' provider once access is known. */
function ConnectedScreens({
  client,
  info,
  session,
  onRecheck,
  children,
}: {
  client: SupabaseClient;
  info: SchoolAccessInfo;
  session: TokenSession | null;
  onRecheck: () => void;
  children: ReactNode;
}) {
  const { school } = info;
  const staff = useSchoolSession({
    client,
    kind: info.kind,
    schoolId: school.id,
    initialSession: session,
    onRecheck,
  });

  // A per-device convenience for the launcher, only after access is proven.
  useEffect(() => {
    try {
      rememberLastSchool(window.localStorage, school.slug);
    } catch {
      // Storage blocked: the launcher falls back to the screen picker.
    }
  }, [school.slug]);

  const value = useMemo(
    () => ({
      session: staff,
      scope: {
        school,
        // The device and office clients are untyped/typed variants of the same
        // client; the screens read only tables in `Database`.
        supabase: () => client as unknown as SupabaseClient<Database>,
        storageKey: (name: string) => scopedStorageKey(school, name),
      },
    }),
    [staff, school, client],
  );

  return (
    <SchoolAccessContext.Provider value={info}>
      <ScreenAccessProvider value={value}>{children}</ScreenAccessProvider>
    </SchoolAccessContext.Provider>
  );
}
