"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import { sendSignInLink, verifySignInCode } from "@/lib/cloudWorkspace";
import { isEmail } from "@/lib/email";
import { getSupabase } from "@/lib/supabase/client";

function Card({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{lead}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

/**
 * Sign in without a password: SitePax emails a link (and a code, for when
 * the link opens in a different browser from this one — common on a tablet).
 */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const supabase = getSupabase();

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  if (!supabase) return null;

  if (sentTo) {
    return (
      <Card title="Check your email" lead={`We sent a sign-in link to ${sentTo}. Open it on this device, or type the code from the email here.`}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => verifySignInCode(supabase, sentTo, code));
          }}
        >
          <Field label="Code from the email">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`${inputClass} font-mono tracking-widest`}
            />
          </Field>
          {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{problem}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || code.length < 6}>
            Sign in
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => (setSentTo(null), setCode(""))}>
            Use a different email
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <Card title="Sign in to SitePax" lead="New here? The same step makes your account.">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isEmail(email)) return setProblem("That isn't an email address.");
          void run(async () => {
            await sendSignInLink(supabase, email);
            setSentTo(email.trim());
          });
        }}
      >
        <Field label="Work email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={inputClass} />
        </Field>
        {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{problem}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          <span className="inline-flex items-center gap-1.5">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Mail size={15} aria-hidden="true" />}
            Email me a sign-in link
          </span>
        </Button>
      </form>
    </Card>
  );
}

/** Signed in, but in no company yet: start one. (Invited people join theirs automatically when they sign in.) */
export function CreateCompany() {
  const { cloud } = useWorkspace();
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!cloud) return null;

  return (
    <Card
      title="Set up your company"
      lead="Projects, drawings and your team belong to the company. If a colleague has invited you, ask them to check the address they used — you'll join their company as soon as you sign in with it."
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!company.trim() || !name.trim()) return;
          setBusy(true);
          setProblem(null);
          cloud
            .createCompany(company, name)
            .catch((error) => setProblem(error instanceof Error ? error.message : "Couldn't create the company."))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Company name">
          <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" required className={inputClass} />
        </Field>
        <Field label="Your name — goes on markups and sign-offs">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required className={inputClass} />
        </Field>
        {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{problem}</p>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !company.trim() || !name.trim()}>
          Start my 14-day trial
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => void cloud.signOut()}>
          Sign out
        </Button>
      </form>
    </Card>
  );
}
