-- Accounts: each member's own details and settings, and invitations.
--
-- Joining works without FieldMark sending any email of its own: an admin
-- invites an address, the person signs in with that address (Supabase sends
-- the sign-in link), and `accept_invitations()` adds them to every
-- organisation that invited them.

alter table public.organisation_members
  add column settings jsonb not null default '{}'::jsonb;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and email like '%_@_%'),
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organisation_id, email)
);
alter table public.invitations enable row level security;

create policy "members see invitations" on public.invitations
  for select to authenticated using (public.is_member(organisation_id));
create policy "admins invite" on public.invitations
  for insert to authenticated with check (public.is_admin(organisation_id) and invited_by = (select auth.uid()));
create policy "admins withdraw invitations" on public.invitations
  for delete to authenticated using (public.is_admin(organisation_id));

-- Join every organisation that invited the signed-in user's email. Returns
-- how many were joined. Seats are checked here so an invite can't overfill a plan.
create function public.accept_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  my_email text := lower((select email from auth.users where id = (select auth.uid())));
  invite record;
  joined integer := 0;
begin
  if me is null or my_email is null then
    return 0;
  end if;
  for invite in
    select i.* from public.invitations i where i.email = my_email
  loop
    if (select count(*) from public.organisation_members m where m.organisation_id = invite.organisation_id)
       < (select o.seats from public.organisations o where o.id = invite.organisation_id) then
      insert into public.organisation_members (organisation_id, user_id, role, email)
      values (invite.organisation_id, me, invite.role, my_email)
      on conflict (organisation_id, user_id) do nothing;
      delete from public.invitations where id = invite.id;
      joined := joined + 1;
    end if;
  end loop;
  return joined;
end;
$$;

-- A member changes their own name and settings — not their role, which only
-- an admin can change through the team policy.
create function public.update_my_membership(org uuid, new_name text, new_settings jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.organisation_members
  set name = left(trim(new_name), 120), settings = coalesce(new_settings, '{}'::jsonb)
  where organisation_id = org and user_id = (select auth.uid());
$$;

-- An organisation always keeps an owner: the last one can't be removed or demoted.
create function public.keep_an_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') and not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = old.organisation_id and m.role = 'owner' and m.user_id <> old.user_id
  ) and exists (select 1 from public.organisations o where o.id = old.organisation_id) then
    raise exception 'A company needs at least one owner.';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger organisation_members_owner before update or delete on public.organisation_members
  for each row execute function public.keep_an_owner();

-- Only an owner may make or unmake owners.
create function public.guard_owner_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then
    return new;
  end if;
  if (new.role = 'owner' or (tg_op = 'UPDATE' and old.role = 'owner'))
     and not exists (
       select 1 from public.organisation_members m
       where m.organisation_id = new.organisation_id and m.user_id = (select auth.uid()) and m.role = 'owner'
     )
     -- The organisation's creator becoming its first owner (the add_owner trigger).
     and exists (select 1 from public.organisation_members m where m.organisation_id = new.organisation_id) then
    raise exception 'Only an owner can change who owns the company.';
  end if;
  return new;
end;
$$;
create trigger organisation_members_owner_role before insert or update on public.organisation_members
  for each row execute function public.guard_owner_role();

-- A company can't have more members than its plan's seats.
create function public.check_seats() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role'
     and (select count(*) from public.organisation_members m where m.organisation_id = new.organisation_id)
         >= (select o.seats from public.organisations o where o.id = new.organisation_id) then
    raise exception 'Every seat on this plan is taken.';
  end if;
  return new;
end;
$$;
create trigger organisation_members_seats before insert on public.organisation_members
  for each row execute function public.check_seats();

revoke execute on function public.accept_invitations() from public, anon;
revoke execute on function public.update_my_membership(uuid, text, jsonb) from public, anon;
grant execute on function public.accept_invitations() to authenticated;
grant execute on function public.update_my_membership(uuid, text, jsonb) to authenticated;
