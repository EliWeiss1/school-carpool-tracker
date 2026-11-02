import { adminApi } from "@/lib/admin-api";
import { deviceId } from "@/lib/device-id";

/**
 * Asks the server whether a PIN is right, before a gate opens on it.
 *
 * `roster-list` is the probe because it is PIN-gated, read-only and spends no
 * Deepgram credits. A wrong PIN rejects with the ApiError the Edge Function
 * wrote (401 etc.), which PinGate shows verbatim.
 */
export async function verifyStaffPin(pin: string): Promise<void> {
  await adminApi.listRoster({ pin, deviceId: deviceId() });
}
