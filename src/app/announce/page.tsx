import type { Metadata } from "next";

import { AnnounceScreen } from "@/components/announce/announce-screen";
import { PinGate } from "@/components/ui";

export const metadata: Metadata = {
  title: "Announce — Carpool Pickup Board",
};

/**
 * Lane 01. Someone standing at the kerb, one-handed, opens this once per
 * shift. `PinGate` holds the door until the staff PIN is entered — it does
 * not verify against the server before opening (see its own doc comment): the
 * first real request behind it will surface a wrong PIN as a 401, and
 * `AnnounceScreen` sends the caller back through the gate when that happens.
 */
export default function AnnouncePage() {
  return (
    <PinGate purpose="Confirming a pickup on the board uses this PIN too.">
      <AnnounceScreen />
    </PinGate>
  );
}
