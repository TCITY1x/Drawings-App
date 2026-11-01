import "server-only";
import type Stripe from "stripe";
import { planFromSubscription } from "@/lib/billing";
import { adminClient } from "@/lib/server/supabase";

export interface OwnedOrganisation {
  id: string;
  name: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string;
  planStatus: string;
  members: number;
}

/** The organisation, if this user owns it — only owners handle billing. */
export async function ownedOrganisation(userId: string, organisationId: string): Promise<OwnedOrganisation | null> {
  const db = adminClient();
  const { data: member } = await db
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (member?.role !== "owner") return null;
  const [{ data: org, error }, { count }] = await Promise.all([
    db
      .from("organisations")
      .select("id, name, stripe_customer_id, stripe_subscription_id, plan, plan_status")
      .eq("id", organisationId)
      .single(),
    db.from("organisation_members").select("user_id", { count: "exact", head: true }).eq("organisation_id", organisationId),
  ]);
  if (error || !org) return null;
  return {
    id: org.id,
    name: org.name,
    stripeCustomerId: org.stripe_customer_id,
    stripeSubscriptionId: org.stripe_subscription_id,
    plan: org.plan,
    planStatus: org.plan_status,
    members: count ?? 1,
  };
}

/** Seats bought on a subscription: the quantities of its items. */
export function subscriptionSeats(subscription: Stripe.Subscription): number {
  return subscription.items.data.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
}

/**
 * Bring an organisation's plan in step with a subscription, as Stripe has it
 * now. Callers fetch the subscription fresh, so events arriving out of order
 * can't leave an old state behind.
 */
export async function applySubscription(subscription: Stripe.Subscription): Promise<void> {
  const db = adminClient();
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  let organisationId = subscription.metadata?.organisation_id || null;
  if (!organisationId) {
    const { data } = await db.from("organisations").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    organisationId = data?.id ?? null;
  }
  if (!organisationId) throw new Error(`No organisation for subscription ${subscription.id}.`);

  const next = planFromSubscription({ status: subscription.status, quantity: subscriptionSeats(subscription) });
  if (!next) return;
  const { data: current } = await db.from("organisations").select("stripe_subscription_id").eq("id", organisationId).single();
  // A cancelled old subscription mustn't undo a newer one that replaced it.
  if (next.plan === "cancelled" && current?.stripe_subscription_id && current.stripe_subscription_id !== subscription.id) return;

  const { error } = await db
    .from("organisations")
    .update({
      plan: next.plan,
      plan_status: next.planStatus,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      ...(next.seats ? { seats: next.seats } : {}),
    })
    .eq("id", organisationId);
  if (error) throw new Error(`Couldn't update organisation ${organisationId}: ${error.message}`);
}
