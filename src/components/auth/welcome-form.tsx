"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";

import { Field, inputClasses } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApiError } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth-errors";
import { deviceId } from "@/lib/device-id";
import { schoolApi } from "@/lib/school-api";
import { suggestSlug, validateSlug } from "@/lib/school-slug";
import { getOfficeBrowserClient } from "@/lib/supabase/browser";
import {
  defaultTimeZone,
  FALLBACK_TIME_ZONE,
  readBrowserTimeZone,
  readSupportedTimeZones,
  timeZoneOptions,
} from "@/lib/time-zones";

/**
 * Step two: turn the confirmed account into a school. The web address follows
 * the name until the person edits it, then stays put.
 */
export function WelcomeForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState(() => suggestSlug(defaultName));
  const [slugEdited, setSlugEdited] = useState(false);
  // Server and first client render agree on the fallback zone; the browser's
  // real zone is read after mount so hydration never mismatches.
  const [timezone, setTimezone] = useState(FALLBACK_TIME_ZONE);
  const [zones, setZones] = useState<string[] | undefined>(undefined);
  const [nameError, setNameError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const zoneId = useId();

  useEffect(() => {
    setTimezone(defaultTimeZone(readBrowserTimeZone()));
    setZones(readSupportedTimeZones());
  }, []);

  const options = useMemo(
    () => timeZoneOptions({ supported: zones, current: timezone }),
    [zones, timezone],
  );

  function changeName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(suggestSlug(value));
  }

  function changeSlug(value: string) {
    setSlugEdited(true);
    setSlug(value.toLowerCase());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const trimmed = name.trim();
    const nameProblem = trimmed === "" ? "Enter your school's name." : null;
    const slugProblem = validateSlug(slug);
    setNameError(nameProblem);
    setSlugError(slugProblem);
    if (nameProblem || slugProblem) return;

    setPending(true);
    try {
      const auth = getOfficeBrowserClient().auth;
      const { data } = await auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        // The session ended while the form was open.
        router.replace("/login?next=/welcome");
        return;
      }

      const { school } = await schoolApi.createSchool({
        accessToken,
        deviceId: deviceId(),
        name: trimmed,
        slug,
        timezone,
      });
      router.push(`/s/${school.slug}`);
      router.refresh();
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.kind === "conflict") {
        // The address is taken: say so next to the address, where it is fixed.
        setSlugError(caught.message);
      } else if (caught instanceof ApiError) {
        setFormError(caught.message);
      } else {
        setFormError(authErrorMessage(caught));
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Field
        label="School name"
        name="school_name"
        value={name}
        onChange={changeName}
        autoComplete="organization"
        error={nameError}
      />
      <Field
        label="Web address"
        name="slug"
        prefix="/s/"
        value={slug}
        onChange={changeSlug}
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        hint="Staff and devices will open this address."
        error={slugError}
      />

      <div>
        <label
          htmlFor={zoneId}
          className="block font-display text-base font-semibold text-curb-900"
        >
          Time zone
        </label>
        <select
          id={zoneId}
          name="timezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          className={inputClasses(false, "mt-2")}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-curb-600">
          The nightly reset runs on this clock.
        </p>
      </div>

      {formError && <ErrorBanner message={formError} />}

      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Creating school" : "Create school"}
      </Button>
    </form>
  );
}
