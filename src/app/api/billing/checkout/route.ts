import { MAX_SEATS, seatsToBuy } from "@/lib/billing";
import { billingConfig, ownedOrganisation, refuse, serviceClient, signedInUser, siteUrl, stripe, StripeError } from "@/lib/server/billing";

/**
 * Start a subscription: a Stripe Checkout page for the company's seats.
 * Only an owner may. The Stripe customer is made once per company and kept on
 * the organisation; the webhook then records the subscription.
 */
export async function POST(request: Request) {
  const config = billingConfig();
  if (!config) return refuse(503, "Billing isn't set up on this SitePax yet.", "billing-not-configured");
  const user = await signedInUser(config, request);
  if (!user) return refuse(401, "Sign in to manage billing.", "sign-in-required");
  const body = (await request.json().catch(() => null)) as { organisationId?: unknown; seats?: unknown } | null;
  const db = serviceClient(config);
  const org = await ownedOrganisation(db, String(body?.organisationId ?? ""), user.id);
  if (!org) return refuse(403, "Only the company's owner can change its billing.", "not-owner");
  if (org.plan === "team" && org.stripe_subscription_id) {
    return refuse(409, "This company already has a subscription — change it under Manage billing.", "already-subscribed");
  }

  const [members, invitations] = await Promise.all([
    db.from("organisation_members").select("user_id", { count: "exact", head: true }).eq("organisation_id", org.id),
    db.from("invitations").select("id", { count: "exact", head: true }).eq("organisation_id", org.id),
  ]);
  if (members.error || invitations.error) return refuse(500, "Couldn't count the company's seats.");
  const taken = (members.count ?? 0) + (invitations.count ?? 0);
  const seats = seatsToBuy(body?.seats, taken);

  try {
    let customer = org.stripe_customer_id;
    if (!customer) {
      const created = await stripe<{ id: string }>(
        config.stripeKey,
        "POST",
        "customers",
        { name: org.name, email: user.email || undefined, metadata: { organisation_id: org.id } },
        `sitepax-customer-${org.id}`
      );
      customer = created.id;
      // Only if still unset, so two owners subscribing at once keep one customer.
      const saved = await db
        .from("organisations")
        .update({ stripe_customer_id: customer })
        .eq("id", org.id)
        .is("stripe_customer_id", null)
        .select("stripe_customer_id");
      if (saved.error) return refuse(500, "Couldn't save the billing customer.");
      if (saved.data.length === 0) {
        const again = await db.from("organisations").select("stripe_customer_id").eq("id", org.id).single();
        customer = (again.data?.stripe_customer_id as string | null) ?? customer;
      }
    }

    const site = siteUrl(request);
    const session = await stripe<{ url: string }>(config.stripeKey, "POST", "checkout/sessions", {
      mode: "subscription",
      customer,
      client_reference_id: org.id,
      line_items: [
        {
          price: config.priceId,
          quantity: seats,
          adjustable_quantity: { enabled: true, minimum: Math.max(1, Math.min(taken, MAX_SEATS)), maximum: MAX_SEATS },
        },
      ],
      subscription_data: { metadata: { organisation_id: org.id } },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      customer_update: { name: "auto", address: "auto" },
      allow_promotion_codes: true,
      success_url: `${site}/settings?billing=done`,
      cancel_url: `${site}/settings?billing=cancelled`,
    });
    return Response.json({ url: session.url });
  } catch (error) {
    const message = error instanceof StripeError ? error.message : "Stripe couldn't be reached.";
    return refuse(502, `Couldn't start the checkout: ${message}`);
  }
}
