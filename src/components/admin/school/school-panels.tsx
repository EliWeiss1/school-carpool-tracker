"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner } from "@/components/ui/error-banner";
import { LoadingState } from "@/components/ui/loading-state";
import { deriveChecklist, checklistComplete } from "@/lib/school-checklist";
import { type VoiceUsage, voiceUsageSentence } from "@/lib/voice-usage";
import {
  type CodesResponse,
  type SchoolApiClient,
  type SchoolDeviceInfo,
  type SetCodeInput,
  type SetCodeResponse,
  schoolApi,
} from "@/lib/school-api";
import {
  isSignedOutError,
  messageFrom,
  schoolAuthFrom,
  SIGNED_OUT_MESSAGE,
} from "@/lib/school-session-auth";
import {
  formFromRow,
  type SettingsForm,
  type SettingsPayload,
  type SettingsRow,
} from "@/lib/school-settings-form";
import {
  type SchoolSummary,
  type StaffSession,
  useSchoolScope,
} from "@/lib/screen-access";

import { type ChangeCodeRequest, type SingleTarget } from "./code-dialogs";
import { DevicesCard } from "./devices-card";
import { GettingStarted } from "./getting-started";
import { PanelCard } from "./panel-parts";
import { SettingsCard } from "./settings-card";

/**
 * The calls these panels make. `setCode` also takes `code: null` (the server's
 * way to clear a code), which `SetCodeInput` does not yet allow.
 */
export interface SchoolPanelsApi {
  getCodes: SchoolApiClient["getCodes"];
  listDevices: SchoolApiClient["listDevices"];
  disconnectDevice: SchoolApiClient["disconnectDevice"];
  updateSettings: SchoolApiClient["updateSettings"];
  setCode(
    input: Omit<SetCodeInput, "code"> & { code: string | null },
  ): Promise<SetCodeResponse>;
  /** Optional so a preview or test can leave it out; the line is then hidden. */
  voiceUsage?: SchoolApiClient["voiceUsage"];
}

export interface SchoolPanelsProps {
  session: StaffSession;
  school: SchoolSummary;
  counts: { classes: number; students: number };
  /** For previews and tests. Defaults to the real Edge Function client. */
  api?: SchoolPanelsApi;
  /** Reads the school's settings. Defaults to the scope's Supabase client. */
  loadSettings?: (schoolId: string) => Promise<SettingsRow>;
}

interface Loaded {
  codes: CodesResponse;
  devices: SchoolDeviceInfo[];
  /** Null when it could not be read: the panels still work without it. */
  voice: VoiceUsage | null;
}

/**
 * The office's panels on the admin screen of a school route: getting started,
 * devices, and settings. Credentials are read from the session at the moment
 * of each request and never held, because they carry an access token.
 */
export function SchoolPanels({
  session,
  school,
  counts,
  api = schoolApi,
  loadSettings,
}: SchoolPanelsProps) {
  const scope = useSchoolScope();
  // The parent may hand over a fresh object every render. Reading the latest
  // through a ref keeps the load below from re-running (and refetching) on each.
  const live = useRef({ session, api, scope, loadSettings });
  live.current = { session, api, scope, loadSettings };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saved, setSaved] = useState<SettingsForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  /** Run a call with fresh credentials; a dead session becomes the notice. */
  const withAuth = useCallback(
    async <T,>(
      call: (
        auth: NonNullable<ReturnType<typeof schoolAuthFrom>>,
      ) => Promise<T>,
    ): Promise<T> => {
      const auth = schoolAuthFrom(live.current.session.credentials());
      if (auth === null) {
        setSignedOut(true);
        throw new Error(SIGNED_OUT_MESSAGE);
      }
      try {
        return await call(auth);
      } catch (caught: unknown) {
        if (isSignedOutError(caught)) setSignedOut(true);
        throw caught;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    const { api } = live.current;
    const [codes, list, voice] = await withAuth((auth) =>
      Promise.all([
        api.getCodes(auth),
        api.listDevices(auth),
        // A readout, not a control: if it fails, show everything else.
        api.voiceUsage ? api.voiceUsage(auth).catch(() => null) : null,
      ]),
    );
    setLoaded({ codes, devices: list.devices, voice });
  }, [withAuth]);

  useEffect(() => {
    let cancelled = false;
    const read =
      live.current.loadSettings ??
      (async (schoolId: string): Promise<SettingsRow> => {
        const { data, error } = await live.current.scope
          .supabase()
          .from("schools")
          .select("name, timezone, reset_hour, reset_days")
          .eq("id", schoolId)
          .single();
        if (error || data === null) {
          throw new Error(
            "Could not load your school's settings. Reload the page.",
          );
        }
        return data;
      });

    setLoadError(null);
    Promise.all([refresh(), read(school.id)])
      .then(([, row]) => {
        if (!cancelled) setSaved(formFromRow(row));
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoadError(
            messageFrom(
              caught,
              "Could not load your school's panels. Reload the page.",
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, school.id]);

  if (signedOut) {
    return <ErrorBanner message={SIGNED_OUT_MESSAGE} />;
  }
  if (loadError !== null) {
    return <ErrorBanner message={loadError} />;
  }
  if (loaded === null || saved === null) {
    return (
      <LoadingState
        label="Loading your school's devices and settings"
        rows={3}
      />
    );
  }

  const checklist = deriveChecklist({
    classes: counts.classes,
    students: counts.students,
    announceCodeSet: loaded.codes.announceCode !== null,
    displayCodeSet: loaded.codes.displayCode !== null,
    devices: loaded.devices.length,
  });

  async function changeCode(request: ChangeCodeRequest) {
    await withAuth((auth) => live.current.api.setCode({ ...auth, ...request }));
    await refresh();
  }

  async function turnOff(target: SingleTarget) {
    await withAuth((auth) =>
      live.current.api.setCode({ ...auth, which: target, code: null }),
    );
    await refresh();
  }

  async function disconnect(device: SchoolDeviceInfo) {
    await withAuth((auth) =>
      live.current.api.disconnectDevice({ ...auth, deviceRowId: device.id }),
    );
    await refresh();
  }

  async function saveSettings(changes: SettingsPayload) {
    const { school: next } = await withAuth((auth) =>
      live.current.api.updateSettings({ ...auth, ...changes }),
    );
    setSaved({
      name: next.name,
      timezone: next.timezone,
      resetHour: next.resetHour,
      resetDays: [...next.resetDays].sort((a, b) => a - b),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {!checklistComplete(checklist) && <GettingStarted items={checklist} />}
      <DevicesCard
        slug={school.slug}
        codes={loaded.codes}
        devices={loaded.devices}
        onChangeCode={changeCode}
        onTurnOff={turnOff}
        onDisconnect={disconnect}
      />
      {loaded.voice !== null && (
        <PanelCard id="voice" title="Voice">
          <p className="text-lg text-curb-800">
            {voiceUsageSentence(loaded.voice)}
          </p>
        </PanelCard>
      )}
      <SettingsCard saved={saved} onSave={saveSettings} />
    </div>
  );
}
