"use client";

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { buildAiPrompt } from "@/lib/import/ai-prompt";

export interface ImportAiHelpProps {
  classNames: readonly string[];
  /** Opens the paste box, where the AI's reply goes. */
  onReadyToPaste: () => void;
}

/**
 * The escape hatch: a prompt the admin hands to their own AI tool. Nothing is
 * sent anywhere from here, and the privacy line says plainly what sharing the
 * list with that tool means.
 */
export function ImportAiHelp({
  classNames,
  onReadyToPaste,
}: ImportAiHelpProps) {
  const prompt = useMemo(() => buildAiPrompt(classNames), [classNames]);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (http, old browser): select it for Ctrl+C.
      promptRef.current?.focus();
      promptRef.current?.select();
    }
  }

  return (
    <div className="flex animate-tile-in flex-col gap-4 rounded-2xl border border-curb-200 bg-white p-6 shadow-card">
      <ol className="grid gap-4 sm:grid-cols-3">
        {[
          "Copy the prompt below.",
          "Paste it into ChatGPT, Claude, Gemini or Copilot, and attach your spreadsheet.",
          "Copy the reply and paste it here.",
        ].map((text, index) => (
          <li key={text} className="flex gap-3">
            <span
              aria-hidden="true"
              className="font-display text-3xl font-extrabold leading-none text-marigold-500"
            >
              {index + 1}
            </span>
            <span className="text-curb-700">{text}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy prompt"}
        </Button>
        <Button variant="secondary" onClick={onReadyToPaste}>
          Paste the reply
        </Button>
      </div>

      <details className="group">
        <summary className="focus-ring inline-flex min-h-tap cursor-pointer items-center rounded-xl text-sm font-semibold text-curb-700 hover:text-curb-900">
          See the prompt
        </summary>
        <textarea
          ref={promptRef}
          readOnly
          value={prompt}
          rows={12}
          aria-label="Prompt for your AI tool"
          className="focus-ring mt-2 w-full rounded-xl border border-curb-200 bg-curb-50 p-4 font-mono text-sm text-curb-800"
        />
      </details>

      <p className="text-sm text-curb-600">
        This shares your students&apos; names with that AI service. Check your
        school&apos;s policy first.
      </p>
    </div>
  );
}
