-- Billing: one Stripe subscription per organisation, priced per seat.
--
-- The owner starts a subscription from the Team page (Stripe Checkout) and
-- manages it in Stripe's billing portal. The webhook (`/api/stripe/webhook`,
-- service role) keeps `plan`, `plan_status`, `seats` and the columns below in
-- step with Stripe; `guard_billing` (core migration) stops anyone else
-- changing them.

alter table public.organisations
  add column stripe_subscription_id text unique,
  add column current_period_ends_at timestamptz,
  add column cancel_at_period_end boolean not null default false;

-- Keep the new billing columns to the service role as well.
create or replace function public.guard_billing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A new organisation always starts on the trial, whatever was sent.
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.current_period_ends_at := null;
    new.cancel_at_period_end := false;
    new.plan := 'trial';
    new.plan_status := 'trialing';
    new.trial_ends_at := now() + interval '14 days';
    new.seats := 5;
    return new;
  end if;
  if (
    new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.current_period_ends_at is distinct from old.current_period_ends_at
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.plan is distinct from old.plan
    or new.plan_status is distinct from old.plan_status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.seats is distinct from old.seats
  ) then
    raise exception 'Billing details are changed through the billing page.';
  end if;
  return new;
end;
$$;

-- Stripe events already handled, so a redelivered event is applied once.
-- Only the webhook (service role, which bypasses RLS) touches it: RLS is on
-- with no policies, and the client roles have no grants.
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from public, anon, authenticated;
