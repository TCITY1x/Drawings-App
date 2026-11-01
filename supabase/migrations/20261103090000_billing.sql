-- Billing: a company can change its projects and drawings only while its
-- trial is running or its subscription is in good standing. Reading stays
-- open, so a lapsed company can still see and download its own drawings.
--
-- The Stripe webhook (service role) keeps `plan`, `plan_status`, `seats` and
-- the subscription id in step; `stripe_events` makes each event count once.
-- Keep `org_active` in step with `isActive` in `src/lib/billing.ts`.

alter table public.organisations add column stripe_subscription_id text unique;

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
-- Service role only: RLS on, no policies.
alter table public.stripe_events enable row level security;

create function public.org_active(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisations o
    where o.id = org and (
      (o.plan = 'team' and o.plan_status in ('active', 'trialing', 'past_due'))
      or (o.plan = 'trial' and o.trial_ends_at > now())
    )
  );
$$;

create function public.can_change_project(project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    join public.organisation_members m on m.organisation_id = p.organisation_id
    where p.id = project and m.user_id = (select auth.uid()) and public.org_active(p.organisation_id)
  );
$$;

-- Projects: read as a member; add or change only while active; delete any time.
drop policy "members use projects" on public.projects;
create policy "members read projects" on public.projects
  for select to authenticated using (public.is_member(organisation_id));
create policy "members add projects while active" on public.projects
  for insert to authenticated with check (public.is_member(organisation_id) and public.org_active(organisation_id));
create policy "members change projects while active" on public.projects
  for update to authenticated
  using (public.is_member(organisation_id) and public.org_active(organisation_id))
  with check (public.is_member(organisation_id) and public.org_active(organisation_id));
create policy "members delete projects" on public.projects
  for delete to authenticated using (public.is_member(organisation_id));

-- Drawings, markups and packages: the same, through their project.
drop policy "members use drawings" on public.drawings;
create policy "members read drawings" on public.drawings
  for select to authenticated using (public.can_use_project(project_id));
create policy "members add drawings while active" on public.drawings
  for insert to authenticated with check (public.can_change_project(project_id));
create policy "members change drawings while active" on public.drawings
  for update to authenticated using (public.can_change_project(project_id)) with check (public.can_change_project(project_id));
create policy "members delete drawings" on public.drawings
  for delete to authenticated using (public.can_use_project(project_id));

drop policy "members use markups" on public.drawing_markups;
create policy "members read markups" on public.drawing_markups
  for select to authenticated using (public.can_use_project(project_id));
create policy "members add markups while active" on public.drawing_markups
  for insert to authenticated with check (public.can_change_project(project_id));
create policy "members change markups while active" on public.drawing_markups
  for update to authenticated using (public.can_change_project(project_id)) with check (public.can_change_project(project_id));
create policy "members delete markups" on public.drawing_markups
  for delete to authenticated using (public.can_use_project(project_id));

drop policy "members use packages" on public.commissioning_packages;
create policy "members read packages" on public.commissioning_packages
  for select to authenticated using (public.can_use_project(project_id));
create policy "members add packages while active" on public.commissioning_packages
  for insert to authenticated with check (public.can_change_project(project_id));
create policy "members change packages while active" on public.commissioning_packages
  for update to authenticated using (public.can_change_project(project_id)) with check (public.can_change_project(project_id));
create policy "members delete packages" on public.commissioning_packages
  for delete to authenticated using (public.can_use_project(project_id));

-- Drawing files: upload or replace only while active.
drop policy "members add drawing files" on storage.objects;
drop policy "members replace drawing files" on storage.objects;
create policy "members add drawing files while active" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'drawings' and public.can_change_project(((storage.foldername(name))[1])::uuid));
create policy "members replace drawing files while active" on storage.objects
  for update to authenticated
  using (bucket_id = 'drawings' and public.can_change_project(((storage.foldername(name))[1])::uuid));

-- Invitations are blocked while lapsed too (the seat check already applies).
drop policy "admins invite" on public.invitations;
create policy "admins invite while active" on public.invitations
  for insert to authenticated
  with check (public.is_admin(organisation_id) and invited_by = (select auth.uid()) and public.org_active(organisation_id));

-- The guard on billing columns covers the new one too.
create or replace function public.guard_billing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.plan := 'trial';
    new.plan_status := 'trialing';
    new.trial_ends_at := now() + interval '14 days';
    new.seats := 5;
    return new;
  end if;
  if (
    new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
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
