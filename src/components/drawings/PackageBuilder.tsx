"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import { normaliseQuery, sortDrawings, type ProjectDrawing } from "@/lib/drawings/drawings";
import { DEFAULT_CRITERIA, type CommissioningPackage } from "@/lib/drawings/commissioning";
import { activePeople, personLabel } from "@/lib/members";
import { cn } from "@/lib/cn";

export interface PackageDetails {
  name: string;
  panelTag: string;
  assignedTo: string;
  /** The client's project code(s), as the revision tables name it. */
  projectCode: string;
  criteria: string;
  /** In working order. */
  drawingIds: string[];
}

/**
 * Make a commissioning package, or change one: tick the drawings for the
 * panel from the register, put them in the order they'll be worked through,
 * and name it. Taking a sheet out of a package drops what was checked on it.
 */
export function PackageBuilder({
  drawings,
  titles,
  initial,
  onCancel,
  onSave,
}: {
  drawings: ProjectDrawing[];
  titles: Map<string, string>;
  /** The package being changed; none for a new one. */
  initial?: CommissioningPackage;
  onCancel: () => void;
  onSave: (details: PackageDetails) => void;
}) {
  const { members } = useWorkspace();
  const [name, setName] = useState(initial?.name ?? "");
  const [panelTag, setPanelTag] = useState(initial?.panelTag ?? "");
  const [assignedTo, setAssignedTo] = useState(initial?.assignedTo ?? "");
  const [projectCode, setProjectCode] = useState(initial?.projectCode ?? "");
  const [criteria, setCriteria] = useState(initial ? initial.criteria : DEFAULT_CRITERIA);
  const [picked, setPicked] = useState<string[]>(() =>
    (initial?.sheets ?? []).map((sheet) => sheet.drawingId).filter((id) => drawings.some((drawing) => drawing.id === id))
  );
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => sortDrawings(drawings), [drawings]);
  const needle = normaliseQuery(query).toLowerCase();
  const shown = needle
    ? sorted.filter((drawing) => `${drawing.number} ${titles.get(drawing.id) ?? ""} ${drawing.fileName}`.toLowerCase().includes(needle))
    : sorted;
  const byId = new Map(drawings.map((drawing) => [drawing.id, drawing]));
  const people = activePeople(members).map(personLabel);

  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((one) => one !== id) : [...list, id]));
  const move = (index: number, by: number) =>
    setPicked((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });

  // Sheets with results that would be dropped.
  const dropping = (initial?.sheets ?? []).filter(
    (sheet) => !picked.includes(sheet.drawingId) && sheet.points.some((point) => point.status !== "pending")
  );
  const canSave = (name.trim() || panelTag.trim()) && picked.length > 0;

  return (
    <Modal isOpen onClose={onCancel} title={initial ? "Change the package" : "New commissioning package"} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Panel / equipment tag" className="flex-[1_1_180px]">
            <input value={panelTag} onChange={(event) => setPanelTag(event.target.value)} placeholder="e.g. M853C-X002" className={inputClass} />
          </Field>
          <Field label="Package name" className="flex-[2_1_260px]">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Marshalling cubicle — P2P" className={inputClass} />
          </Field>
          <Field label="Client project(s)" className="flex-[1_1_180px]">
            <input
              value={projectCode}
              onChange={(event) => setProjectCode(event.target.value)}
              placeholder="e.g. PE2040 — or pick them on a sheet"
              className={inputClass}
            />
          </Field>
          <Field label="Assigned to" className="flex-[1_1_180px]">
            <input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} list="package-people" className={inputClass} />
            <datalist id="package-people">
              {people.map((person) => (
                <option key={person} value={person} />
              ))}
            </datalist>
          </Field>
        </div>

        <Field label="Test criteria — one per line, shown beside the sheet while testing and on the cover page">
          <textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} rows={3} className={inputClass} />
        </Field>

        <div className="flex flex-wrap items-start gap-4">
          <section aria-labelledby="package-pick" className="min-w-0 flex-[999_1_360px]">
            <h3 id="package-pick" className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Drawings for this panel
            </h3>
            <label className="mb-2 flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 focus-within:border-indigo-500 dark:border-slate-700">
              <Search size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
              <span className="sr-only">Filter the register</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by number or title, e.g. M853C"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-100"
              />
            </label>
            <ul className="max-h-[44vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
              {shown.length === 0 && <li className="p-4 text-sm text-slate-600 dark:text-slate-400">No drawings match.</li>}
              {shown.map((drawing) => {
                const on = picked.includes(drawing.id);
                return (
                  <li key={drawing.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <label
                      className={cn(
                        "flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2.5",
                        on ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(drawing.id)} className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {drawing.number}
                          {drawing.revision && <span className="font-normal text-slate-600 dark:text-slate-400"> rev {drawing.revision}</span>}
                        </span>
                        <span className="block text-sm text-slate-700 dark:text-slate-300">{titles.get(drawing.id) || drawing.fileName}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="package-order" className="min-w-0 flex-[1_1_300px]">
            <h3 id="package-order" className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Working order · {picked.length} sheet{picked.length === 1 ? "" : "s"}
            </h3>
            {picked.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
                Tick the drawings for the panel. They&apos;re worked through in this order.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {picked.map((id, index) => {
                  const drawing = byId.get(id);
                  if (!drawing) return null;
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-800">
                      <span className="w-5 text-center text-xs text-slate-500">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{drawing.number}</span>
                        <span className="block truncate text-xs text-slate-600 dark:text-slate-400">{titles.get(drawing.id) || drawing.fileName}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Move ${drawing.number} up`}
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <ArrowUp size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${drawing.number} down`}
                        onClick={() => move(index, 1)}
                        disabled={index === picked.length - 1}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <ArrowDown size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Take ${drawing.number} out`}
                        onClick={() => toggle(id)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-500/10"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              Each sheet is checked at the revision it&apos;s at now. If a drawing is re-issued, its sheet is flagged to be re-checked.
              With a project code, each sheet&apos;s revision triangles for it are ticked from its revision table — clouds tagged with
              any other triangle are another project&apos;s and left alone.
            </p>
          </section>
        </div>

        {dropping.length > 0 && (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            Taking out {dropping.map((sheet) => sheet.drawingNumber).join(", ")} drops the results already recorded on{" "}
            {dropping.length === 1 ? "it" : "them"}.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() =>
              onSave({ name: name.trim(), panelTag: panelTag.trim(), assignedTo: assignedTo.trim(), projectCode: projectCode.trim(), criteria: criteria.trim(), drawingIds: picked })
            }
          >
            {initial ? "Save changes" : `Create package · ${picked.length} sheet${picked.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
