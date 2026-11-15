"use client";

import { type ChangeEvent, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { cn } from "@/lib/cn";
import { SAMPLE_CSV, SAMPLE_FILE_NAME } from "@/lib/import/ai-prompt";
import { FILE_ACCEPT } from "@/lib/import/read-source";

import { ImportAiHelp } from "./import-ai-help";

export interface ImportSourceProps {
  classNames: readonly string[];
  error: string | null;
  /** The label of the source that failed, so the error names the file. */
  errorLabel: string | null;
  onFile: (file: File) => void;
  onPaste: (text: string) => void;
}

type Way = "file" | "paste" | "ai";

const WAYS: { id: Way; title: string; body: string }[] = [
  {
    id: "file",
    title: "Upload a spreadsheet",
    body: "Excel or CSV, straight from your office system or Google Sheets.",
  },
  {
    id: "paste",
    title: "Paste from a spreadsheet",
    body: "Select the cells in Excel or Google Sheets, copy, and paste them here.",
  },
  {
    id: "ai",
    title: "Let your AI tool tidy it",
    body: "For a list that's really messy. Copy our prompt, paste back the result.",
  },
];

/** What the importer copes with, said up front so nobody reformats first. */
const FLEXIBLE = [
  "Columns in any order",
  "Your own headings: Surname, Homeroom, Teacher…",
  "Full names in one column",
  "Title rows above the headings",
  "New classes and carpools are created for you",
];

function downloadSample() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = SAMPLE_FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Step 1: the three ways in, shown side by side so the options are visible
 * before anyone reads a word of instructions.
 */
export function ImportSource({
  classNames,
  error,
  errorLabel,
  onFile,
  onPaste,
}: ImportSourceProps) {
  const [way, setWay] = useState<Way | null>(null);
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const pasteId = useId();

  function choose(next: Way) {
    if (next === "file") {
      setWay("file");
      fileRef.current?.click();
      return;
    }
    setWay((current) => (current === next ? null : next));
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear it so picking the same file again (after fixing it) still fires.
    event.target.value = "";
    if (file) onFile(file);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        {WAYS.map((option) => {
          const active = way === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => choose(option.id)}
              aria-expanded={option.id === "file" ? undefined : active}
              className={cn(
                "focus-ring flex min-h-tap flex-col items-start gap-2 rounded-2xl border bg-white p-6 text-left shadow-card transition-[transform,border-color,background-color] duration-200 ease-spring hover:-translate-y-0.5 hover:border-curb-400 active:translate-y-0 active:shadow-press",
                active
                  ? "border-marigold-500 bg-marigold-50"
                  : "border-curb-200",
              )}
            >
              <span className="font-display text-xl font-bold text-curb-900">
                {option.title}
              </span>
              <span className="text-curb-600">{option.body}</span>
            </button>
          );
        })}
      </div>

      <input
        ref={fileRef}
        id={fileId}
        type="file"
        accept={FILE_ACCEPT}
        onChange={handleFile}
        className="sr-only"
        aria-label="Choose a spreadsheet to import"
      />

      {error && (
        <ErrorBanner message={errorLabel ? `${errorLabel}: ${error}` : error} />
      )}

      {way === "paste" && (
        <div className="flex animate-tile-in flex-col gap-3">
          <label
            htmlFor={pasteId}
            className="font-display text-lg font-semibold text-curb-900"
          >
            Paste your cells, headings included
          </label>
          <textarea
            id={pasteId}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={8}
            placeholder={"First Name\tLast Name\tClass\nMiriam\tCohen\t2nd"}
            className="focus-ring w-full rounded-xl border border-curb-300 bg-white p-4 font-mono text-sm text-curb-900 placeholder:text-curb-400"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              onClick={() => onPaste(pasted)}
              disabled={pasted.trim() === ""}
            >
              Use these cells
            </Button>
            <span className="text-sm text-curb-500">
              A reply from your AI tool goes here too.
            </span>
          </div>
        </div>
      )}

      {way === "ai" && (
        <ImportAiHelp
          classNames={classNames}
          onReadyToPaste={() => setWay("paste")}
        />
      )}

      <div className="flex flex-col gap-3 rounded-2xl bg-curb-50 p-6">
        <p className="font-display text-lg font-semibold text-curb-900">
          No need to tidy your file first
        </p>
        <ul className="flex flex-wrap gap-2">
          {FLEXIBLE.map((item) => (
            <li
              key={item}
              className="rounded-xl border border-curb-200 bg-white px-3 py-1 text-sm text-curb-700"
            >
              {item}
            </li>
          ))}
        </ul>
        <p className="text-sm text-curb-600">
          You&apos;ll check every column before anything is saved. Importing
          only adds students; it never removes anyone.{" "}
          <button
            type="button"
            onClick={downloadSample}
            className="focus-ring rounded-xl font-semibold text-curb-900 underline decoration-marigold-500 decoration-2 underline-offset-4 hover:decoration-marigold-600 active:text-curb-700"
          >
            Download a sample file
          </button>{" "}
          if you&apos;d rather start from a template.
        </p>
      </div>
    </div>
  );
}
