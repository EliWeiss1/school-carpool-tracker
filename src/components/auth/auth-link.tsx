import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * A text link inside an account form. Tall enough to tap (`min-h-tap`) and
 * underlined in marigold so it reads as a link without borrowing a status
 * colour.
 */
export function AuthLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "focus-ring inline-flex min-h-tap items-center rounded-lg font-semibold text-curb-900",
        "underline decoration-marigold-500 decoration-2 underline-offset-4",
        "transition-opacity duration-150 hover:decoration-marigold-600 hover:opacity-80 active:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
