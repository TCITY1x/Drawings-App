import { billingConfig, ownedOrganisation, refuse, serviceClient, signedInUser, siteUrl, stripe, StripeError } from "@/lib/server/billing";

/** Stripe's billing portal, for an owner: seats, card, invoices, cancelling. */
export async function POST(request: Request) {
  const config = billingConfig();
  if (!config) return refuse(503, "Billing isn't set up on this SitePax yet.", "billing-not-configured");
  const user = await signedInUser(config, request);
  if (!user) return refuse(401, "Sign in to manage billing.", "sign-in-required");
  const body = (await request.json().catch(() => null)) as { organisationId?: unknown } | null;
  const org = await ownedOrganisation(serviceClient(config), String(body?.organisationId ?? ""), user.id);
  if (!org) return refuse(403, "Only the company's owner can change its billing.", "not-owner");
  if (!org.stripe_customer_id) return refuse(409, "This company hasn't subscribed yet.", "no-customer");
  try {
    const session = await stripe<{ url: string }>(config.stripeKey, "POST", "billing_portal/sessions", {
      customer: org.stripe_customer_id,
      return_url: `${siteUrl(request)}/settings`,
    });
    return Response.json({ url: session.url });
  } catch (error) {
    const message = error instanceof StripeError ? error.message : "Stripe couldn't be reached.";
    return refuse(502, `Couldn't open billing: ${message}`);
  }
}
