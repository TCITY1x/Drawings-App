"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";

/**
 * Where the sign-in email's link lands. The browser client may already have
 * swapped the link's code for a session on load; otherwise it's done here.
 */
export default function AuthCallback() {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return router.replace("/projects");
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;
    const failed = params.get("error_description");
    (async () => {
      if (failed) throw new Error(failed);
      const existing = await supabase.auth.getSession();
      if (!existing.data.session) {
        const { error } = tokenHash && type
          ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
          : code
            ? await supabase.auth.exchangeCodeForSession(code)
            : { error: new Error("This sign-in link is incomplete.") };
        if (error) {
          // The client may have used the code a moment ago; trust a session if there is one.
          const again = await supabase.auth.getSession();
          if (!again.data.session) throw error;
        }
      }
      router.replace("/projects");
    })().catch((error) =>
      setProblem(
        `${error instanceof Error ? error.message : "That link didn't work."} Links work once, in the browser you asked from — use the code in the email instead.`
      )
    );
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      {problem ? (
        <div className="max-w-md text-center">
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">{problem}</p>
          <Link href="/projects" className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
            Back to sign in
          </Link>
        </div>
      ) : (
        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Signing you in…</p>
      )}
    </main>
  );
}
