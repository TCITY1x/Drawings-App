import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

/** The Stripe client, or null when billing isn't configured. */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key, { appInfo: { name: "SitePax" } });
  return client;
}

/** Where Stripe sends people back to: the configured site, else this request's own origin. */
export function siteUrl(request: Request): string {
  return (process.env.SITEPAX_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
}
