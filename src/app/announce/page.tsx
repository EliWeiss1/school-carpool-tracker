import type { Metadata } from "next";

import { AnnounceGate } from "@/components/announce/announce-gate";

export const metadata: Metadata = {
  title: "Announce — CarpoolCaller",
};

/**
 * Lane 01. Someone standing at the kerb, one-handed, opens this once per
 * shift. `AnnounceGate` (`PinGate`) holds the door until the staff PIN is entered and checked
 * against the server (`verifyStaffPin`), so a wrong PIN never opens the
 * screen. `AnnounceScreen` still sends the caller back through the gate if a
 * later request 401s.
 */
export default function AnnouncePage() {
  return <AnnounceGate />;
}
