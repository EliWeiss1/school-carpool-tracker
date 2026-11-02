import type { Metadata } from "next";

import { AnnounceScreen } from "@/components/announce/announce-screen";
import { PinGate } from "@/components/ui";
import { verifyStaffPin } from "@/lib/verify-pin";

export const metadata: Metadata = {
  title: "Announce — CarpoolCaller",
};

/**
 * Lane 01. Someone standing at the kerb, one-handed, opens this once per
 * shift. `PinGate` holds the door until the staff PIN is entered and checked
 * against the server (`verifyStaffPin`), so a wrong PIN never opens the
 * screen. `AnnounceScreen` still sends the caller back through the gate if a
 * later request 401s.
 */
export default function AnnouncePage() {
  return (
    <PinGate
      purpose="Confirming a pickup on the board uses this PIN too."
      verify={verifyStaffPin}
    >
      <AnnounceScreen />
    </PinGate>
  );
}
