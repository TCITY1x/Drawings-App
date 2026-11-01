-- FieldMark core schema: organisations, their members and projects, and each
-- project's drawing register, markups and commissioning packages.
--
-- Every row belongs to one organisation. Row-level security lets a signed-in
-- user see and change only the rows of organisations they are a member of.
-- Child rows (drawings, markups, packages) take their organisation from their
-- project, set by trigger, so the app never has to send it and can't forge it.
--
-- Drawing, markup and package documents are kept whole in `data` (jsonb) —
-- the shapes the app's sanitize* functions read back — with the columns
-- needed for access and lookups pulled out beside them.

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  -- Billing, kept in step by the Stripe webhook.
  stripe_customer_id text unique,
  plan text not null default 'trial' check (plan in ('trial', 'team', 'cancelled')),
  plan_status text not null default 'trialing',
  trial_ends_at timestamptz not null default now() + interval '14 days',
  seats integer not null default 5
);

create table public.organisation_members (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create index organisation_members_user on public.organisation_members (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_organisation on public.projects (organisation_id);

create table public.drawings (
  id text primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  organisation_id uuid references public.organisations (id) on delete cascade,
  data jsonb not null,
  client_id text not null default '',
  updated_at timestamptz not null default now()
);
create index drawings_project on public.drawings (project_id);

create table public.drawing_markups (
  id text primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  organisation_id uuid references public.organisations (id) on delete cascade,
  data jsonb not null,
  client_id text not null default '',
  updated_at timestamptz not null default now()
);
create index drawing_markups_project on public.drawing_markups (project_id);

create table public.commissioning_packages (
  id text primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  organisation_id uuid references public.organisations (id) on delete cascade,
  data jsonb not null,
  client_id text not null default '',
  updated_at timestamptz not null default now()
);
create index commissioning_packages_project on public.commissioning_packages (project_id);

-- Membership check used by every policy. SECURITY DEFINER so the policy on
-- organisation_members can call it without recursing into itself.
create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_members m
    where m.organisation_id = org and m.user_id = (select auth.uid())
  );
$$;

create function public.is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organisation_members m
    where m.organisation_id = org and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;

create function public.can_use_project(project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    join public.organisation_members m on m.organisation_id = p.organisation_id
    where p.id = project and m.user_id = (select auth.uid())
  );
$$;

-- A child row's organisation is always its project's.
create function public.set_organisation_from_project() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select p.organisation_id into new.organisation_id from public.projects p where p.id = new.project_id;
  new.updated_at := now();
  return new;
end;
$$;

create trigger drawings_organisation before insert or update on public.drawings
  for each row execute function public.set_organisation_from_project();
create trigger drawing_markups_organisation before insert or update on public.drawing_markups
  for each row execute function public.set_organisation_from_project();
create trigger commissioning_packages_organisation before insert or update on public.commissioning_packages
  for each row execute function public.set_organisation_from_project();

-- Someone who makes an organisation is its owner.
create function public.add_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organisation_members (organisation_id, user_id, role, email)
  values (new.id, (select auth.uid()), 'owner', coalesce((select email from auth.users where id = (select auth.uid())), ''));
  return new;
end;
$$;
create trigger organisations_owner after insert on public.organisations
  for each row execute function public.add_owner();

alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.projects enable row level security;
alter table public.drawings enable row level security;
alter table public.drawing_markups enable row level security;
alter table public.commissioning_packages enable row level security;

-- Organisations: members read; admins rename; any signed-in user may start one.
-- Billing columns are written only by the webhook (service role).
create policy "members read their organisation" on public.organisations
  for select to authenticated using (public.is_member(id));
create policy "signed-in users create organisations" on public.organisations
  for insert to authenticated with check (true);
create policy "admins update their organisation" on public.organisations
  for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

-- Supabase grants INSERT and UPDATE on the whole table, so a column-level
-- revoke would do nothing: a trigger keeps the billing columns to the service
-- role (the Stripe webhook).
create function public.guard_billing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A new organisation always starts on the trial, whatever was sent.
    new.stripe_customer_id := null;
    new.plan := 'trial';
    new.plan_status := 'trialing';
    new.trial_ends_at := now() + interval '14 days';
    new.seats := 5;
    return new;
  end if;
  if (
    new.stripe_customer_id is distinct from old.stripe_customer_id
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
create trigger organisations_billing before insert or update on public.organisations
  for each row execute function public.guard_billing();

-- Members: everyone in an organisation sees its team; admins manage it.
create policy "members read the team" on public.organisation_members
  for select to authenticated using (public.is_member(organisation_id));
create policy "admins manage the team" on public.organisation_members
  for all to authenticated using (public.is_admin(organisation_id)) with check (public.is_admin(organisation_id));

-- Projects and everything in them: any member, read and write.
create policy "members use projects" on public.projects
  for all to authenticated using (public.is_member(organisation_id)) with check (public.is_member(organisation_id));
create policy "members use drawings" on public.drawings
  for all to authenticated using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
create policy "members use markups" on public.drawing_markups
  for all to authenticated using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
create policy "members use packages" on public.commissioning_packages
  for all to authenticated using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));

-- Drawing PDFs: a private bucket, one folder per project (`<project id>/…`).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drawings', 'drawings', false, 104857600, array['application/pdf', 'image/png']);

create policy "members read drawing files" on storage.objects
  for select to authenticated
  using (bucket_id = 'drawings' and public.can_use_project(((storage.foldername(name))[1])::uuid));
create policy "members add drawing files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'drawings' and public.can_use_project(((storage.foldername(name))[1])::uuid));
create policy "members replace drawing files" on storage.objects
  for update to authenticated
  using (bucket_id = 'drawings' and public.can_use_project(((storage.foldername(name))[1])::uuid));
create policy "members delete drawing files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'drawings' and public.can_use_project(((storage.foldername(name))[1])::uuid));
