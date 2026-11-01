"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Eye, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  KIND_LABEL,
  STATUS_LABEL,
  isOutstanding,
  sortMarkups,
  type DrawingMarkup,
  type MarkupKind,
} from "@/lib/drawings/drawingMarkups";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

type Show = "outstanding" | "all";

const STATUS_STYLE: Record<DrawingMarkup["status"], string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  fixed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
};

/**
 * Markups as a list to act on: tick some and send them together, open one on
 * its sheet, mark an issue fixed (or reopen it), edit or delete it.
 */
export function MarkupList({
  markups,
  showDrawing = false,
  filters = false,
  emptyText,
  onShow,
  onEdit,
  onStatus,
  onDelete,
  onSend,
}: {
  markups: DrawingMarkup[];
  /** Say which drawing each is on — for lists spanning a project. */
  showDrawing?: boolean;
  /** Offer outstanding/all and issue/redline filters. */
  filters?: boolean;
  emptyText: string;
  onShow: (markup: DrawingMarkup) => void;
  onEdit: (markup: DrawingMarkup) => void;
  onStatus: (markup: DrawingMarkup, status: DrawingMarkup["status"]) => void;
  onDelete: (markup: DrawingMarkup) => void;
  onSend: (markups: DrawingMarkup[]) => void;
}) {
  const [show, setShow] = useState<Show>("outstanding");
  const [kind, setKind] = useState<MarkupKind | "all">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<DrawingMarkup | null>(null);

  const visible = useMemo(
    () =>
      sortMarkups(markups).filter(
        (markup) => (!filters || show === "all" || isOutstanding(markup)) && (!filters || kind === "all" || markup.kind === kind)
      ),
    [markups, filters, show, kind]
  );
  const chosen = visible.filter((markup) => picked.includes(markup.id));

  return (
    <div className="space-y-3">
      {filters && (
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["outstanding", "Outstanding"],
              ["all", "All"],
            ] as [Show, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={show === value}
              onClick={() => setShow(value)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm font-medium",
                show === value
                  ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-500"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              )}
            >
              {label}
            </button>
          ))}
          <label className="ml-1 text-sm text-slate-600 dark:text-slate-400">
            <span className="sr-only">Kind</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as MarkupKind | "all")}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="all">Issues and redlines</option>
              <option value="issue">Issues</option>
              <option value="redline">Redlines</option>
            </select>
          </label>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((markup) => {
            const lastSend = markup.sends[markup.sends.length - 1];
            return (
              <li
                key={markup.id}
                // The actions drop under the text where the list is narrow — a phone, or beside a P2P sheet.
                className="flex flex-wrap gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
              >
                <input
                  type="checkbox"
                  aria-label={`Choose #${markup.number} to send`}
                  checked={picked.includes(markup.id)}
                  onChange={(event) =>
                    setPicked((ids) => (event.target.checked ? [...ids, markup.id] : ids.filter((id) => id !== markup.id)))
                  }
                  className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
                />
                <div className="min-w-48 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white",
                        markup.status === "fixed" ? "bg-emerald-600" : markup.kind === "issue" ? "bg-red-600" : "bg-blue-600"
                      )}
                    >
                      {markup.number}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                      {KIND_LABEL[markup.kind]}
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[markup.status])}>
                      {STATUS_LABEL[markup.status]}
                    </span>
                    {showDrawing && (
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                        {markup.drawingNumber}
                        {markup.drawingRevision && ` rev ${markup.drawingRevision}`}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{markup.title}</p>
                  {markup.comment && (
                    <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">{markup.comment}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Raised {formatDate(markup.createdAt.slice(0, 10))}
                    {markup.createdBy && ` by ${markup.createdBy}`}
                    {lastSend && ` · sent ${formatDate(lastSend.at.slice(0, 10))} to ${lastSend.to.join(", ")}`}
                    {markup.status === "fixed" && markup.fixedAt && ` · fixed ${formatDate(markup.fixedAt.slice(0, 10))}`}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-start gap-1">
                  <IconButton label={`Show #${markup.number} on the drawing`} onClick={() => onShow(markup)}>
                    <Eye size={15} />
                  </IconButton>
                  <IconButton label={`Send #${markup.number}`} onClick={() => onSend([markup])}>
                    <Send size={15} />
                  </IconButton>
                  {markup.kind === "issue" &&
                    (markup.status === "fixed" ? (
                      <IconButton label={`Reopen #${markup.number}`} onClick={() => onStatus(markup, markup.sends.length > 0 ? "sent" : "open")}>
                        <RotateCcw size={15} />
                      </IconButton>
                    ) : (
                      <IconButton label={`Mark #${markup.number} fixed`} onClick={() => onStatus(markup, "fixed")}>
                        <CheckCircle2 size={15} />
                      </IconButton>
                    ))}
                  <IconButton label={`Edit #${markup.number}`} onClick={() => onEdit(markup)}>
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton label={`Delete #${markup.number}`} danger onClick={() => setDeleting(markup)}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-indigo-50 px-3 py-2 dark:bg-indigo-500/10">
          <span className="text-sm text-indigo-900 dark:text-indigo-200">{chosen.length} chosen</span>
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
              Clear
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onSend(chosen);
                setPicked([]);
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Send size={14} aria-hidden="true" /> Send {chosen.length}
              </span>
            </Button>
          </span>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleting !== null}
        title={`Delete #${deleting?.number ?? ""}?`}
        body="The markup comes off the drawing and out of the issues list. Copies already sent stay as they are."
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) onDelete(deleting);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100",
        danger && "hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-300"
      )}
    >
      {children}
    </button>
  );
}
