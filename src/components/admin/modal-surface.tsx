"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalSurfaceProps {
  /** Id of the element inside `children` that names the dialog. */
  labelledBy: string;
  onClose: () => void;
  /** False while a request is in flight: Escape and the backdrop do nothing. */
  dismissible?: boolean;
  /**
   * Whether a tap on the backdrop closes it. Escape and the Cancel button are
   * deliberate; a stray tap outside is not, so a surface holding unsaved work
   * turns this off.
   */
  dismissOnBackdrop?: boolean;
  /** Where focus lands on open; defaults to the first focusable control. */
  initialFocusSelector?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The `floating` surface (`bg-white rounded-2xl shadow-float`) shared by the
 * membership sheet and the class-delete dialog: a bottom sheet on a phone, a
 * centred panel from `sm` up.
 *
 * Owns the dialog contract so neither caller re-implements it: `role="dialog"`
 * with `aria-modal`, Escape closes, Tab stays inside, focus moves in on open
 * and returns to whatever opened it, and the page behind does not scroll.
 * Entry is the existing `tile-in` (transform + opacity), which the global
 * reduced-motion guard already neutralises.
 */
export function ModalSurface({
  labelledBy,
  onClose,
  dismissible = true,
  dismissOnBackdrop = true,
  initialFocusSelector,
  className,
  children,
}: ModalSurfaceProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The latest values, read from the one long-lived key listener below so it
  // is not torn down (and focus not re-pulled) on every parent render.
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;

    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const initial = initialFocusSelector
      ? panel.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    (initial ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!dismissibleRef.current) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || panel === null) return;

      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
    // Focus management runs once per open, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          dismissible &&
          dismissOnBackdrop
        ) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          "flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-float animate-tile-in sm:rounded-2xl",
          "focus:outline-none",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
