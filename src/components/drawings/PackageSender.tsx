"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SendDialog } from "@/components/drawings/SendDialog";
import { useWorkspace } from "@/context/WorkspaceContext";
import { drawingBytes } from "@/lib/drawings/drawingStore";
import { packagePdf, type ExportContext } from "@/lib/drawings/commissioningExport";
import { packageEmail, packageFileName, type CommissioningPackage } from "@/lib/drawings/commissioning";
import { rememberRecipients } from "@/lib/drawings/drawingMarkups";
import type { ProjectDrawing } from "@/lib/drawings/drawings";
import type { Project } from "@/lib/projects";

/**
 * Hand a finished package over: the package PDF — cover page, each signed
 * sheet, the test record — is made in the browser and the send dialog opens
 * with it attached, offering the project's contacts and anyone drawings have
 * gone to before.
 */
export function PackageSender({
  project,
  pkg,
  drawings,
  context,
  onClose,
  onSent,
}: {
  project: Project;
  drawings: ProjectDrawing[];
  /** What to send; null while closed. */
  pkg: CommissioningPackage | null;
  context: ExportContext;
  onClose: () => void;
  onSent: (updated: CommissioningPackage) => Promise<void> | void;
}) {
  const { recipients: remembered, setRecipients, userEmail } = useWorkspace();
  const [prepared, setPrepared] = useState<{ name: string; blob: Blob } | null>(null);
  const [progress, setProgress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Read when preparing, without preparing (and filing) again whenever the project
  // record or the package refreshes underneath the open dialog.
  const latest = useRef({ project, pkg, drawings, context });
  useEffect(() => {
    latest.current = { project, pkg, drawings, context };
  });
  const open = pkg !== null;
  const packageId = pkg?.id ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrepared(null);
    setProblem(null);
    (async () => {
      const { pkg, drawings, context } = latest.current;
      if (!pkg) return;
      const blob = await packagePdf({
        pkg,
        context,
        bytesOf: (sheet) => {
          const drawing = drawings.find((one) => one.id === sheet.drawingId);
          if (!drawing) throw new Error(`${sheet.drawingNumber} rev ${sheet.drawingRevision} is no longer in the register.`);
          return drawingBytes(drawing);
        },
        onProgress: (message) => !cancelled && setProgress(message),
      });
      if (cancelled) return;
      const name = packageFileName(pkg);
      if (!cancelled) setPrepared({ name, blob });
    })().catch((error) => {
      if (!cancelled) setProblem(error instanceof Error ? error.message : "Couldn't make the package.");
    });
    return () => {
      cancelled = true;
    };
  }, [open, packageId]);

  const suggested = useMemo(() => {
    const contacts = project.contacts
      .filter((contact) => contact.email.trim())
      .map((contact) => ({ email: contact.email.trim(), name: contact.name, hint: contact.role || "Project contact" }));
    const seen = new Set(contacts.map((contact) => contact.email.toLowerCase()));
    const earlier = remembered
      .filter((person) => !seen.has(person.email.toLowerCase()))
      .map((person) => ({ ...person, hint: "Sent drawings before" }));
    return [...contacts, ...earlier];
  }, [project.contacts, remembered]);

  if (!pkg) return null;

  if (!prepared) {
    return (
      <Modal isOpen onClose={onClose} title="Making the package" size="sm">
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

  const email = packageEmail({ projectNumber: project.number, projectName: project.name, pkg });
  return (
    <SendDialog
      isOpen
      onClose={onClose}
      title={`Hand over ${pkg.panelTag || pkg.name}`}
      defaultSubject={email.subject}
      defaultNote={email.note}
      attachments={[{ name: prepared.name, blob: prepared.blob }]}
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
        await onSent({
          ...pkg,
          sends: [...pkg.sends, { at: new Date().toISOString(), by: userEmail ?? "", to, fileUrl: "" }],
        });
      }}
    />
  );
}
