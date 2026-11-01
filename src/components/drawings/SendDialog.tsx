"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, Paperclip, Plus, Send, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import { isEmail, sendProblems, uniqueAddresses } from "@/lib/email";
import { downloadBlob } from "@/lib/format";
import { authedFetch } from "@/lib/authedFetch";

export interface SendAttachment {
  name: string;
  blob: Blob;
}

/**
 * Email marked-up drawings or a commissioning package.
 *
 * Recipients are offered from the project's contacts and anyone drawings
 * have gone to before; anything else can be typed. The files are made in the
 * browser and posted to `/api/send`, which sends one email through Resend
 * with replies going to whoever sent it.
 *
 * When email isn't set up the files can still be downloaded and attached by
 * hand, and "Record as sent" keeps the markup's status and history right.
 */
export function SendDialog({
  isOpen,
  onClose,
  title,
  defaultSubject,
  defaultNote,
  attachments,
  suggested,
  suggestedLabel,
  onSent,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  defaultSubject: string;
  defaultNote: string;
  attachments: SendAttachment[];
  suggested: { email: string; name: string; hint?: string }[];
  suggestedLabel: string;
  /** Told who it went to once it went (or was recorded as sent), before the dialog closes. */
  onSent: (result: { to: string[] }) => Promise<void> | void;
}) {
  const { profile } = useWorkspace();
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [subject, setSubject] = useState(defaultSubject);
  const [note, setNote] = useState(defaultNote);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [offline, setOffline] = useState<string | null>(null);

  const to = useMemo(() => uniqueAddresses([...picked, ...extra]), [picked, extra]);
  const bytes = attachments.reduce((sum, one) => sum + one.blob.size, 0);

  const addTyped = () => {
    const addresses = typed.split(/[\s,;]+/).filter(Boolean);
    if (addresses.length === 0) return;
    const bad = addresses.filter((one) => !isEmail(one));
    if (bad.length > 0) return setProblems([`Not an email address: ${bad.join(", ")}`]);
    setExtra((current) => uniqueAddresses([...current, ...addresses]));
    setTyped("");
    setProblems([]);
  };

  const finish = async () => {
    await onSent({ to });
    onClose();
  };

  const send = async () => {
    const found = sendProblems({ to, subject, attachmentBytes: bytes });
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("to", JSON.stringify(to));
      form.set("subject", subject);
      form.set("note", note);
      form.set("senderName", profile?.name ?? "");
      form.set("replyTo", profile?.email ?? "");
      for (const one of attachments) form.append("files", one.blob, one.name);
      const response = await authedFetch("/api/send", { method: "POST", body: form });
      const result = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      if (response.ok) return await finish();
      if (result.code === "email-not-configured" || result.code === "sign-in-required") {
        setOffline(result.error ?? "Email isn't set up yet.");
        return;
      }
      setProblems([result.error ?? `Sending failed (${response.status}).`]);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "Sending failed."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {suggested.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{suggestedLabel}</legend>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {suggested.map((person) => {
                const key = person.email.toLowerCase();
                const on = picked.some((one) => one.toLowerCase() === key);
                return (
                  <li key={key}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setPicked((current) => (on ? current.filter((one) => one.toLowerCase() !== key) : [...current, person.email]))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-200">
                        {person.name ? `${person.name} <${person.email}>` : person.email}
                      </span>
                      {person.hint && <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{person.hint}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Add an address</span>
          <div className="flex gap-2">
            <input
              type="email"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTyped();
                }
              }}
              placeholder="name@company.com"
              aria-label="Email address to add"
              className={inputClass}
            />
            <Button onClick={addTyped} aria-label="Add the address">
              <Plus size={15} aria-hidden="true" />
            </Button>
          </div>
          {extra.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {extra.map((address) => (
                <li key={address} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-sm dark:bg-slate-800">
                  {address}
                  <button
                    type="button"
                    onClick={() => setExtra((current) => current.filter((one) => one !== address))}
                    aria-label={`Remove ${address}`}
                    className="rounded-full p-1 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field label="Subject">
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Message">
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={6} className={inputClass} />
        </Field>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            Attached · {(bytes / 1048576).toFixed(1)} MB
          </span>
          <ul className="space-y-1">
            {attachments.map((one) => (
              <li key={one.name} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <Paperclip size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{one.name}</span>
                <button
                  type="button"
                  onClick={() => downloadBlob(one.blob, one.name)}
                  aria-label={`Download ${one.name}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Download size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {problems.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {problems.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        )}

        {offline && (
          <div role="status" className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="flex items-start gap-2">
              <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                {offline} Download the files above and send them from your own email, then record it here so the
                markups show as sent.
              </span>
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {offline ? (
            <Button variant="primary" onClick={() => void finish()} disabled={to.length === 0}>
              Record as sent
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void send()} disabled={busy}>
              <span className="inline-flex items-center gap-1.5">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
                Send to {to.length || "…"}
              </span>
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
