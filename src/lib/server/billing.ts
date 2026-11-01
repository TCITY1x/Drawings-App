import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { stripeForm } from "@/lib/billing";

/**
 * Server-side billing plumbing for the `/api/billing/*` and `/api/stripe/*`
 * routes: Stripe's REST API, the service-role database client, and who is
 * asking. Never import this from a client component — it reads secret keys.
 */

export interface BillingConfig {
  stripeKey: string;
  priceId: string;
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
}

/** Everything billing needs, or null when any of it isn't set on this deployment. */
export function billingConfig(): BillingConfig | null {
  const config = {
    stripeKey: process.env.STRIPE_SECRET_KEY ?? "",
    priceId: process.env.STRIPE_PRICE_ID ?? "",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
  return Object.values(config).every(Boolean) ? config : null;
}

export function refuse(status: number, error: string, code?: string) {
  return Response.json({ error, code }, { status });
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Call Stripe's API. `idempotencyKey` makes a retried create return the first result. */
export async function stripe<T>(
  key: string,
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown> = {},
  idempotencyKey?: string
): Promise<T> {
  const query = stripeForm(params);
  const response = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: method === "POST" ? query : undefined,
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new StripeError(body.error?.message ?? `Stripe answered ${response.status}.`, response.status);
  return body;
}

/** The service-role client: bypasses row-level security, so only for the billing columns. */
export function serviceClient(config: BillingConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The signed-in user behind the request's bearer token, or null. */
export async function signedInUser(config: BillingConfig, request: Request): Promise<{ id: string; email: string } | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await createClient(config.supabaseUrl, config.anonKey).auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

export interface BilledOrganisation {
  id: string;
  name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  plan_status: string;
}

/**
 * The organisation, if the user is its owner — billing is the owners' job.
 * Read with the service role, so the check doesn't depend on client policies.
 */
export async function ownedOrganisation(
  db: SupabaseClient,
  organisationId: string,
  userId: string
): Promise<BilledOrganisation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(organisationId)) return null;
  const member = await db
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (member.error || member.data?.role !== "owner") return null;
  const org = await db
    .from("organisations")
    .select("id, name, stripe_customer_id, stripe_subscription_id, plan, plan_status")
    .eq("id", organisationId)
    .maybeSingle();
  return org.error ? null : (org.data as BilledOrganisation | null);
}

/** Where Stripe sends people back to: SITEPAX_SITE_URL, or the address this request came to. */
export function siteUrl(request: Request): string {
  return (process.env.SITEPAX_SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}
