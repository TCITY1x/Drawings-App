"use client";

import { useState } from "react";
import { Loader2, Mail, Trash2, UserPlus } from "lucide-react";
import { Billing } from "@/components/team/Billing";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import { invite, removeMember, setMemberRole, withdrawInvitation, type Role, type TeamMember } from "@/lib/cloudWorkspace";
import { isEmail } from "@/lib/email";
import { formatDate } from "@/lib/format";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const ROLE_HINT = "Admins invite and remove people and rename the company. Owners also choose other owners and handle billing.";

/** Cloud mode: you, the company, its members and invitations. */
export function CloudTeam() {
  const { profile, setProfile, cloud } = useWorkspace();
  const [name, setName] = useState(profile?.name ?? "");
  const [company, setCompany] = useState(profile?.company ?? "");
  const [saved, setSaved] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  if (!cloud?.membership) return null;
  const { supabase, membership, team, invitations, userId, refreshTeam } = cloud;
  const admin = membership.role !== "member";
  const owner = membership.role === "owner";
  const seatsLeft = membership.seats - team.length;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      await refreshTeam();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Team</h1>

      <form
        className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setProfile({ name: name.trim(), email: profile?.email ?? "", company: company.trim() || membership.organisationName });
          setSaved(true);
        }}
      >
        <h2 className="font-semibold">You and your company</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name — goes on markups and sign-offs">
            <input value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} required className={inputClass} />
          </Field>
          <Field label="Signed in as">
            <input value={profile?.email ?? ""} readOnly className={`${inputClass} bg-slate-50 dark:bg-slate-900`} />
          </Field>
          <Field label="Company — printed on commissioning packages" className="sm:col-span-2">
            <input
              value={company}
              onChange={(e) => (setCompany(e.target.value), setSaved(false))}
              readOnly={!admin}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-3">
          {saved && <span role="status" className="text-sm text-brand-700 dark:text-brand-300">Saved</span>}
          <Button type="submit" variant="primary">Save</Button>
        </div>
      </form>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Members</h2>
          <span className="text-sm text-slate-600 dark:text-slate-400">
            {team.length} of {membership.seats} seats used
          </span>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">{ROLE_HINT}</p>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {team.map((member) => {
            const isMe = member.id === userId;
            const canChange = admin && !isMe && (owner || member.role !== "owner");
            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name || member.email}
                    {isMe && <span className="ml-1 text-slate-500"> (you)</span>}
                  </p>
                  {member.name && <p className="truncate text-xs text-slate-500">{member.email}</p>}
                </div>
                {canChange ? (
                  <select
                    aria-label={`Role for ${member.name || member.email}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(event) => void act(() => setMemberRole(supabase, membership.organisationId, member.id, event.target.value as Role))}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                  >
                    {(owner ? (["member", "admin", "owner"] as Role[]) : (["member", "admin"] as Role[])).map((one) => (
                      <option key={one} value={one}>{ROLE_LABEL[one]}</option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {ROLE_LABEL[member.role]}
                  </span>
                )}
                {canChange && (
                  <Button variant="ghost" aria-label={`Remove ${member.name || member.email}`} onClick={() => setRemoving(member)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <Billing />

      {admin && (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h2 className="font-semibold">Invite someone</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Send them this site&apos;s address. When they sign in with the email you enter here, they join {membership.organisationName}.
            </p>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isEmail(email)) return setProblem("That isn't an email address.");
              void act(async () => {
                await invite(supabase, membership.organisationId, userId, email, inviteRole);
                setEmail("");
              });
            }}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              aria-label="Email to invite"
              className={`${inputClass} min-w-[14rem] flex-1`}
            />
            <select
              aria-label="Role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
              className="rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit" variant="primary" disabled={busy || seatsLeft - invitations.length <= 0}>
              <span className="inline-flex items-center gap-1.5">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <UserPlus size={15} aria-hidden="true" />} Invite
              </span>
            </Button>
          </form>
          {seatsLeft - invitations.length <= 0 && (
            <p className="text-sm text-amber-800 dark:text-amber-300">Every seat is taken or promised to an invitation.</p>
          )}
          {invitations.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {invitations.map((one) => (
                <li key={one.id} className="flex items-center gap-3 py-2 text-sm">
                  <Mail size={14} aria-hidden="true" className="text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{one.email}</span>
                  <span className="text-xs text-slate-500">
                    {ROLE_LABEL[one.role]} · invited {formatDate(one.createdAt)}
                  </span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(() => withdrawInvitation(supabase, one.id))}>
                    Withdraw
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {problem && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {problem}
        </p>
      )}

      <ConfirmDialog
        isOpen={removing !== null}
        title={`Remove ${removing?.name || removing?.email || "them"}?`}
        body="They lose access to the company's projects straight away. Their markups and sign-offs stay."
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const member = removing;
          setRemoving(null);
          if (member) void act(() => removeMember(supabase, membership.organisationId, member.id));
        }}
      />
    </div>
  );
}
