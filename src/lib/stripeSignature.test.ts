import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "./stripeSignature.ts";

const secret = "whsec_test";
const sign = (payload: string, t: number, key = secret) =>
  `t=${t},v1=${createHmac("sha256", key).update(`${t}.${payload}`).digest("hex")}`;

test("verifyStripeSignature accepts Stripe's signature and nothing else", () => {
  const body = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  assert.equal(verifyStripeSignature(body, sign(body, now), secret, now), true);
  // A second v1 (during secret rotation) is enough if one matches.
  assert.equal(verifyStripeSignature(body, `${sign(body, now)},v1=deadbeef`, secret, now), true);
  assert.equal(verifyStripeSignature(body, `t=${now},v1=deadbeef,${sign(body, now).split(",")[1]}`, secret, now), true);
  assert.equal(verifyStripeSignature(body + " ", sign(body, now), secret, now), false);
  assert.equal(verifyStripeSignature(body, sign(body, now, "whsec_other"), secret, now), false);
  assert.equal(verifyStripeSignature(body, sign(body, now - 301), secret, now), false, "too old");
  assert.equal(verifyStripeSignature(body, null, secret, now), false);
  assert.equal(verifyStripeSignature(body, `v1=${"0".repeat(64)}`, secret, now), false, "no timestamp");
  assert.equal(verifyStripeSignature(body, "t=1,v1=zz", secret, 1), false);
  assert.equal(verifyStripeSignature(body, sign(body, now), "", now), false, "no secret configured");
});
