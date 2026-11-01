import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recipient } from "@/lib/drawings/drawingMarkups";
import type { Member } from "@/lib/members";
import { sanitizeProject, type Project } from "@/lib/projects";

/**
 * The workspace in the database (`supabase/migrations`): the signed-in
 * person's companies, each company's team and invitations, and its projects.
 * Row-level security decides what each call can see; these functions only
 * shape the rows.
 */

export type Role = "owner" | "admin" | "member";

export interface Membership {
  organisationId: string;
  organisationName: string;
  role: Role;
  name: string;
  email: string;
  recipients: Recipient[];
  plan: string;
  planStatus: string;
  trialEndsAt: string;
  seats: number;
}

export interface TeamMember extends Member {
  role: Role;
}

export interface Invitation {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  createdAt: string;
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Couldn't ${what}: ${error?.message ?? "no response"}`);
}

function recipientsFrom(settings: unknown): Recipient[] {
  const list = (settings as { recipients?: unknown } | null)?.recipients;
  return (Array.isArray(list) ? list : [])
    .filter((r): r is Recipient => Boolean(r) && typeof r === "object" && typeof (r as Recipient).email === "string")
    .map((r) => ({ email: r.email, name: typeof r.name === "string" ? r.name : "" }));
}

function role(value: unknown): Role {
  return value === "owner" || value === "admin" ? value : "member";
}

export async function sendSignInLink(supabase: SupabaseClient, email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
  });
  if (error) fail("send the sign-in email", error);
}

/** The 6-digit code from the sign-in email, for when the link opens in a different browser. */
export async function verifySignInCode(supabase: SupabaseClient, email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
  if (error) fail("sign in with that code", error);
}

/** Join any companies that invited this email, then list every company this person is in. */
export async function loadMemberships(supabase: SupabaseClient, userId: string): Promise<Membership[]> {
  await supabase.rpc("accept_invitations");
  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, name, email, settings, organisations (name, plan, plan_status, trial_ends_at, seats)")
    .eq("user_id", userId)
    .order("created_at");
  if (error) fail("load your companies", error);
  return (data ?? []).map((row) => {
    const org = (Array.isArray(row.organisations) ? row.organisations[0] : row.organisations) as Record<string, unknown> | null;
    return {
      organisationId: row.organisation_id as string,
      organisationName: String(org?.name ?? ""),
      role: role(row.role),
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      recipients: recipientsFrom(row.settings),
      plan: String(org?.plan ?? "trial"),
      planStatus: String(org?.plan_status ?? ""),
      trialEndsAt: String(org?.trial_ends_at ?? ""),
      seats: Number(org?.seats ?? 0),
    };
  });
}

/**
 * Start a company; its creator becomes the owner (by trigger). The id is made
 * here and the row isn't read back in the same call: the read policy needs the
 * owner's membership, which the trigger only adds once the insert is done.
 */
export async function createOrganisation(supabase: SupabaseClient, name: string, yourName: string): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("organisations").insert({ id, name: name.trim() });
  if (error) fail("create the company", error);
  await updateMyMembership(supabase, id, yourName, { recipients: [] });
  return id;
}

export async function updateMyMembership(
  supabase: SupabaseClient,
  organisationId: string,
  name: string,
  settings: { recipients: Recipient[] }
): Promise<void> {
  const { error } = await supabase.rpc("update_my_membership", {
    org: organisationId,
    new_name: name,
    new_settings: settings,
  });
  if (error) fail("save your details", error);
}

export async function renameOrganisation(supabase: SupabaseClient, organisationId: string, name: string): Promise<void> {
  const { error } = await supabase.from("organisations").update({ name: name.trim() }).eq("id", organisationId);
  if (error) fail("rename the company", error);
}

export async function loadTeam(
  supabase: SupabaseClient,
  organisationId: string
): Promise<{ members: TeamMember[]; invitations: Invitation[] }> {
  const [members, invitations] = await Promise.all([
    supabase.from("organisation_members").select("user_id, role, name, email").eq("organisation_id", organisationId).order("created_at"),
    supabase.from("invitations").select("id, email, role, created_at").eq("organisation_id", organisationId).order("created_at"),
  ]);
  if (members.error) fail("load the team", members.error);
  if (invitations.error) fail("load the invitations", invitations.error);
  return {
    members: (members.data ?? []).map((row) => ({
      id: row.user_id as string,
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      active: true,
      role: role(row.role),
    })),
    invitations: (invitations.data ?? []).map((row) => ({
      id: row.id as string,
      email: String(row.email),
      role: row.role === "admin" ? "admin" : "member",
      createdAt: String(row.created_at),
    })),
  };
}

export async function invite(
  supabase: SupabaseClient,
  organisationId: string,
  invitedBy: string,
  email: string,
  inviteRole: Exclude<Role, "owner">
): Promise<void> {
  const { error } = await supabase
    .from("invitations")
    .insert({ organisation_id: organisationId, email: email.trim().toLowerCase(), role: inviteRole, invited_by: invitedBy });
  if (error) fail(error.message.includes("duplicate") ? "invite them — they're already invited" : "send the invitation", error);
}

export async function withdrawInvitation(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("invitations").delete().eq("id", id);
  if (error) fail("withdraw the invitation", error);
}

export async function setMemberRole(supabase: SupabaseClient, organisationId: string, userId: string, next: Role): Promise<void> {
  const { error } = await supabase
    .from("organisation_members")
    .update({ role: next })
    .eq("organisation_id", organisationId)
    .eq("user_id", userId);
  if (error) fail("change their role", error);
}

export async function removeMember(supabase: SupabaseClient, organisationId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("organisation_members").delete().eq("organisation_id", organisationId).eq("user_id", userId);
  if (error) fail("remove them", error);
}

export async function listProjects(supabase: SupabaseClient, organisationId: string): Promise<Project[]> {
  const { data, error } = await supabase.from("projects").select("data").eq("organisation_id", organisationId);
  if (error) fail("load the projects", error);
  return (data ?? []).map((row) => sanitizeProject(row.data)).filter((p): p is Project => p !== null);
}

export async function saveProject(supabase: SupabaseClient, organisationId: string, project: Project): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .upsert({ id: project.id, organisation_id: organisationId, data: project, updated_at: new Date().toISOString() });
  if (error) fail(`save ${project.number || project.name || "the project"}`, error);
}

/** A project, everything in it (by cascade), and its stored PDFs. */
export async function deleteProject(supabase: SupabaseClient, id: string): Promise<void> {
  // A page at a time: removing a page shifts the next one into its place.
  for (;;) {
    const files = await supabase.storage.from("drawings").list(id, { limit: 500 });
    if (files.error) fail("list the project's files", files.error);
    const paths = (files.data ?? []).map((file) => `${id}/${file.name}`);
    if (paths.length === 0) break;
    const removed = await supabase.storage.from("drawings").remove(paths);
    if (removed.error) fail("delete the project's files", removed.error);
  }
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) fail("delete the project", error);
}
