/**
 * Staff PIN check.
 *
 * The PIN is the only thing standing between a passer-by and the pickup board,
 * so the comparison must not leak how close a guess was. Both sides are hashed
 * to a fixed 32 bytes and compared with a constant-time XOR: equal work for a
 * wrong first digit and a wrong last one, and no length signal either.
 *
 * SHA-256 here is not password storage -- the PIN lives in an env var, not a
 * database. It exists to make both operands the same length so the comparison
 * can be constant-time.
 */

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(hash);
}

/** Compares every byte regardless of where the first difference is. */
function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i % b.length];
  }
  return difference === 0;
}

/**
 * True when `provided` is the configured staff PIN.
 *
 * Fails closed: an unset or blank `expected` rejects everything rather than
 * letting a misconfigured deployment run with no PIN at all.
 */
export async function verifyPin(
  provided: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  const secret = expected?.trim() ?? "";
  const attempt = provided?.trim() ?? "";

  if (secret === "" || attempt === "") return false;

  const [attemptHash, secretHash] = await Promise.all([
    digest(attempt),
    digest(secret),
  ]);
  return constantTimeEquals(attemptHash, secretHash);
}
