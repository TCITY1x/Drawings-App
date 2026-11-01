import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checking a Stripe webhook's signature. Pure (no relative imports) so
 * `node --test` can load it; server-only, as it uses node:crypto.
 */

/** How old a webhook's signed timestamp may be before it's refused as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify a `Stripe-Signature` header (`t=<unix>,v1=<hex hmac>[,v1=…]`) over
 * the raw request body. `now` is in seconds.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  now: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((one) => one?.trim() ?? "");
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isInteger(seconds) || signatures.length === 0) return false;
  if (Math.abs(now - seconds) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) return false;
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
