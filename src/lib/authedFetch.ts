import { getSupabase } from "@/lib/supabase/client";

/** fetch() with the signed-in user's token, so a route can check who is asking. */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const session = await getSupabase()?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** POST JSON to one of SitePax's routes; the parsed reply, or the route's own error message thrown. */
export async function postJson<T>(input: string, body: unknown): Promise<T> {
  const response = await authedFetch(input, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `That didn't work (${response.status}).`);
  return result;
}
