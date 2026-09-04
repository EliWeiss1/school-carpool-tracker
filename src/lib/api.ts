/**
 * The typed client for the three Edge Function endpoints.
 *
 * Every screen in the app talks to the backend through here, for one reason:
 * the failure modes are the interesting part. A staff member standing outside
 * in the rain gets one sentence on screen and has to know what to do next, so
 * this module's job is to turn every HTTP outcome into either a typed payload
 * or an `ApiError` carrying a sentence that is safe to render verbatim.
 *
 * It holds no state, knows nothing about React, and takes its `fetch` through
 * the constructor so the whole surface is testable with no network.
 */

import { functionsBaseUrl, publicEnv } from "@/lib/env";
import type { StatusEventSource, Student, StudentStatus } from "@/types/db";

/* -------------------------------------------------------------------------- */
/* Wire types                                                                  */
/* -------------------------------------------------------------------------- */

/** Which of a student's names the transcript actually looked like. */
export type MatchedVia = "surname" | "alias" | "full_name";

/**
 * The confidence tier drives the whole /announce interaction:
 * - `clear` pre-highlights the first candidate but still requires a tap
 * - `ambiguous` shows 2-3 equal-weight buttons with nothing preselected
 * - `none` drops straight to the typed search — and is a 200, not an error
 */
export type MatchTier = "clear" | "ambiguous" | "none";

/** Just enough of a student to render a tap target. */
export interface CandidateStudent {
  id: string;
  first_name: string;
  last_name: string;
  class_group: string | null;
  status: StudentStatus;
}

export interface ResolveCandidate {
  /** The one student, or every member of the carpool. Never empty. */
  students: CandidateStudent[];
  /** Present only when this candidate is a whole carpool. */
  carpool: { id: string; name: string } | null;
  /** 0-1. Passed straight back to set-status so it lands in the audit row. */
  score: number;
  /** The spelling that matched, as written on the roster. */
  matchedOn: string;
  matchedVia: MatchedVia;
}

export interface TranscriptAlternative {
  transcript: string;
  confidence?: number;
}

export interface TokenResponse {
  token: string;
  /** Seconds. The browser should re-mint before this runs out. */
  expiresIn: number;
  /** Roster surnames, waiting students first, for Keyterm Prompting. */
  keyterms: string[];
}

export interface ResolveResponse {
  tier: MatchTier;
  /** The alternative the top candidate came from, for the audit log. */
  transcript: string;
  candidates: ResolveCandidate[];
}

export interface SetStatusResponse {
  /** Final state of every id that exists on the roster, changed or not. */
  students: Student[];
  /** Ids that actually moved. Absent here but present in `students` means "already there". */
  changed: string[];
  /** Audit rows written -- one per id in `changed`, at most. */
  logged: number;
  /** Ids that were not found on the roster at all. */
  missing: string[];
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a caller can actually *do* about a failure, which is not the same thing
 * as the status code. `pin` means re-prompt; `throttled` means wait; everything
 * else means fall back to the typed search and show the message.
 */
export type ApiErrorKind =
  "pin" | "throttled" | "speech" | "unavailable" | "request" | "network";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** 0 when the request never reached a server. */
  readonly status: number;
  /** Seconds from a `retry-after` header, when the server sent a usable one. */
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: ApiErrorKind,
    status: number,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** True when re-entering the PIN is the remedy. */
  get needsPin(): boolean {
    return this.kind === "pin";
  }

