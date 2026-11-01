import { billingFromSubscription, type StripeSubscription } from "@/lib/billing";
import { verifyStripeSignature } from "@/lib/stripeSignature";
import { billingConfig, refuse, serviceClient, stripe } from "@/lib/server/billing";

/**
 * Stripe's webhook: keeps each organisation's plan, status and seats in step
 * with its subscription.
 *
 * The event only says *which* subscription changed; its current state is read
 * back from Stripe, so events arriving late or out of order can't leave an
 * older state behind. The organisation is found by its Stripe customer (made
 * by the checkout route), never by metadata alone. A failure answers 500 so
 * Stripe retries; handled events are recorded so a redelivery is skipped.
 */

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id?: string; object?: string; subscription?: string | { id: string } | null; mode?: string } };
}

export async function POST(request: Request) {
  const config = billingConfig();
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  if (!config || !secret) return refuse(503, "Billing isn't set up on this SitePax yet.");
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return refuse(400, "Bad signature.");
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return refuse(400, "Not JSON.");
  }
  if (!HANDLED.has(event.type)) return Response.json({ received: true, ignored: event.type });

  const db = serviceClient(config);
  const seen = await db.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen.data) return Response.json({ received: true, duplicate: true });

  const object = event.data.object;
  const subscriptionId =
    object.object === "subscription"
      ? object.id
      : typeof object.subscription === "string"
        ? object.subscription
        : object.subscription?.id;
  if (!subscriptionId) return Response.json({ received: true, ignored: "no subscription" });

  try {
    const subscription = await stripe<StripeSubscription>(config.stripeKey, "GET", `subscriptions/${encodeURIComponent(subscriptionId)}`);
    const billing = billingFromSubscription(subscription, config.priceId);
    if (billing) {
      const org = await db
        .from("organisations")
        .select("id, stripe_subscription_id, plan")
        .eq("stripe_customer_id", billing.stripe_customer_id)
        .maybeSingle();
      if (org.error) throw new Error(org.error.message);
      // An old subscription ending must not cancel the company's newer one.
      const stale =
        org.data?.stripe_subscription_id &&
        org.data.stripe_subscription_id !== billing.stripe_subscription_id &&
        billing.plan === "cancelled";
      if (org.data && !stale) {
        const updated = await db.from("organisations").update(billing).eq("id", org.data.id);
        if (updated.error) throw new Error(updated.error.message);
      }
    }
    const recorded = await db.from("stripe_events").upsert({ id: event.id, type: event.type }, { ignoreDuplicates: true });
    if (recorded.error) throw new Error(recorded.error.message);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook failed", event.id, event.type, error);
    return refuse(500, "Couldn't apply the event.");
  }
}
