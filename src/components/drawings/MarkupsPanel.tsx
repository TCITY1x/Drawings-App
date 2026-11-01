"use client";

import { useState } from "react";
import { MarkupForm } from "@/components/drawings/MarkupForm";
import { MarkupList } from "@/components/drawings/MarkupList";
import { MarkupSender } from "@/components/drawings/MarkupSender";
import type { useProjectMarkups } from "@/components/drawings/useProjectMarkups";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { DrawingMarkup } from "@/lib/drawings/drawingMarkups";
import type { ProjectDrawing } from "@/lib/drawings/drawings";
import type { Project } from "@/lib/projects";

/**
 * A list of markups with everything you can do to them — edit, fix, reopen,
 * delete and send — for the Drawings tab (one sheet's) and the QA/QC Issues
 * tab (the whole project's).
 */
export function MarkupsPanel({
  project,
  drawings,
  store,
  markups,
  showDrawing = false,
  filters = false,
  emptyText,
  onShow,
}: {
  project: Project;
  drawings: ProjectDrawing[];
  store: ReturnType<typeof useProjectMarkups>;
  markups: DrawingMarkup[];
  showDrawing?: boolean;
  filters?: boolean;
  emptyText: string;
  onShow: (markup: DrawingMarkup) => void;
}) {
  const { userEmail } = useWorkspace();
  const [editing, setEditing] = useState<DrawingMarkup | null>(null);
  const [sending, setSending] = useState<DrawingMarkup[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const attempt = async (work: () => Promise<void>) => {
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That didn't save. Try again.");
    }
  };

  return (
    <>
      <MarkupList
        markups={markups}
        showDrawing={showDrawing}
        filters={filters}
        emptyText={emptyText}
        onShow={onShow}
        onEdit={setEditing}
        onStatus={(markup, status) =>
          void attempt(() => {
            const now = new Date().toISOString();
            return store.save({
              ...markup,
              status,
              updatedAt: now,
              fixedAt: status === "fixed" ? now : "",
              fixedBy: status === "fixed" ? userEmail ?? "" : "",
            });
          })
        }
        onDelete={(markup) => void attempt(() => store.remove(markup))}
        onSend={setSending}
      />
      {message && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {message}
        </p>
      )}
      {editing && (
        <MarkupForm
          key={editing.id}
          isOpen
          heading={`Edit #${editing.number}`}
          initial={{ kind: editing.kind, title: editing.title, comment: editing.comment }}
          onCancel={() => setEditing(null)}
          onSave={(details) => {
            const markup = editing;
            setEditing(null);
            void attempt(() => store.save({ ...markup, ...details, updatedAt: new Date().toISOString() }));
          }}
        />
      )}
      <MarkupSender
        project={project}
        markups={sending}
        drawings={drawings}
        onClose={() => setSending(null)}
        onSent={(updated) => attempt(() => store.save(...updated))}
      />
    </>
  );
}
