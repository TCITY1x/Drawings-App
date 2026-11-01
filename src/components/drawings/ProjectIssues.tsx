"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DraftingCompass } from "lucide-react";
import { MarkupsPanel } from "@/components/drawings/MarkupsPanel";
import { useProjectMarkups } from "@/components/drawings/useProjectMarkups";
import { listDrawings } from "@/lib/drawings/drawingStore";
import { isOutstanding } from "@/lib/drawings/drawingMarkups";
import type { ProjectDrawing } from "@/lib/drawings/drawings";
import type { Project } from "@/lib/projects";

/**
 * QA/QC → Issues: every markup on the project's drawings in one list — what's
 * still open, what's been sent and to whom, what's fixed. Issues are raised on
 * the Drawings tab, on the sheet; "show" goes back there to the markup.
 */
export function ProjectIssues({ project }: { project: Project }) {
  const router = useRouter();
  const store = useProjectMarkups(project.id);
  const [drawings, setDrawings] = useState<ProjectDrawing[]>([]);

  useEffect(() => {
    let cancelled = false;
    listDrawings(project.id)
      .then((list) => {
        if (!cancelled) setDrawings(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const markups = store.markups ?? [];
  const issues = markups.filter((markup) => markup.kind === "issue");
  const open = issues.filter(isOutstanding).length;
  const fixed = issues.length - open;
  const redlines = markups.length - issues.length;

  return (
    <section
      aria-labelledby="drawing-issues"
      className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="drawing-issues" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
            <DraftingCompass size={18} className="text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
            Drawing issues
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            {store.markups === null
              ? "Loading…"
              : `${open} open · ${fixed} fixed${redlines > 0 ? ` · ${redlines} redline${redlines === 1 ? "" : "s"}` : ""}`}
          </p>
        </div>
        <Link
          href={`/projects/${project.id}/drawings`}
          className="text-sm font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Raise one on a drawing
        </Link>
      </div>
      {store.error && (
        <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">
          {store.error}
        </p>
      )}
      <MarkupsPanel
        project={project}
        drawings={drawings}
        store={store}
        markups={markups}
        showDrawing
        filters
        emptyText={
          markups.length === 0
            ? "No drawing issues yet. Open a drawing, press Mark up, and mark what's wrong."
            : "Nothing outstanding."
        }
        onShow={(markup) =>
          router.push(
            `/projects/${project.id}/drawings?drawing=${encodeURIComponent(markup.drawingId)}&markup=${encodeURIComponent(markup.id)}`
          )
        }
      />
    </section>
  );
}
