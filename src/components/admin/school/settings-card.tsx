"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { cn } from "@/lib/cn";
import {
  buildSettingsPayload,
  DAYS,
  HOURS,
  hourLabel,
  isDirty,
  resetDaysSummary,
  type SettingsForm,
  toggleDay,
  validateSettings,
} from "@/lib/school-settings-form";
import { readSupportedTimeZones, timeZoneOptions } from "@/lib/time-zones";

import { INPUT_CLASS, LABEL_CLASS, PanelCard } from "./panel-parts";

export interface SettingsCardProps {
  /** What the server last confirmed. The Save button compares against it. */
  saved: SettingsForm;
  /** Rejects with an Error carrying the sentence to show. */
  onSave: (changes: ReturnType<typeof buildSettingsPayload>) => Promise<void>;
}

/** The settings form. Sends only the fields that changed. */
export function SettingsCard({ saved, onSave }: SettingsCardProps) {
  const id = useId();
  const [form, setForm] = useState<SettingsForm>(saved);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const zones = useMemo(
    () =>
      timeZoneOptions({
        supported: readSupportedTimeZones(),
        current: form.timezone,
      }),
    [form.timezone],
  );

  const dirty = isDirty(saved, form);
  const problem = validateSettings(form);

  function edit(patch: Partial<SettingsForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setJustSaved(false);
    setError(null);
  }

  async function save() {
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(buildSettingsPayload(saved, form));
      setJustSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setJustSaved(false), 2500);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your changes were not saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelCard
      id="school-settings"
      title="School settings"
      intro="Your school's name, time zone and nightly reset."
    >
      <form
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-name`} className={LABEL_CLASS}>
              School name
            </label>
            <input
              id={`${id}-name`}
              value={form.name}
              onChange={(event) => edit({ name: event.target.value })}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor={`${id}-zone`} className={LABEL_CLASS}>
              Time zone
            </label>
            <select
              id={`${id}-zone`}
              value={form.timezone}
              onChange={(event) => edit({ timezone: event.target.value })}
              className={INPUT_CLASS}
            >
              {zones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-hour`} className={LABEL_CLASS}>
              Reset the board every evening at
            </label>
            <select
              id={`${id}-hour`}
              value={form.resetHour}
              onChange={(event) =>
                edit({ resetHour: Number(event.target.value) })
              }
              className={INPUT_CLASS}
            >
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset>
          <legend className={LABEL_CLASS}>On these evenings</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day) => {
              const on = form.resetDays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={on}
                  aria-label={day.long}
                  onClick={() =>
                    edit({ resetDays: toggleDay(form.resetDays, day.value) })
                  }
                  className={cn(
                    "focus-ring min-h-tap min-w-tap rounded-xl border px-3 font-display font-semibold",
                    "transition-[transform,background-color,border-color,box-shadow] duration-150 ease-spring active:scale-[0.98]",
                    on
                      ? "border-curb-900 bg-curb-900 text-white hover:bg-curb-800 active:bg-curb-700"
                      : "border-curb-300 bg-white text-curb-700 hover:border-curb-400 hover:bg-curb-50 active:bg-curb-100",
                  )}
                >
                  {day.short}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-curb-600" aria-live="polite">
            {resetDaysSummary(form.resetDays)}
          </p>
        </fieldset>

        {error && <ErrorBanner message={error} />}

        <div className="flex items-center gap-4">
          <Button type="submit" variant="primary" disabled={busy || !dirty}>
            {busy ? "Saving…" : justSaved ? "Saved" : "Save changes"}
          </Button>
        </div>
      </form>
    </PanelCard>
  );
}
