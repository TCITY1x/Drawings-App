"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/fields";
import type { Project, ProjectContact } from "@/lib/projects";

/** A project's details and the contacts drawings are sent to. */
export function ProjectForm({
  title,
  initial,
  onCancel,
  onSave,
}: {
  title: string;
  initial: Pick<Project, "number" | "name" | "client" | "contacts">;
  onCancel: () => void;
  onSave: (details: Pick<Project, "number" | "name" | "client" | "contacts">) => void;
}) {
  const [number, setNumber] = useState(initial.number);
  const [name, setName] = useState(initial.name);
  const [client, setClient] = useState(initial.client);
  const [contacts, setContacts] = useState<ProjectContact[]>(initial.contacts);
  const ready = number.trim() !== "" || name.trim() !== "";

  const patch = (index: number, change: Partial<ProjectContact>) =>
    setContacts((current) => current.map((one, i) => (i === index ? { ...one, ...change } : one)));

  return (
    <Modal isOpen onClose={onCancel} title={title} size="lg">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onSave({
            number: number.trim(),
            name: name.trim(),
            client: client.trim(),
            contacts: contacts
              .map((one) => ({ name: one.name.trim(), email: one.email.trim(), role: one.role.trim() }))
              .filter((one) => one.name || one.email),
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label="Project number">
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="P-1042" className={inputClass} />
          </Field>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Substation 9 upgrade" className={inputClass} />
          </Field>
        </div>
        <Field label="Client">
          <input value={client} onChange={(e) => setClient(e.target.value)} className={inputClass} />
        </Field>

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Contacts — offered when sending markups and packages
          </legend>
          <ul className="space-y-2">
            {contacts.map((contact, index) => (
              <li key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_1.3fr_0.8fr_auto]">
                <input aria-label="Contact name" placeholder="Name" value={contact.name} onChange={(e) => patch(index, { name: e.target.value })} className={inputClass} />
                <input aria-label="Contact email" type="email" placeholder="Email" value={contact.email} onChange={(e) => patch(index, { email: e.target.value })} className={inputClass} />
                <input aria-label="Contact role" placeholder="Role" value={contact.role} onChange={(e) => patch(index, { role: e.target.value })} className={`${inputClass} max-sm:hidden`} />
                <Button variant="ghost" aria-label="Remove contact" onClick={() => setContacts((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setContacts((current) => [...current, { name: "", email: "", role: "" }])}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} aria-hidden="true" /> Add a contact
            </span>
          </Button>
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
