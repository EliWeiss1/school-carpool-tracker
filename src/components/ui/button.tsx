import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The one button in the app.
 *
 * Sizes are named for where they are used rather than for how big they are,
 * because the sizes are not a matter of taste: `tap` is the floor for anything
 * on /announce, which is operated one-handed, outdoors, sometimes with a glove
 * on, and `candidate` is the confirm target for a child's name.
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "tap" | "candidate";

const VARIANTS: Record<ButtonVariant, string> = {
  // Marigold on ink: the brand pairing, and the only high-chroma thing on a
  // light screen, so it reads as "the action" without competing with status.
  primary:
    "bg-marigold-500 text-curb-900 shadow-card hover:bg-marigold-400 active:bg-marigold-600 active:shadow-press",
  secondary:
    "border border-curb-300 bg-white text-curb-900 shadow-card hover:border-curb-400 hover:bg-curb-50 active:bg-curb-100 active:shadow-press",
  quiet:
    "text-curb-600 hover:bg-curb-100 hover:text-curb-900 active:bg-curb-200",
  // Reaches for the waiting scale on purpose: sending a child back to waiting
  // is the destructive action here, and it should look like the red tile does.
  danger:
    "border border-waiting-border bg-waiting-soft text-waiting hover:bg-waiting hover:text-white active:bg-waiting-deep active:text-white",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-0 px-3 py-1.5 text-sm",
  md: "min-h-tap px-6 text-base",
  tap: "min-h-tap-lg px-8 text-lg",
  candidate: "min-h-candidate px-8 text-2xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "focus-ring inline-flex items-center justify-center gap-3 rounded-xl font-display font-semibold",
        // Never `transition-all`: on the /display machine that is a repaint of
        // every tile. Only the properties that actually change are animated.
        "transition-[transform,background-color,border-color,box-shadow,opacity] duration-150 ease-spring",
        "active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    />
  );
}