  /** True when typing the name is the remedy — which is most of them. */
  get shouldFallBackToSearch(): boolean {
    return this.kind !== "pin";
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return "pin";
  if (status === 429) return "throttled";
  if (status === 502) return "speech";
  if (status >= 500) return "unavailable";
  return "request";
}

/**
 * Only used when the server sent no `error` field at all — a proxy 502 page, a
 * gateway timeout, an HTML error body. Written for the person on the pavement.
 */
const FALLBACK_MESSAGE: Record<ApiErrorKind, string> = {
  pin: "That PIN was not recognised. Check with the office.",
  throttled: "Too many requests just now. Wait a moment and try again.",
  speech: "Speech recognition is unavailable. Type the name instead.",
  unavailable: "The board is not reachable right now. Type the name instead.",
  request: "That request could not be completed. Type the name instead.",
  network:
    "Could not connect. Check the wifi, then try again or type the name instead.",
};

/** A `retry-after` we cannot parse is worse than none: never guess a number. */
function retryAfterFrom(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === "object" && parsed !== null) {
      const message = (parsed as Record<string, unknown>).error;
      if (typeof message === "string" && message.trim() !== "") {
        return message.trim();
      }
    }
  } catch {
    // A non-JSON body is a proxy or gateway talking, not our function.
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

/** Present on every request: the PIN is the only real authorization we have. */
export interface Credentials {
  pin: string;
  deviceId: string;
}

/** The optional narrowing that keeps the keyterm list inside Deepgram's budget. */
export interface RosterScope {
  classGroup?: string | null;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export type TokenInput = Credentials & RosterScope & RequestOptions;

export type ResolveInput = Credentials &
  RosterScope &
  RequestOptions & {
    /** Deepgram's ranked hypotheses, when the caller has more than one. */
    alternatives?: TranscriptAlternative[];
    /** A single hypothesis, or what someone typed. */
    transcript?: string;
  };

export type SetStatusInput = Credentials &
  RequestOptions & {
    /** Exactly one of these two -- a single confirm, or a whole carpool at once. */
    studentId?: string;
    studentIds?: string[];
    status: StudentStatus;
    /**
     * Required, never defaulted. A voice confirmation logged as `manual` drops
     * the transcript and score that `status_events` exists to collect.
     */
    source: StatusEventSource;
    matchConfidence?: number | null;
    transcript?: string | null;
    /** Set when confirming a whole carpool, so every audit row carries it. */
    carpoolId?: string | null;
  };

export interface ApiClient {
  requestToken(input: TokenInput): Promise<TokenResponse>;
  resolveName(input: ResolveInput): Promise<ResolveResponse>;
  setStatus(input: SetStatusInput): Promise<SetStatusResponse>;
}

/** Shared by every client in the app, so there is one transport, not two. */
export interface ApiClientOptions {
  /** Defaults to `functionsBaseUrl()`, read lazily so tests need no env. */
  baseUrl?: string;
  anonKey?: string;
  fetchImpl?: typeof fetch;
  /**
   * Overrides for the last-resort sentences used when the server sends no
   * `error` field at all.
   *
   * The status-to-kind mapping is a transport fact and stays shared, but the
   * words are not: "type the name instead" is the right remedy at the kerb and
   * meaningless in the office, and a 502 reaching /admin is Supabase's gateway
   * rather than anything to do with speech.
   */
  fallbackMessages?: Partial<Record<ApiErrorKind, string>>;
}

/** Drops undefined and null so the server sees an absent field, not a null. */
export function compact(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

/**
 * The one HTTP path to an Edge Function.
 *
 * Extracted and exported because /admin needs the same behaviour for its own
 * five endpoints. When it had its own copy, the copy also carried a bug that
 * had already been fixed here -- a missing env var reported as "check the
 * wifi" -- which is what a duplicated transport buys you.
 */
export function createEdgeFunctionPost(options: ApiClientOptions = {}) {
  const fallback: Record<ApiErrorKind, string> = {
    ...FALLBACK_MESSAGE,
    ...options.fallbackMessages,
  };

  // Resolved per call, not at construction: `publicEnv` throws when a variable
  // is missing, and a module-level throw would take down the whole page render
  // instead of showing one error banner where the call actually happens.
  const resolveBaseUrl = () =>
    (options.baseUrl ?? functionsBaseUrl()).replace(/\/+$/, "");
  const resolveAnonKey = () => options.anonKey ?? publicEnv.supabaseAnonKey;

  return async function post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const doFetch = options.fetchImpl ?? fetch;

    // Read the config OUTSIDE the fetch try/catch. `publicEnv` throws when a
    // variable is missing, and folding that into the catch below reported an
    // unconfigured deployment as "check the wifi" -- sending a staff member to
    // the router over a problem only whoever installed the app can fix.
    let url: string;
    let anonKey: string;
    try {
      url = `${resolveBaseUrl()}/${endpoint}`;
      anonKey = resolveAnonKey();
      if (anonKey.trim() === "") throw new Error("empty anon key");
    } catch {
      throw new ApiError(
        "unavailable",
        0,
        "This app is not set up yet: it has no address for the school's database. Ask whoever installed it.",
      );
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: {
          // Supabase's gateway wants the anon key before it will route to the
          // function at all. It grants nothing on its own: RLS gives anon only
          // `select` on students, and the PIN is what guards the write path.
          authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (caught: unknown) {
      // An abort is the caller's own doing -- a released push-to-talk button, a
      // navigation -- and must not surface as a red banner.
      if (caught instanceof Error && caught.name === "AbortError") throw caught;
      throw new ApiError("network", 0, fallback.network);
    }

    if (!response.ok) {
      const kind = kindForStatus(response.status);
      const message = await readErrorMessage(response);
      throw new ApiError(
        kind,
        response.status,
        message ?? fallback[kind],
        retryAfterFrom(response),
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError("unavailable", response.status, fallback.unavailable);
    }
  };
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const post = createEdgeFunctionPost(options);

  return {
    requestToken({ pin, deviceId, classGroup, signal }) {
      return post<TokenResponse>(
        "deepgram-token",
        compact({ pin, deviceId, classGroup }),
        signal,
      );
    },

    resolveName({
      pin,
      deviceId,
      alternatives,
      transcript,
      classGroup,
      signal,
    }) {
      return post<ResolveResponse>(
        "resolve-name",
        compact({
          pin,
          deviceId,
          alternatives:
            alternatives && alternatives.length > 0 ? alternatives : undefined,
          transcript,
          classGroup,
        }),
        signal,
      );
    },

    setStatus({
      pin,
      deviceId,
      studentId,
      studentIds,
      status,
      source,
      matchConfidence,
      transcript,
      carpoolId,
      signal,
    }) {
      return post<SetStatusResponse>(
        "set-status",
        compact({
          pin,
          deviceId,
          studentId,
          studentIds,
          status,
          source,
          // Only meaningful on a voice confirmation; the server ignores both
          // for any other source, but sending them would still be misleading.
          matchConfidence: source === "voice" ? matchConfidence : undefined,
          transcript: source === "voice" ? transcript : undefined,
          carpoolId,
        }),
        signal,
      );
    },
  };
}

/** The client the app uses. Env is read on the first call, not at import. */
export const api: ApiClient = createApiClient();
