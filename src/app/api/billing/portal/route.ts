import { ownedOrganisation } from "@/lib/server/billing";
import { siteUrl, stripeClient } from "@/lib/server/stripe";
import { requestUser } from "@/lib/server/supabase";

/** Stripe's billing portal, for the owner: change seats, update the card, see invoices, cancel. */
export async function POST(request: Request) {
  const stripe = stripeClient();
  if (!stripe) return Response.json({ error: "Billing isn't set up yet." }, { status: 503 });
  const user = await requestUser(request);
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { organisationId?: unknown };
  if (typeof body.organisationId !== "string") return Response.json({ error: "Which company?" }, { status: 400 });
  const org = await ownedOrganisation(user.id, body.organisationId);
  if (!org) return Response.json({ error: "Only the company's owner can manage billing." }, { status: 403 });
  if (!org.stripeCustomerId) return Response.json({ error: "There's no billing account yet — choose a plan first." }, { status: 409 });
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${siteUrl(request)}/settings?billing=portal`,
  });
  return Response.json({ url: session.url });
}
