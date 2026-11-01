import type Stripe from "stripe";
import { applySubscription } from "@/lib/server/billing";
import { stripeClient } from "@/lib/server/stripe";
import { adminClient } from "@/lib/server/supabase";

/**
 * Stripe tells SitePax when a subscription starts, changes or ends. The
 * signature proves it's Stripe; each event is recorded once in
 * `stripe_events`, and released again if handling it fails, so Stripe's retry
 * gets another go. The subscription is always re-read from Stripe rather than
 * trusted from the event, so late or out-of-order events can't regress a plan.
 */

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

function subscriptionId(event: Stripe.Event): string | null {
  const object = event.data.object as { object?: string; id?: string; subscription?: string | { id: string } | null };
  if (object.object === "subscription") return object.id ?? null;
  if (object.object === "checkout.session") {
    const sub = object.subscription;
    return typeof sub === "string" ? sub : (sub?.id ?? null);
  }
  return null;
}

export async function POST(request: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return new Response("Billing isn't set up.", { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature.", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch {
    return new Response("Bad signature.", { status: 400 });
  }
  if (!HANDLED.has(event.type)) return Response.json({ received: true, ignored: event.type });

  const db = adminClient();
  const { error: seenError } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (seenError) {
    if (seenError.code === "23505") return Response.json({ received: true, duplicate: true });
    return new Response(`Couldn't record the event: ${seenError.message}`, { status: 500 });
  }

  try {
    const id = subscriptionId(event);
    if (id) await applySubscription(await stripe.subscriptions.retrieve(id));
    return Response.json({ received: true });
  } catch (error) {
    await db.from("stripe_events").delete().eq("id", event.id);
    return new Response(error instanceof Error ? error.message : "Couldn't handle the event.", { status: 500 });
  }
}
