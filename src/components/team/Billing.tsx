"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import { trialDaysLeft } from "@/lib/billing";
import { billingPage } from "@/lib/cloudWorkspace";
import { formatDate } from "@/lib/format";

/** Shown beside the seat count, e.g. "A$25 per user per month". Optional. */
const PRICE_LABEL = process.env.NEXT_PUBLIC_SITEPAX_PRICE_LABEL ?? "";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Active",
  past_due: "Payment overdue",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete_expired: "Payment failed",
  paused: "Paused",
};

/** Cloud mode, on the Team page: the company's plan, and for owners, subscribing and managing it in Stripe. */
export function Billing() {
  const { cloud } = useWorkspace();
  const [seats, setSeats] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [returned, setReturned] = useState<"done" | "cancelled" | null>(null);
  const membership = cloud?.membership ?? null;
  const refreshCompanies = cloud?.refreshCompanies;
  const subscribed = membership?.plan === "team";

  // Back from Checkout: the webhook may land a moment after the browser does.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("billing");
    if (result !== "done" && result !== "cancelled") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReturned(result);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => {
    if (returned !== "done" || subscribed || !refreshCompanies) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void refreshCompanies().catch(() => undefined);
      if (tries >= 10) window.clearInterval(timer);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [returned, subscribed, refreshCompanies]);

  if (!cloud || !membership) return null;
  const owner = membership.role === "owner";
  const taken = cloud.team.length + cloud.invitations.length;
  const wanted = Math.max(seats || membership.seats, taken, 1);
  const daysLeft = trialDaysLeft(membership.trialEndsAt);

  const open = async (which: "checkout" | "portal") => {
    setBusy(true);
    setProblem(null);
    try {
      window.location.assign(await billingPage(cloud.supabase, which, membership.organisationId, wanted));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Billing couldn't be opened.");
      setBusy(false);
    }
  };

  let summary: string;
  if (membership.plan === "trial") {
    summary = daysLeft > 0 ? `Free trial — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left (ends ${formatDate(membership.trialEndsAt)}).` : "The free trial has ended.";
  } else if (subscribed) {
    const status = STATUS_LABEL[membership.planStatus] ?? membership.planStatus;
    const period = membership.currentPeriodEndsAt
      ? membership.cancelAtPeriodEnd
        ? ` Ends ${formatDate(membership.currentPeriodEndsAt)}.`
        : ` Renews ${formatDate(membership.currentPeriodEndsAt)}.`
      : "";
    summary = `Team plan, ${membership.seats} seat${membership.seats === 1 ? "" : "s"} — ${status}.${period}`;
  } else {
    summary = "The subscription has ended.";
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Billing</h2>
        {PRICE_LABEL && <span className="text-sm text-slate-600 dark:text-slate-400">{PRICE_LABEL}</span>}
      </div>
      <p className="text-sm">{summary}</p>
      {membership.planStatus === "past_due" && (
        <p className="text-sm text-amber-800 dark:text-amber-300">The last payment didn&apos;t go through. Update the card under Manage billing.</p>
      )}
      {returned === "done" && !subscribed && (
        <p role="status" className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Payment received — updating the plan…
        </p>
      )}
      {returned === "done" && subscribed && (
        <p role="status" className="text-sm text-brand-700 dark:text-brand-300">Thanks — you&apos;re subscribed.</p>
      )}
      {returned === "cancelled" && <p className="text-sm text-slate-600 dark:text-slate-400">Checkout was cancelled; nothing was charged.</p>}

      {!owner ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">The company&apos;s owner manages billing.</p>
      ) : subscribed ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={busy} onClick={() => void open("portal")}>
            <span className="inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CreditCard size={15} aria-hidden="true" />} Manage billing
            </span>
          </Button>
          <span className="text-sm text-slate-600 dark:text-slate-400">Change seats, the card, or download invoices.</span>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void open("checkout");
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            Seats
            <input
              type="number"
              min={Math.max(taken, 1)}
              max={500}
              value={wanted}
              onChange={(e) => setSeats(Number(e.target.value))}
              className={`${inputClass} w-24`}
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CreditCard size={15} aria-hidden="true" />} Subscribe
            </span>
          </Button>
          {membership.hasBillingAccount && (
            <Button variant="ghost" disabled={busy} onClick={() => void open("portal")}>
              Invoices
            </Button>
          )}
          <span className="basis-full text-xs text-slate-500">
            At least {Math.max(taken, 1)} — everyone in the company and everyone invited. Paid securely through Stripe.
          </span>
        </form>
      )}
      {problem && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {problem}
        </p>
      )}
    </section>
  );
}
