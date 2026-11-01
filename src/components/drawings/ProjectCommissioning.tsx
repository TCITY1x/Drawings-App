"use client";

import { useState } from "react";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PackageBuilder, type PackageDetails } from "@/components/drawings/PackageBuilder";
import { PackageSender } from "@/components/drawings/PackageSender";
import { PackageWorkspace } from "@/components/drawings/PackageWorkspace";
import { useProjectPackages } from "@/components/drawings/useProjectPackages";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  currentDrawing,
  handoverBlockers,
  packageProgress,
  revisionRows,
  testedShare,
  trianglesFor,
  type CommissioningPackage,
  type PackageSheet,
} from "@/lib/drawings/commissioning";
import { formatDate } from "@/lib/drawings/commissioningExport";
import type { ProjectDrawing } from "@/lib/drawings/drawings";
import type { Project } from "@/lib/projects";

/**
 * Point-to-point commissioning on a project's drawings: the project's packages — one
 * per panel, each a working set of its drawings — and, opened, the workspace
 * to test, sign and hand one over. See `commissioning.ts`.
 */
export function ProjectCommissioning({ project, drawings, titles }: { project: Project; drawings: ProjectDrawing[]; titles: Map<string, string> }) {
  const { me, businessName, userEmail } = useWorkspace();
  const store = useProjectPackages(project.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [building, setBuilding] = useState<{ pkg?: CommissioningPackage } | null>(null);
  const [sending, setSending] = useState<CommissioningPackage | null>(null);
  const [removing, setRemoving] = useState<CommissioningPackage | null>(null);

  const packages = [...(store.packages ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const open = packages.find((pkg) => pkg.id === openId) ?? null;

  /**
   * A drawing as a sheet of the package — the one already there, else a new
   * one. Either way, a sheet whose triangles haven't been picked gets the ones
   * its revision table gives the project code.
   */
  const sheetFor = (drawing: ProjectDrawing, existing: PackageSheet[], projectCode: string): PackageSheet => {
    const sheet = existing.find((one) => one.drawingId === drawing.id) ?? {
      drawingId: drawing.id,
      drawingNumber: drawing.number,
      drawingRevision: drawing.revision,
      drawingTitle: titles.get(drawing.id) ?? "",
      fileName: drawing.fileName,
      points: [],
      signoff: null,
      stampAt: null,
      triangles: [],
    };
    if (sheet.triangles.length > 0 || sheet.signoff) return sheet;
    return { ...sheet, triangles: trianglesFor(revisionRows(drawing.pages[0] ?? ""), projectCode) };
  };

  const saveDetails = (details: PackageDetails) => {
    const base = building?.pkg;
    setBuilding(null);
    const now = new Date().toISOString();
    const sheets = details.drawingIds
      .map((id) => drawings.find((drawing) => drawing.id === id))
      .filter((drawing): drawing is ProjectDrawing => Boolean(drawing))
      .map((drawing) => sheetFor(drawing, base?.sheets ?? [], details.projectCode));
    const pkg: CommissioningPackage = base
      ? { ...base, name: details.name, panelTag: details.panelTag, assignedTo: details.assignedTo, projectCode: details.projectCode, criteria: details.criteria, sheets }
      : {
          id: `p2p-${crypto.randomUUID()}`,
          projectId: project.id,
          name: details.name,
          panelTag: details.panelTag,
          assignedTo: details.assignedTo,
          projectCode: details.projectCode,
          criteria: details.criteria,
          sheets,
          createdBy: userEmail ?? "",
          createdAt: now,
          updatedAt: now,
          sends: [],
        };
    void store.save(pkg);
    setOpenId(pkg.id);
  };


  return (
    <div className="space-y-4">
      {store.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
          {store.error}
        </p>
      )}

      {open ? (
        <PackageWorkspace
          project={project}
          pkg={open}
          drawings={drawings}
          titles={titles}
          onBack={() => setOpenId(null)}
          onSave={(pkg) => void store.save(pkg)}
          onEdit={() => setBuilding({ pkg: open })}
          onHandover={() => setSending(open)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Point-to-point commissioning</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Package a panel&apos;s drawings, highlight each wire and component as it&apos;s tested, sign every sheet, and hand the set over.
              </p>
            </div>
            <Button variant="primary" onClick={() => setBuilding({})} disabled={drawings.length === 0}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={15} aria-hidden="true" /> New package
              </span>
            </Button>
          </div>

          {store.packages === null ? (
            <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/50" aria-busy="true" aria-label="Loading" />
          ) : packages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <ClipboardCheck size={30} className="text-indigo-500" aria-hidden="true" />
              <p className="font-semibold text-slate-900 dark:text-slate-100">No packages yet</p>
              <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
                {drawings.length === 0
                  ? "Add the project's drawings to the register first, then pick the ones for a panel."
                  : "Make one per panel: pick its schematics, layouts and termination diagrams from the register, in the order you'll work through them."}
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
              {packages.map((pkg) => {
                const progress = packageProgress(pkg);
                const ready = handoverBlockers(pkg, (sheet) => currentDrawing(sheet, drawings)).length === 0;
                const lastSend = pkg.sends[pkg.sends.length - 1];
                return (
                  <li key={pkg.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{pkg.panelTag || pkg.name}</p>
                        {pkg.panelTag && pkg.name && <p className="truncate text-sm text-slate-600 dark:text-slate-400">{pkg.name}</p>}
                      </div>
                      <span
                        className={
                          lastSend
                            ? "shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : ready
                              ? "shrink-0 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200"
                              : "shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }
                      >
                        {lastSend ? `Handed over ${formatDate(lastSend.at)}` : ready ? "Ready to hand over" : "In progress"}
                      </span>
                    </div>
                    <div>
                      <p className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                        <span>
                          {progress.signed} of {progress.sheets} sheets signed
                        </span>
                        <span>
                          {progress.total - progress.pending} / {progress.total} points
                        </span>
                      </p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div className="h-full bg-emerald-600" style={{ width: `${Math.round(testedShare(progress) * 100)}%` }} />
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {pkg.assignedTo ? `${pkg.assignedTo} · ` : ""}updated {formatDate(pkg.updatedAt)}
                    </p>
                    <div className="mt-auto flex items-center gap-2">
                      <Button variant="primary" size="sm" className="flex-1" onClick={() => setOpenId(pkg.id)}>
                        Open
                      </Button>
                      <button
                        type="button"
                        aria-label={`Delete ${pkg.panelTag || pkg.name}`}
                        onClick={() => setRemoving(pkg)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {building && (
        <PackageBuilder drawings={drawings} titles={titles} initial={building.pkg} onCancel={() => setBuilding(null)} onSave={saveDetails} />
      )}

      <PackageSender
        project={project}
        pkg={sending}
        drawings={drawings}
        context={{
          projectNumber: project.number,
          projectName: project.name,
          clientName: project.client,
          businessName: businessName,
          generatedBy: me?.name || userEmail || "",
        }}
        onClose={() => setSending(null)}
        onSent={(pkg) => store.save(pkg)}
      />

      <ConfirmDialog
        isOpen={removing !== null}
        title={`Delete ${removing?.panelTag || removing?.name || "the package"}?`}
        body="Its check points, results and sign-offs go with it. The drawings stay in the register, and copies already sent stay with whoever received them."
        confirmLabel="Delete"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const gone = removing;
          setRemoving(null);
          if (gone) void store.remove(gone);
          if (gone?.id === openId) setOpenId(null);
        }}
      />
    </div>
  );
}
