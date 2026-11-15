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
  type AccessDecision,
  decideAccess,
  type NeedsCodeReason,
  officeLoginHref,
  rememberLastSchool,
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

/** Reads this device's own access. Never reveals the school before it is proven. */
async function resolveDevice(slug: string, need: GateNeed): Promise<GateState> {
  const client = getDeviceClient();
  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData.session;
  // No session means this browser was never paired: nothing to look up.
  if (!session) return { phase: "code", reason: "not-connected" };

  // RLS shows a device only the school it is paired with, so a missing row
  // looks the same for "not paired" and "no such school".
  const schoolResult = await client
    .from("schools")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (schoolResult.error) return { phase: "error", message: UNREACHABLE };
  const school = schoolResult.data as SchoolSummary | null;
  if (!school) return { phase: "code", reason: "not-connected" };

  const deviceResult = await client
    .from("school_devices")
    .select("can_announce, can_display")
    .eq("school_id", school.id)
    .maybeSingle();
  if (deviceResult.error) return { phase: "error", message: UNREACHABLE };
  const row = deviceResult.data as Pick<
    SchoolDevice,
    "can_announce" | "can_display"
  > | null;

  const decision = decideAccess(
    {
      isOffice: false,
      device: row && {
        canAnnounce: row.can_announce,
        canDisplay: row.can_display,
      },
    },
    need,
  );
  return stateFromDecision(decision, school, client, session);
}

function stateFromDecision(
  decision: AccessDecision,
  school: SchoolSummary,
  client: SupabaseClient,
  session: TokenSession | null,
): GateState {
  switch (decision.kind) {
    case "device":
      return {
        phase: "ready",
        client,
        session,
        info: {
          kind: "device",
          canAnnounce: decision.canAnnounce,
          canDisplay: decision.canDisplay,
          school,
        },
      };
    case "needs-code":
      return { phase: "code", reason: decision.reason };
    default:
      // Office decisions never come through here (the office branch builds its
      // own state), and a device cannot be asked for an office screen.
      return { phase: "code", reason: "not-connected" };
  }
}

/** The same access, so a silent re-check does not remount the screen. */
function sameAccess(a: GateState, b: GateState): boolean {
  if (a.phase !== "ready" || b.phase !== "ready") return false;
  return (
    a.info.school.id === b.info.school.id &&
    a.info.canAnnounce === b.info.canAnnounce &&
    a.info.canDisplay === b.info.canDisplay
  );
}

/**
 * Stands in front of a school's screens and decides which session they run
 * under. An office login (found by the server page) needs no code; anyone else
 * is a device, which shows the code prompt until the office's code has paired
 * it. Like `PinGate` it only decides what is on screen; the Edge Functions and
 * row-level security check access on every request.
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
    // The hub needs no token, so an office visitor sees it with no wait.
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
      if (office) {
        const client = getOfficeBrowserClient();
        const { data } = await client.auth.getSession();
        if (!data.session) {
          // The cookie lapsed since the server rendered: sign in again.
          window.location.assign(
            officeLoginHref(window.location.pathname + window.location.search),
          );
          return { phase: "loading" };
        }
        return {
          phase: "ready",
          client,
          session: data.session,
          info: {
            kind: "office",
            canAnnounce: true,
            canDisplay: true,
            school: office,
          },
        };
      }
      if (
        decideAccess({ isOffice: false, device: null }, need).kind ===
        "needs-office-login"
      ) {
        // Office screens never take a device: send them to sign in.
        window.location.assign(
          officeLoginHref(window.location.pathname + window.location.search),
        );
        return { phase: "loading" };
      }
      return await resolveDevice(slug, need);
    } catch {
      return { phase: "error", message: UNREACHABLE };
    }
  }, [office, slug, need]);

  // First resolve, and again when the gate is asked to (retry, connected).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (office && need === "hub") return;
    let cancelled = false;
    void resolve().then((next) => {
      if (!cancelled)
        setState((prev) => (sameAccess(prev, next) ? prev : next));
    });
    return () => {
      cancelled = true;
    };
  }, [resolve, attempt, office, need]);

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
