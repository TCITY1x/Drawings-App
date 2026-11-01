import { test } from "node:test";
import assert from "node:assert/strict";
import { billingNotice, isActive, planFromSubscription, seatChoice, trialDaysLeft } from "./billing.ts";

const now = new Date("2026-11-10T12:00:00Z");
const trial = (ends: string) => ({ plan: "trial", planStatus: "trialing", trialEndsAt: ends });

test("a trial is active until it ends", () => {
  assert.equal(isActive(trial("2026-11-10T12:00:01Z"), now), true);
  assert.equal(isActive(trial("2026-11-10T12:00:00Z"), now), false);
  assert.equal(isActive(trial("not a date"), now), false);
});

test("a subscription is active in good standing only", () => {
  for (const status of ["active", "trialing", "past_due"]) assert.equal(isActive({ plan: "team", planStatus: status, trialEndsAt: "" }), true);
  for (const status of ["canceled", "unpaid", "incomplete_expired"]) assert.equal(isActive({ plan: "team", planStatus: status, trialEndsAt: "" }), false);
  assert.equal(isActive({ plan: "cancelled", planStatus: "canceled", trialEndsAt: "2099-01-01" }), false);
});

test("trial days round up and stop at zero", () => {
  assert.equal(trialDaysLeft("2026-11-11T11:00:00Z", now), 1);
  assert.equal(trialDaysLeft("2026-11-13T13:00:00Z", now), 4);
  assert.equal(trialDaysLeft("2026-11-01T00:00:00Z", now), 0);
});

test("Stripe statuses map to plans", () => {
  assert.deepEqual(planFromSubscription({ status: "active", quantity: 7 }), { plan: "team", planStatus: "active", seats: 7 });
  assert.deepEqual(planFromSubscription({ status: "past_due", quantity: 3 }), { plan: "team", planStatus: "past_due", seats: 3 });
  assert.deepEqual(planFromSubscription({ status: "canceled", quantity: 3 }), { plan: "cancelled", planStatus: "canceled", seats: null });
  assert.equal(planFromSubscription({ status: "incomplete", quantity: 3 }), null);
  assert.equal(planFromSubscription({ status: "active", quantity: 0 })?.seats, null);
  assert.equal(planFromSubscription({ status: "active", quantity: 10_000 })?.seats, 500);
});

test("seat choice covers everyone already in the company", () => {
  assert.equal(seatChoice(2, 4), 4);
  assert.equal(seatChoice(10, 4), 10);
  assert.equal(seatChoice(0, 0), 1);
  assert.equal(seatChoice(9999, 1), 500);
  assert.equal(seatChoice(Number.NaN, 3), 3);
});

test("notices say what's wrong and only when it matters", () => {
  assert.equal(billingNotice(trial("2026-11-20T00:00:00Z"), now), null);
  assert.deepEqual(billingNotice(trial("2026-11-11T00:00:00Z"), now)?.tone, "warning");
  assert.match(billingNotice(trial("2026-11-11T00:00:00Z"), now)!.text, /1 day\./);
  assert.equal(billingNotice(trial("2026-11-01T00:00:00Z"), now)?.tone, "blocked");
  assert.equal(billingNotice({ plan: "team", planStatus: "active", trialEndsAt: "" }, now), null);
  assert.equal(billingNotice({ plan: "team", planStatus: "past_due", trialEndsAt: "" }, now)?.tone, "warning");
  assert.equal(billingNotice({ plan: "cancelled", planStatus: "canceled", trialEndsAt: "" }, now)?.tone, "blocked");
});

test("explainRefusal translates RLS refusals and leaves the rest", async () => {
  const { explainRefusal } = await import("./billing.ts");
  assert.match(explainRefusal('new row violates row-level security policy for table "drawings"'), /plan doesn't allow/);
  assert.equal(explainRefusal("network down"), "network down");
});
