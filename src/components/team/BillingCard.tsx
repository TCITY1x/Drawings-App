"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import { postJson } from "@/lib/authedFetch";
import { GOOD_STANDING, MAX_SEATS, isActive, seatChoice, trialDaysLeft } from "@/lib/billing";
import { formatDate } from "@/lib/format";

const PRICE = process.env.NEXT_PUBLIC_SITEPAX_PRICE ?? "";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Active",
  past_due: "Payment overdue",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete_expired: "Payment never completed",
  paused: "Paused",
};

/**
 * The company's plan: the trial's days left, or the subscription's state and
 * seats. The owner chooses a plan (Stripe Checkout) or manages it (Stripe's
 * billing portal); everyone else sees where things stand.
 */
export function BillingCard() {
  const { cloud } = useWorkspace();
  const params = useSearchParams();
  const [seats, setSeats] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(params.get("billing") === "success");
  const membership = cloud?.membership;
  const refresh = useRef(cloud?.refreshCompanies);
  useEffect(() => {
    refresh.current = cloud?.refreshCompanies;
  });

  const paying = membership?.plan === "team" && GOOD_STANDING.includes(membership.planStatus);

  // Back from Checkout: the webhook usually lands within seconds; look a few times.
  useEffect(() => {
    if (!waiting) return;
    if (paying) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaiting(false);
      return;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void refresh.current?.();
      if (tries >= 10) {
        window.clearInterval(timer);
        setWaiting(false);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [waiting, paying]);

  if (!cloud || !membership) return null;
  const owner = membership.role === "owner";
  const chosen = seatChoice(seats || Math.max(cloud.team.length, membership.seats), cloud.team.length);
  const days = trialDaysLeft(membership.trialEndsAt);
  const active = isActive(membership);

  const go = async (route: string, body: object) => {
    setBusy(true);
    setProblem(null);
    try {
      const { url } = await postJson<{ url: string }>(route, body);
      window.location.assign(url);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't work.");
      setBusy(false);
    }
  };

  return (
    <section id="billing" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Plan</h2>
        {PRICE && <span className="text-sm text-slate-600 dark:text-slate-400">{PRICE}</span>}
      </div>

      {membership.plan === "trial" ? (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {days > 0
            ? `Free trial — ${days} day${days === 1 ? "" : "s"} left (ends ${formatDate(membership.trialEndsAt)}). ${membership.seats} seats.`
            : "The free trial has ended. Projects are read-only until a plan is chosen."}
        </p>
      ) : (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Team plan · {STATUS_LABEL[membership.planStatus] ?? membership.planStatus} · {membership.seats} seat
          {membership.seats === 1 ? "" : "s"}
          {!active && " — projects are read-only until it's renewed."}
        </p>
      )}

      {waiting && (
        <p role="status" className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-200">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Payment received — updating your plan…
        </p>
      )}

      {!owner ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">The company&apos;s owner manages billing.</p>
      ) : paying ? (
        <Button onClick={() => void go("/api/billing/portal", { organisationId: membership.organisationId })} disabled={busy}>
          <span className="inline-flex items-center gap-1.5">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CreditCard size={15} aria-hidden="true" />}
            Manage billing — seats, card, invoices
          </span>
        </Button>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Seats</span>
            <input
              type="number"
              min={Math.max(1, cloud.team.length)}
              max={MAX_SEATS}
              value={chosen}
              onChange={(e) => setSeats(Number(e.target.value))}
              className={`${inputClass} w-24`}
            />
          </label>
          <Button
            variant="primary"
            disabled={busy || waiting}
            onClick={() => void go("/api/billing/checkout", { organisationId: membership.organisationId, seats: chosen })}
          >
            <span className="inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CreditCard size={15} aria-hidden="true" />}
              Choose the Team plan
            </span>
          </Button>
          {membership.hasBillingAccount && (
            <Button variant="ghost" disabled={busy} onClick={() => void go("/api/billing/portal", { organisationId: membership.organisationId })}>
              Past invoices
            </Button>
          )}
        </div>
      )}

      {problem && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{problem}</p>}
    </section>
  );
}
