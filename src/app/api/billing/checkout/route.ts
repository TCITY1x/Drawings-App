import { GOOD_STANDING, MAX_SEATS, seatChoice } from "@/lib/billing";
import { ownedOrganisation } from "@/lib/server/billing";
import { siteUrl, stripeClient } from "@/lib/server/stripe";
import { adminClient, requestUser } from "@/lib/server/supabase";

/**
 * Start a subscription: a Stripe Checkout page for the company's seats. Only
 * the company's owner may; a company already paying manages its plan in the
 * billing portal instead.
 */
export async function POST(request: Request) {
  const stripe = stripeClient();
  const price = process.env.STRIPE_PRICE_ID;
  if (!stripe || !price) return Response.json({ error: "Billing isn't set up yet." }, { status: 503 });
  const user = await requestUser(request);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { organisationId?: unknown; seats?: unknown };
  if (typeof body.organisationId !== "string") return Response.json({ error: "Which company?" }, { status: 400 });
  const org = await ownedOrganisation(user.id, body.organisationId);
  if (!org) return Response.json({ error: "Only the company's owner can choose a plan." }, { status: 403 });
  if (org.plan === "team" && GOOD_STANDING.includes(org.planStatus)) {
    return Response.json({ error: "The company already has a plan — change it under Manage billing." }, { status: 409 });
  }

  let customer = org.stripeCustomerId;
  if (!customer) {
    const created = await stripe.customers.create({ email: user.email, name: org.name, metadata: { organisation_id: org.id } });
    customer = created.id;
    const { error } = await adminClient().from("organisations").update({ stripe_customer_id: customer }).eq("id", org.id);
    if (error) return Response.json({ error: `Couldn't save the billing account: ${error.message}` }, { status: 500 });
  }

  const seats = seatChoice(Number(body.seats), org.members);
  const site = siteUrl(request);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: org.id,
    line_items: [
      { price, quantity: seats, adjustable_quantity: { enabled: true, minimum: Math.max(1, org.members), maximum: MAX_SEATS } },
    ],
    subscription_data: { metadata: { organisation_id: org.id } },
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    success_url: `${site}/settings?billing=success`,
    cancel_url: `${site}/settings?billing=cancelled`,
  });
  if (!session.url) return Response.json({ error: "Stripe didn't return a checkout page." }, { status: 502 });
  return Response.json({ url: session.url });
}
