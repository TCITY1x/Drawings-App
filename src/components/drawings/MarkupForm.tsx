"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/fields";
import type { MarkupKind } from "@/lib/drawings/drawingMarkups";
import { cn } from "@/lib/cn";

export interface MarkupDetails {
  kind: MarkupKind;
  title: string;
  comment: string;
}

/**
 * What a markup is: an issue someone has to fix, or a redline to send on —
 * a short title for lists and the email subject, and the detail.
 */
export function MarkupForm({
  isOpen,
  heading,
  initial,
  onSave,
  onCancel,
}: {
  isOpen: boolean;
  heading: string;
  initial: MarkupDetails;
  onSave: (details: MarkupDetails) => void;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState(initial);
  const titleProblem = details.title.trim() ? null : "Give it a short title.";

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={heading} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!titleProblem) onSave({ ...details, title: details.title.trim(), comment: details.comment.trim() });
        }}
      >
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">What is it?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["issue", "QA/QC issue", "Something wrong for a team to fix. Tracked until fixed."],
                ["redline", "Redline", "A marked-up sheet to send on."],
              ] as [MarkupKind, string, string][]
            ).map(([kind, label, hint]) => (
              <label
                key={kind}
                className={cn(
                  "flex cursor-pointer gap-2 rounded-xl border p-3",
                  details.kind === kind
                    ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/10"
                    : "border-slate-200 dark:border-slate-700"
                )}
              >
                <input
                  type="radio"
                  name="markup-kind"
                  checked={details.kind === kind}
                  onChange={() => setDetails({ ...details, kind })}
                  className="mt-0.5 h-4 w-4 accent-indigo-600"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
                  <span className="block text-xs text-slate-600 dark:text-slate-400">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Title</span>
          <input
            autoFocus
            className={inputClass}
            value={details.title}
            maxLength={120}
            placeholder={details.kind === "issue" ? "e.g. Wrong drawing reference for M101C-W184" : "e.g. As-built cable route"}
            onChange={(event) => setDetails({ ...details, title: event.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            {details.kind === "issue" ? "What's wrong, and what it should be" : "Notes"}
          </span>
          <textarea
            className={`${inputClass} min-h-24`}
            value={details.comment}
            onChange={(event) => setDetails({ ...details, comment: event.target.value })}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={Boolean(titleProblem)}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
