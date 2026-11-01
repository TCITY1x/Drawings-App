"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { Member } from "@/lib/members";

/** You, your company, and the team offered when assigning packages and signing sheets. */
export default function SettingsPage() {
  const { profile, setProfile, members, setMembers } = useWorkspace();
  const [name, setName] = useState(profile?.name ?? "");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [company, setCompany] = useState(profile?.company ?? "");
  const [team, setTeam] = useState<Member[]>(members);
  const [saved, setSaved] = useState(false);

  const patch = (id: string, change: Partial<Member>) => {
    setSaved(false);
    setTeam((current) => current.map((one) => (one.id === id ? { ...one, ...change } : one)));
  };

  return (
    <form
      className="mx-auto max-w-3xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setProfile({ name: name.trim(), email: email.trim(), company: company.trim() });
        setMembers(
          team
            .map((one) => ({ ...one, name: one.name.trim(), email: one.email.trim() }))
            .filter((one) => one.name || one.email)
        );
        setSaved(true);
      }}
    >
      <h1 className="text-2xl font-semibold">Team</h1>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold">You</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name">
            <input value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} required className={inputClass} />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => (setEmail(e.target.value), setSaved(false))} className={inputClass} />
          </Field>
          <Field label="Company — printed on commissioning packages" className="sm:col-span-2">
            <input value={company} onChange={(e) => (setCompany(e.target.value), setSaved(false))} className={inputClass} />
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="font-semibold">Team members</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">Offered when assigning a commissioning package and signing a sheet off.</p>
        </div>
        <ul className="space-y-2">
          {team.map((member) => (
            <li key={member.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
              <input aria-label="Name" placeholder="Name" value={member.name} onChange={(e) => patch(member.id, { name: e.target.value })} className={inputClass} />
              <input aria-label="Email" type="email" placeholder="Email" value={member.email} onChange={(e) => patch(member.id, { email: e.target.value })} className={inputClass} />
              <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={member.active} onChange={(e) => patch(member.id, { active: e.target.checked })} /> Active
              </label>
              <Button variant="ghost" aria-label={`Remove ${member.name || "member"}`} onClick={() => (setTeam((current) => current.filter((one) => one.id !== member.id)), setSaved(false))}>
                <Trash2 size={15} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (setTeam((current) => [...current, { id: crypto.randomUUID(), name: "", email: "", active: true }]), setSaved(false))}
        >
          <span className="inline-flex items-center gap-1.5">
            <Plus size={14} aria-hidden="true" /> Add someone
          </span>
        </Button>
      </section>

      <div className="flex items-center justify-end gap-3">
        {saved && <span role="status" className="text-sm text-brand-700 dark:text-brand-300">Saved</span>}
        <Button type="submit" variant="primary">
          Save
        </Button>
      </div>
    </form>
  );
}
