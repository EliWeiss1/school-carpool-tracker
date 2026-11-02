"use client";

import { AnnounceScreen } from "@/components/announce/announce-screen";
import { PinGate } from "@/components/ui/pin-gate";
import { verifyStaffPin } from "@/lib/verify-pin";

/**
 * /announce behind the staff PIN. A client component because `verify` is a
 * function, and a Server Component cannot pass a function to a client one.
 */
export function AnnounceGate() {
  return (
    <PinGate
      purpose="Confirming a pickup on the board uses this PIN too."
      verify={verifyStaffPin}
    >
      <AnnounceScreen />
    </PinGate>
  );
}
