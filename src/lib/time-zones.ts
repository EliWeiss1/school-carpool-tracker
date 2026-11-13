/**
 * The time-zone choices for a school. The browser knows the full IANA list
 * (`Intl.supportedValuesOf`), but older runtimes do not, so there is a short
 * fallback. The person's own zone is always offered and is the default: it is
 * almost certainly where the school is.
 */

export interface TimeZoneOption {
  /** The IANA id sent to the server, e.g. "America/New_York". */
  value: string;
  /** Readable form, e.g. "America / New York". */
  label: string;
}

export const FALLBACK_TIME_ZONE = "America/Los_Angeles";

const FALLBACK_ZONES: readonly string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Asia/Jerusalem",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

function labelFor(zone: string): string {
  return zone.replace(/_/g, " ").replace(/\//g, " / ");
}

export function timeZoneOptions({
  supported,
  current,
}: {
  supported: readonly string[] | undefined;
  current: string;
}): TimeZoneOption[] {
  const zones = new Set(
    supported && supported.length > 0 ? supported : FALLBACK_ZONES,
  );
  if (current !== "") zones.add(current);
  return [...zones]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, label: labelFor(value) }));
}

/** The browser's zone if it reported a usable one, else Pacific. */
export function defaultTimeZone(browserZone: string | undefined): string {
  return browserZone && browserZone !== "" ? browserZone : FALLBACK_TIME_ZONE;
}

/** Browser-only read, kept out of the pure functions above. */
export function readBrowserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The runtime's full IANA list, or undefined on a runtime without it. */
export function readSupportedTimeZones(): string[] | undefined {
  try {
    const intl = Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    };
    return intl.supportedValuesOf?.("timeZone");
  } catch {
    return undefined;
  }
}
