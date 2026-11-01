import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase access. Never import this from a client component:
 * the service-role key bypasses row-level security.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** The user a request's bearer token belongs to, or null. */
export async function requestUser(request: Request): Promise<{ id: string; email: string } | null> {
  if (!url || !anonKey) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await createClient(url, anonKey, { auth: { persistSession: false } }).auth.getUser(token);
  return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? "" };
}

let admin: SupabaseClient | null = null;

/** The service-role client, for billing writes only. Throws when not configured. */
export function adminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY isn't set.");
  if (!admin) admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
