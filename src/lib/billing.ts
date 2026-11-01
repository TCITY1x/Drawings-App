/**
 * Plans and what they allow. Pure and free of relative imports so
 * `node --test` can load it.
 *
 * A company is on the 14-day `trial`, then `team` (a Stripe subscription,
 * per seat), or `cancelled`. `isActive` must match `org_active` in
 * `supabase/migrations/20261103090000_billing.sql`, which is what actually
 * stops a lapsed company changing anything.
 */

export interface PlanState {
  plan: string;
  planStatus: string;
  trialEndsAt: string;
}

/** Subscription states in which the company keeps working (past_due: Stripe is still retrying the card). */
export const GOOD_STANDING = ["active", "trialing", "past_due"];

export const MAX_SEATS = 500;

export function isActive(state: PlanState, now = new Date()): boolean {
  if (state.plan === "team") return GOOD_STANDING.includes(state.planStatus);
  if (state.plan === "trial") return Date.parse(state.trialEndsAt) > now.getTime();
  return false;
}

/** Whole days left on the trial, rounded up; 0 once it's over. */
export function trialDaysLeft(trialEndsAt: string, now = new Date()): number {
  const ms = Date.parse(trialEndsAt) - now.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

/**
 * What a Stripe subscription means for the company, or null when it changes
 * nothing yet (`incomplete`: the first payment hasn't gone through, so the
 * trial carries on until it does or expires).
 */
export function planFromSubscription(input: {
  status: string;
  quantity: number;
}): { plan: "team" | "cancelled"; planStatus: string; seats: number | null } | null {
  if (input.status === "incomplete") return null;
  const seats = Number.isFinite(input.quantity) && input.quantity > 0 ? Math.min(MAX_SEATS, Math.floor(input.quantity)) : null;
  if (GOOD_STANDING.includes(input.status)) return { plan: "team", planStatus: input.status, seats };
  // canceled, unpaid, incomplete_expired, paused — no longer paying.
  return { plan: "cancelled", planStatus: input.status, seats: null };
}

/** How many seats someone may buy: enough for everyone already in the company, and no more than the cap. */
export function seatChoice(wanted: number, members: number): number {
  const floor = Math.max(1, members);
  if (!Number.isFinite(wanted)) return floor;
  return Math.min(MAX_SEATS, Math.max(floor, Math.floor(wanted)));
}

export type NoticeTone = "info" | "warning" | "blocked";

/** The banner a company should see about its plan, if any. */
export function billingNotice(state: PlanState, now = new Date()): { tone: NoticeTone; text: string } | null {
  if (state.plan === "trial") {
    const left = trialDaysLeft(state.trialEndsAt, now);
    if (left === 0) return { tone: "blocked", text: "Your free trial has ended. Projects are read-only until someone chooses a plan." };
    if (left <= 3) return { tone: "warning", text: `Your free trial ends in ${left} day${left === 1 ? "" : "s"}.` };
    return null;
  }
  if (state.plan === "team") {
    if (state.planStatus === "past_due") return { tone: "warning", text: "The last payment didn't go through. Update the card to keep SitePax running." };
    return null;
  }
  return { tone: "blocked", text: "The subscription has ended. Projects are read-only until someone chooses a plan." };
}

/** A database refusal in plain words: row-level security turning down a change usually means the plan has lapsed. */
export function explainRefusal(message: string): string {
  return /row-level security|violates row level security/i.test(message)
    ? "your company's plan doesn't allow changes right now (see the Team page)"
    : message;
}
