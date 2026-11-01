"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SendDialog, type SendAttachment } from "@/components/drawings/SendDialog";
import { useWorkspace } from "@/context/WorkspaceContext";
import { drawingBytes } from "@/lib/drawings/drawingStore";
import { closeUpPng, markedUpPdf } from "@/lib/drawings/drawingMarkupExport";
import {
  markupEmail,
  markupFileName,
  rememberRecipients,
  sortMarkups,
  statusAfterSend,
  type DrawingMarkup,
} from "@/lib/drawings/drawingMarkups";
import type { ProjectDrawing } from "@/lib/drawings/drawings";
import type { Project } from "@/lib/projects";

/** More close-ups than this and the email is a wall of images; the PDF has them all. */
const MAX_CLOSE_UPS = 6;

/**
 * Send markups to whoever has to act on them.
 *
 * Each drawing involved gets a copy with only these markups burned in (and a
 * page listing them), and each markup a close-up image, so the email shows
 * the problem at a glance. Both are made in the browser before the send
 * dialog opens, and attached to the email.
 *
 * Addresses used are remembered in the workspace and offered next time, with
 * the project's contacts, so nobody types the drafter's address twice.
 */
export function MarkupSender({
  project,
  markups,
  drawings,
  onClose,
  onSent,
}: {
  project: Project;
  /** What to send; null while closed. */
  markups: DrawingMarkup[] | null;
  drawings: ProjectDrawing[];
  onClose: () => void;
  /** The markups as they are after sending — status and send recorded. */
  onSent: (updated: DrawingMarkup[]) => Promise<void> | void;
}) {
  const { recipients: remembered, setRecipients, userEmail } = useWorkspace();
  const [prepared, setPrepared] = useState<{ attachments: SendAttachment[] } | null>(null);
  const [progress, setProgress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const open = markups !== null && markups.length > 0;
  const ordered = useMemo(() => (markups ? sortMarkups(markups) : []), [markups]);
  // Read at preparing time without re-preparing (and re-filing) whenever the
  // register or the project record is refreshed underneath an open dialog.
  const context = useRef({ project, drawings });
  useEffect(() => {
    context.current = { project, drawings };
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrepared(null);
    setProblem(null);
    (async () => {
      const { project, drawings } = context.current;
      const attachments: SendAttachment[] = [];
      const byDrawing = new Map<string, DrawingMarkup[]>();
      for (const markup of ordered) byDrawing.set(markup.drawingId, [...(byDrawing.get(markup.drawingId) ?? []), markup]);
      let closeUps = 0;
      for (const [drawingId, group] of byDrawing) {
        const drawing = drawings.find((one) => one.id === drawingId);
        if (!drawing) throw new Error(`Drawing ${group[0].drawingNumber} is no longer in the register.`);
        setProgress(`Marking up ${drawing.number}…`);
        const bytes = await drawingBytes(drawing);
        const pdf = await markedUpPdf({
          bytes: bytes.slice(),
          markups: group,
          projectNumber: project.number,
          drawingLabel: `${drawing.number}${drawing.revision ? ` rev ${drawing.revision}` : ""}`,
        });
        if (cancelled) return;
        const name = markupFileName(drawing.fileName || `${drawing.number}.pdf`, group.map((markup) => markup.number));
        attachments.push({ name, blob: pdf });

        for (const markup of group) {
          if (closeUps >= MAX_CLOSE_UPS || cancelled) break;
          setProgress(`Close-up of #${markup.number}…`);
          const image = await closeUpPng(bytes.slice(), markup);
          if (!image) continue;
          const imageName = `${drawing.number} #${markup.number} close-up.png`;
          attachments.push({ name: imageName, blob: image });
          closeUps += 1;
        }
      }
      if (!cancelled) setPrepared({ attachments });
    })().catch((error) => {
      if (!cancelled) setProblem(error instanceof Error ? error.message : "Couldn't prepare the markups.");
    });
    return () => {
      cancelled = true;
    };
  }, [open, ordered]);

  const suggested = useMemo(() => {
    const contacts = project.contacts
      .filter((contact) => contact.email.trim())
      .map((contact) => ({ email: contact.email.trim(), name: contact.name, hint: contact.role || "Project contact" }));
    const seen = new Set(contacts.map((contact) => contact.email.toLowerCase()));
    const earlier = remembered
      .filter((person) => !seen.has(person.email.toLowerCase()))
      .map((person) => ({ ...person, hint: "Sent markups before" }));
    return [...contacts, ...earlier];
  }, [project.contacts, remembered]);

  if (!open) return null;

  if (!prepared) {
    return (
      <Modal isOpen onClose={onClose} title="Preparing the markups" size="sm">
        {problem ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {problem}
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200" role="status">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {progress || "Starting…"}
          </p>
        )}
      </Modal>
    );
  }

  const email = markupEmail({ projectNumber: project.number, projectName: project.name, markups: ordered });
  return (
    <SendDialog
      isOpen
      onClose={onClose}
      title={ordered.length === 1 ? `Send #${ordered[0].number}` : `Send ${ordered.length} markups`}
      defaultSubject={email.subject}
      defaultNote={email.note}
      attachments={prepared.attachments}
      suggested={suggested}
      suggestedLabel="Project contacts and earlier recipients"
      onSent={async ({ to }) => {
        const names = new Map(suggested.map((person) => [person.email.toLowerCase(), person.name]));
        setRecipients(
          rememberRecipients(
            remembered,
            to.map((address) => ({ email: address, name: names.get(address.toLowerCase()) ?? "" }))
          )
        );
        const now = new Date().toISOString();
        await onSent(
          ordered.map((markup) => ({
            ...markup,
            status: statusAfterSend(markup),
            updatedAt: now,
            sends: [...markup.sends, { at: now, by: userEmail ?? "", to, fileUrl: "" }],
          }))
        );
      }}
    />
  );
}
