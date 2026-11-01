import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingFromSubscription,
  seatsToBuy,
  stripeForm,
  trialDaysLeft,
  MAX_SEATS,
  type StripeSubscription,
} from "./billing.ts";

const subscription = (change: Partial<StripeSubscription> = {}): StripeSubscription => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  items: { data: [{ quantity: 7, current_period_end: 1_800_000_000, price: { id: "price_seat" } }] },
  ...change,
});

test("billingFromSubscription maps Stripe's state onto the organisation", () => {
  assert.deepEqual(billingFromSubscription(subscription(), "price_seat"), {
    plan: "team",
    plan_status: "active",
    seats: 7,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    current_period_ends_at: new Date(1_800_000_000_000).toISOString(),
    cancel_at_period_end: false,
  });
  assert.equal(billingFromSubscription(subscription({ status: "past_due" }))?.plan, "team");
  assert.equal(billingFromSubscription(subscription({ status: "canceled" }))?.plan, "cancelled");
  assert.equal(billingFromSubscription(subscription({ status: "unpaid" }))?.plan, "cancelled");
  assert.equal(billingFromSubscription(subscription({ status: "incomplete" })), null, "not settled yet");
  assert.equal(billingFromSubscription(subscription({ customer: { id: "cus_2" } }))?.stripe_customer_id, "cus_2");
  assert.equal(billingFromSubscription(subscription({ cancel_at_period_end: true }))?.cancel_at_period_end, true);
});

test("billingFromSubscription counts the seat price's quantity", () => {
  const mixed = subscription({
    items: { data: [{ quantity: 1, price: { id: "price_addon" } }, { quantity: 12, price: { id: "price_seat" } }] },
  });
  assert.equal(billingFromSubscription(mixed, "price_seat")?.seats, 12);
  assert.equal(billingFromSubscription(mixed)?.seats, 1, "without a price id, the first item");
  assert.equal(billingFromSubscription(subscription({ items: { data: [] } }))?.seats, 1, "never zero seats");
  assert.equal(billingFromSubscription(subscription({ current_period_end: 1_700_000_000 }))?.current_period_ends_at, new Date(1_700_000_000_000).toISOString());
});

test("seatsToBuy covers everyone already in the company", () => {
  assert.equal(seatsToBuy(10, 3), 10);
  assert.equal(seatsToBuy(2, 3), 3);
  assert.equal(seatsToBuy("6", 1), 6);
  assert.equal(seatsToBuy("junk", 0), 1);
  assert.equal(seatsToBuy(4.7, 0), 4);
  assert.equal(seatsToBuy(1e9, 0), MAX_SEATS);
});

test("trialDaysLeft rounds up and stops at zero", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(trialDaysLeft("2026-11-15T00:00:00Z", now), 14);
  assert.equal(trialDaysLeft("2026-11-01T01:00:00Z", now), 1);
  assert.equal(trialDaysLeft("2026-10-01T00:00:00Z", now), 0);
  assert.equal(trialDaysLeft("", now), 0);
});

test("stripeForm encodes nested params", () => {
  assert.equal(
    stripeForm({ mode: "subscription", line_items: [{ price: "p_1", quantity: 3 }], metadata: { org: "a b" }, skip: undefined }),
    "mode=subscription&line_items%5B0%5D%5Bprice%5D=p_1&line_items%5B0%5D%5Bquantity%5D=3&metadata%5Borg%5D=a%20b"
  );
});
