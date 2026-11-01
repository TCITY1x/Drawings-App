/**
 * Stripe billing rules, kept pure (no relative imports, no React or browser
 * APIs) so `node --test` can load them: turning a Stripe subscription into the
 * organisation's billing columns, seat counts and the trial's days. Safe to
 * import from the browser; the webhook's signature check is in
 * `stripeSignature.ts`, which needs node:crypto.
 */

export const MAX_SEATS = 500;

/** The parts of a Stripe subscription SitePax reads. */
export interface StripeSubscription {
  id: string;
  status: string;
  customer: string | { id: string };
  cancel_at_period_end?: boolean;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ quantity?: number | null; current_period_end?: number | null; price?: { id?: string } | null }> };
}

/** The organisation's billing columns, as the webhook writes them. */
export interface OrganisationBilling {
  plan: "team" | "cancelled";
  plan_status: string;
  seats: number;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  current_period_ends_at: string | null;
  cancel_at_period_end: boolean;
}

/** Statuses in which the company keeps using SitePax on the paid plan. */
const PAID = new Set(["active", "trialing", "past_due"]);
/** Statuses in which the subscription has ended or will never start. */
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

/**
 * The billing columns for a subscription, or null while it isn't settled yet
 * (`incomplete`: the first payment hasn't gone through), so a trial isn't
 * cut short by a checkout that may still succeed.
 */
export function billingFromSubscription(subscription: StripeSubscription, priceId?: string): OrganisationBilling | null {
  const paid = PAID.has(subscription.status);
  if (!paid && !ENDED.has(subscription.status)) return null;
  const items = subscription.items?.data ?? [];
  const ours = priceId ? items.filter((item) => item.price?.id === priceId) : [];
  const counted = ours.length > 0 ? ours : items.slice(0, 1);
  const quantity = counted.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity ?? 0))), 0);
  // Newer API versions put the period on the item, older ones on the subscription.
  const periodEnd = subscription.current_period_end ?? counted[0]?.current_period_end ?? null;
  return {
    plan: paid ? "team" : "cancelled",
    plan_status: subscription.status,
    seats: clampSeats(quantity),
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    current_period_ends_at: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
  };
}

export function clampSeats(seats: number): number {
  if (!Number.isFinite(seats)) return 1;
  return Math.min(MAX_SEATS, Math.max(1, Math.floor(seats)));
}

/** Seats to buy: what was asked for, but never fewer than the people already in (or invited to) the company. */
export function seatsToBuy(requested: unknown, taken: number): number {
  const asked = typeof requested === "number" ? requested : Number(requested);
  return clampSeats(Math.max(Number.isFinite(asked) ? asked : 0, taken));
}

/** Days of trial left, rounded up; 0 once it has ended. */
export function trialDaysLeft(trialEndsAt: string, now: number = Date.now()): number {
  const ends = Date.parse(trialEndsAt);
  if (Number.isNaN(ends)) return 0;
  return Math.max(0, Math.ceil((ends - now) / 86_400_000));
}

/** Form-encode nested params the way Stripe's API expects (`a[b][0][c]=…`). */
export function stripeForm(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) return value.forEach((one, index) => add(`${key}[${index}]`, one));
    if (typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).forEach(([inner, one]) => add(`${key}[${inner}]`, one));
    }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };
  Object.entries(params).forEach(([key, value]) => add(key, value));
  return pairs.join("&");
}
