"use client";

import { type FormEvent, useId } from "react";

import { Button } from "@/components/ui";

/**
 * The typed roster search. CLAUDE.md is explicit that this stays available at
 * all times, not just after the mic fails — so it renders unconditionally in
 * `announce-screen.tsx`, never behind an error state.
 *
 * Submits explicitly rather than searching on every keystroke: `resolve-name`
 * has its own per-device rate limit, and a name mid-typing is not yet worth a
 * request.
 */
export function SearchFallback({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (event: FormEvent) => void;
  disabled?: boolean;
}) {
  const inputId = useId();

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-curb-200 bg-white p-4 shadow-card"
    >
      <label
        htmlFor={inputId}
        className="block font-mono text-xs uppercase tracking-eyebrow text-curb-500"
      >
        Or type the last name
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. Cohen"
          autoCapitalize="words"
          autoCorrect="off"
          className="focus-ring min-h-tap w-0 flex-1 rounded-lg border border-curb-300 bg-curb-50 px-4 text-lg text-curb-900 placeholder:text-curb-400"
        />
        <Button
          type="submit"
          size="tap"
          disabled={disabled || value.trim() === ""}
        >
          Search
        </Button>
      </div>
    </form>
  );
}
