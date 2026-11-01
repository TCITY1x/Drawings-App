"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Download, Loader2, Pencil, Search, Trash2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DrawingViewer } from "@/components/drawings/DrawingViewer";
import { ProjectCommissioning } from "@/components/drawings/ProjectCommissioning";
import { MarkupsPanel } from "@/components/drawings/MarkupsPanel";
import { MarkupForm } from "@/components/drawings/MarkupForm";
import { useProjectMarkups } from "@/components/drawings/useProjectMarkups";
import { useWorkspace } from "@/context/WorkspaceContext";
import { createMarkup, isOutstanding, type DrawingMarkup, type MarkupShape } from "@/lib/drawings/drawingMarkups";
import { expandUploads, type IncomingPdf } from "@/lib/drawings/drawingIngest";
import { readDrawingPdf } from "@/lib/drawings/drawingPdf";
import { cacheDrawingFile, deleteDrawing, drawingBytes, listDrawings, saveDrawing } from "@/lib/drawings/drawingStore";
import { putDrawingFile } from "@/lib/drawings/fileStore";
import { downloadBlob } from "@/lib/format";
import {
  incomingVerdict,
  normaliseQuery,
  parseDrawingFileName,
  referencedDrawings,
  registerTitles,
  searchDrawings,
  sortDrawings,
  type ProjectDrawing,
} from "@/lib/drawings/drawings";
import { cn } from "@/lib/cn";
import type { Project } from "@/lib/projects";

/**
 * A project's drawings: add a set (PDFs or a .zip), see the register sorted by
 * drawing number, and search every word on every sheet.
 *
 * Each PDF is read here in the browser — its text and title block — then put
 * in the project's file store (`fileStore.ts`). What the register keeps is the
 * text, so searching never fetches a PDF; a sheet is fetched only when someone
 * opens it.
 *
 * A drawing number is in the register once, at its latest revision: a newer
 * revision replaces the entry (the old PDF is kept in storage), the same or an
 * older one is skipped.
 *
 * "Mark up" on the viewer draws a QA/QC issue or a redline on the sheet; the
 * sheet's markups are listed under it to send, fix or edit, and every issue
 * on the project is also on the Issues tab. `?drawing=…&markup=…`
 * opens a drawing at one of them.
 *
 * "Commissioning (P2P)" switches to the project's point-to-point packages — a
 * panel's drawings packaged from this register and checked off sheet by
 * sheet (`ProjectCommissioning`). `?view=p2p` opens it there.
 */

type Step = "waiting" | "reading" | "filing" | "done" | "skipped" | "failed";

interface QueueItem {
  key: string;
  name: string;
  from: string;
  step: Step;
  note: string;
}

const STEP_LABEL: Record<Step, string> = {
  waiting: "Waiting",
  reading: "Reading the text…",
  filing: "Storing the PDF…",
  done: "Searchable",
  skipped: "Skipped",
  failed: "Failed",
};

/** A PDF picked or dropped here. */
type Source = { kind: "upload"; pdf: IncomingPdf };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function wordCount(drawing: ProjectDrawing): number {
  return drawing.pages.reduce((sum, page) => sum + (page.match(/\S+/g)?.length ?? 0), 0);
}

export function ProjectDrawings({ project }: { project: Project }) {
  const { userEmail } = useWorkspace();
  const params = useSearchParams();
  const markupStore = useProjectMarkups(project.id);
  const [newMarkup, setNewMarkup] = useState<{ drawing: ProjectDrawing; page: number; shapes: MarkupShape[] } | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [drawings, setDrawings] = useState<ProjectDrawing[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [wholeTag, setWholeTag] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; number: string; revision: string; title: string } | null>(null);
  const [removing, setRemoving] = useState<ProjectDrawing | null>(null);
  const [view, setView] = useState<"register" | "p2p">(() => (params.get("view") === "p2p" ? "p2p" : "register"));
  const inputRef = useRef<HTMLInputElement>(null);
  /** The register as the add loop sees it — state lags a render behind. */
  const register = useRef<ProjectDrawing[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await listDrawings(project.id);
      register.current = list;
      setDrawings(list);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Couldn't load the drawings.");
      setDrawings([]);
    }
  }, [project.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A link from the Issues list: open its drawing at the markup.
  const linkedDrawing = params.get("drawing");
  const linkedMarkup = params.get("markup");
  useEffect(() => {
    if (!drawings || !linkedDrawing || !drawings.some((d) => d.id === linkedDrawing)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(linkedDrawing);
    if (linkedMarkup) setFocus((last) => ({ id: linkedMarkup, n: (last?.n ?? 0) + 1 }));
  }, [drawings, linkedDrawing, linkedMarkup]);

  const showMarkup = (markup: DrawingMarkup) => {
    setSelectedId(markup.drawingId);
    setFocus((last) => ({ id: markup.id, n: (last?.n ?? 0) + 1 }));
  };

  const markupsOn = (drawingId: string) => (markupStore.markups ?? []).filter((m) => m.drawingId === drawingId);

  const saveNewMarkup = async (details: { kind: DrawingMarkup["kind"]; title: string; comment: string }) => {
    if (!newMarkup) return;
    const { drawing, page, shapes } = newMarkup;
    setNewMarkup(null);
    const markup = createMarkup({
      drawing,
      page,
      shapes,
      details,
      existing: markupStore.latest.current,
      by: userEmail ?? "",
      id: `markup-${crypto.randomUUID()}`,
      now: new Date().toISOString(),
    });
    try {
      await markupStore.save(markup);
      setFocus((last) => ({ id: markup.id, n: (last?.n ?? 0) + 1 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't save the markup.");
    }
  };

  const viewer = (drawing: ProjectDrawing, search: { query: string; wholeTag: boolean }, onClose?: () => void) => (
    <div className="space-y-3">
      <DrawingViewer
        drawing={drawing}
        title={titles.get(drawing.id) ?? ""}
        query={search.query}
        wholeTag={search.wholeTag}
        onClose={onClose}
        markups={markupsOn(drawing.id)}
        onMarkupDone={({ page, shapes }) => setNewMarkup({ drawing, page, shapes })}
        focusMarkup={focus}
        onPickMarkup={showMarkup}
        onMarkupChange={(markup) =>
          void markupStore.save(markup).catch((error) => setMessage(error instanceof Error ? error.message : "Couldn't save the markup."))
        }
      />
      {(markupsOn(drawing.id).length > 0 || markupStore.error) && (
        <section
          aria-label={`Markups on ${drawing.number}`}
          className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Markups on {drawing.number}</h3>
          {markupStore.error && <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">{markupStore.error}</p>}
          <MarkupsPanel
            project={project}
            drawings={drawings ?? []}
            store={markupStore}
            markups={markupsOn(drawing.id)}
            emptyText="No markups on this drawing."
            onShow={showMarkup}
          />
        </section>
      )}
    </div>
  );

  const sorted = useMemo(() => sortDrawings(drawings ?? []), [drawings]);
  const { heading, titles } = useMemo(() => registerTitles(drawings ?? []), [drawings]);
  const references = useMemo(() => referencedDrawings(drawings ?? []), [drawings]);
  const searching = Boolean(normaliseQuery(query));
  const hits = useMemo(() => searchDrawings(drawings ?? [], query, wholeTag), [drawings, query, wholeTag]);
  const totalMatches = hits.reduce((sum, hit) => sum + hit.count, 0);

  // While searching the viewer shows the chosen result, else the best one.
  const shown =
    (searching ? hits.find((hit) => hit.drawing.id === selectedId)?.drawing ?? hits[0]?.drawing : null) ??
    (selectedId ? sorted.find((drawing) => drawing.id === selectedId) : undefined) ??
    null;

  const patchItem = (key: string, patch: Partial<QueueItem>) =>
    setQueue((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const remember = (next: ProjectDrawing[]) => {
    register.current = next;
    setDrawings(next);
  };

  /** Read, file (when it came from here) and index one PDF. */
  const addOne = async (key: string, source: Source) => {
    const name = source.pdf.name;
    const parsed = parseDrawingFileName(name);
    const verdict = incomingVerdict(register.current, parsed);
    if (verdict.kind === "same" || verdict.kind === "older") {
      patchItem(key, {
        step: "skipped",
        note:
          verdict.kind === "same"
            ? `Already in the register${parsed.revision ? ` at rev ${parsed.revision}` : ""}`
            : `Rev ${verdict.existing.revision} is newer and already in the register`,
      });
      return;
    }
    try {
      patchItem(key, { step: "reading", note: "" });
      const blob = source.pdf.blob;
      // pdf.js takes ownership of the bytes it's given, so it gets a copy.
      const { pages, titleLines } = await readDrawingPdf(new Uint8Array(await blob.arrayBuffer()));

      patchItem(key, { step: "filing" });
      const id = `drawing-${crypto.randomUUID()}`;
      const fileKey = await putDrawingFile({ projectId: project.id, drawingId: id, blob });

      const replaced = verdict.kind === "replace" ? verdict.existing : null;
      const drawing: ProjectDrawing = {
        id,
        projectId: project.id,
        fileName: name,
        number: parsed.number,
        revision: parsed.revision,
        // A title someone typed carries to the next revision.
        title: replaced?.title ?? "",
        titleLines,
        pages,
        size: blob.size,
        fileKey,
        uploadedAt: new Date().toISOString(),
      };
      // Recorded only once the file is stored, so the register never lists a
      // drawing that can't be opened.
      await saveDrawing(drawing);
      if (replaced) await deleteDrawing(replaced, { keepFile: true });
      void cacheDrawingFile(drawing.id, blob);
      remember([...register.current.filter((d) => d.id !== replaced?.id), drawing]);
      const words = wordCount(drawing);
      patchItem(key, {
        step: "done",
        note: replaced
          ? `Rev ${replaced.revision || "—"} → ${drawing.revision || "—"} · ${words.toLocaleString()} words`
          : words === 0
            ? "No text on it — a scanned sheet can't be searched"
            : `${words.toLocaleString()} words`,
      });
    } catch (error) {
      patchItem(key, { step: "failed", note: error instanceof Error ? error.message : "Couldn't add it." });
    }
  };

  const run = async (sources: { source: Source; name: string; from: string }[], skipped: QueueItem[]) => {
    const batch = sources.map(({ name, from }, index) => ({
      key: `${Date.now()}-${index}`,
      name,
      from,
      step: "waiting" as Step,
      note: "",
    }));
    setQueue([...batch, ...skipped]);
    for (let index = 0; index < sources.length; index += 1) await addOne(batch[index].key, sources[index].source);
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setMessage(null);
    setBusy(true);
    try {
      const { pdfs, skipped } = await expandUploads(files);
      const skippedItems = skipped.map((item, index) => ({
        key: `skip-${Date.now()}-${index}`,
        name: item.name,
        from: "",
        step: "skipped" as Step,
        note: item.reason,
      }));
      if (pdfs.length === 0) {
        setQueue(skippedItems);
        setMessage("No PDFs found in that.");
        return;
      }
      await run(
        pdfs.map((pdf) => ({ source: { kind: "upload", pdf } as Source, name: pdf.name, from: pdf.from })),
        skippedItems
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const drawing = register.current.find((d) => d.id === editing.id);
    if (!drawing) return setEditing(null);
    const next: ProjectDrawing = {
      ...drawing,
      number: editing.number.trim() || drawing.number,
      revision: editing.revision.trim(),
      title: editing.title.trim() === (titles.get(drawing.id) ?? "") && !drawing.title ? "" : editing.title.trim(),
    };
    try {
      await saveDrawing(next);
      remember(register.current.map((d) => (d.id === next.id ? next : d)));
      setEditing(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't save that.");
    }
  };

  const remove = async (drawing: ProjectDrawing) => {
    setRemoving(null);
    try {
      await deleteDrawing(drawing);
      remember(register.current.filter((d) => d.id !== drawing.id));
      if (selectedId === drawing.id) setSelectedId(null);
      setMessage(`${drawing.number} removed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't remove it.");
    }
  };

  const doneCount = queue.filter((item) => item.step === "done").length;
  const working = queue.filter((item) => item.step !== "skipped").length;

  const dropProps = {
        onDragOver: (event: React.DragEvent) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: (event: React.DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: React.DragEvent) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(Array.from(event.dataTransfer.files));
        },
      };

  return (
    <div className="space-y-4" {...(view === "register" ? dropProps : {})}>
      <div role="group" aria-label="Drawings view" className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {(
          [
            ["register", "Register"],
            ["p2p", "Commissioning (P2P)"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={cn(
              "min-h-10 rounded-lg px-4 text-sm font-medium",
              view === key
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "p2p" ? (
        drawings === null ? (
          <div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/50" aria-busy="true" aria-label="Loading" />
        ) : (
          <ProjectCommissioning project={project} drawings={drawings} titles={titles} />
        )
      ) : (
      <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Drawing register</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {drawings === null
              ? "Loading…"
              : [
                  heading.join(" · "),
                  `${drawings.length} drawing${drawings.length === 1 ? "" : "s"}, sorted by drawing number`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <UploadCloud size={15} aria-hidden="true" /> Add drawings
            </span>
          </Button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.zip,application/pdf,application/zip"
        className="hidden"
        onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
      />

      {(drawings?.length === 0 || dragging || busy) && (
        <div
          className={cn(
            "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center",
            dragging
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10"
              : "border-indigo-200 bg-indigo-50/40 dark:border-indigo-500/30 dark:bg-indigo-500/5"
          )}
        >
          <UploadCloud size={32} className="text-indigo-500" aria-hidden="true" />
          <p className="font-semibold text-slate-900 dark:text-slate-100">Drop PDFs or a .zip here</p>
          <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
            A .zip is unpacked here, folders inside it too. Each PDF is stored with the project and its text made
            searchable. Anything that isn&apos;t a PDF is skipped and listed.
          </p>
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            Choose files
          </Button>
        </div>
      )}

      {queue.length > 0 && (
        <section
          aria-labelledby="drawing-queue"
          className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="drawing-queue" className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              {busy ? "Adding drawings" : "Added"}
            </h3>
            <span className="text-sm text-slate-600 dark:text-slate-400" role="status">
              {doneCount} of {working} searchable
            </span>
          </div>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {queue.map((item) => (
              <li key={item.key} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                <span aria-hidden="true" className="shrink-0">
                  {item.step === "done" ? (
                    <Check size={16} className="text-emerald-600" />
                  ) : item.step === "failed" ? (
                    <X size={16} className="text-red-600" />
                  ) : item.step === "skipped" ? (
                    <X size={16} className="text-slate-400" />
                  ) : item.step === "waiting" ? (
                    <span className="block h-4 w-4 rounded-full border-2 border-slate-300 dark:border-slate-600" />
                  ) : (
                    <Loader2 size={16} className="animate-spin text-indigo-600" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{item.name}</span>
                  {item.from && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.from}</span>}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-right text-xs",
                    item.step === "failed" ? "text-red-700 dark:text-red-300" : "text-slate-600 dark:text-slate-400"
                  )}
                >
                  {item.note || STEP_LABEL[item.step]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {message && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {message}
        </p>
      )}
      {loadError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
          {loadError}
        </p>
      )}

      {drawings && drawings.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <label htmlFor="drawing-search" className="sr-only">
            Search the text on every drawing
          </label>
          <div className="flex min-h-11 min-w-0 flex-[999_1_320px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800">
            <Search size={17} className="shrink-0 text-slate-500" aria-hidden="true" />
            <input
              id="drawing-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedId(null);
              }}
              placeholder="Search text on the drawings — a tag, cable or board, e.g. LP101"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-100"
            />
          </div>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={wholeTag}
              onChange={(event) => setWholeTag(event.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Whole tag only
          </label>
          {searching && (
            <p className="text-sm text-slate-600 dark:text-slate-400" role="status">
              <strong className="text-slate-900 dark:text-slate-100">
                {totalMatches} match{totalMatches === 1 ? "" : "es"}
              </strong>{" "}
              in {hits.length} of {drawings.length} drawing{drawings.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      )}

      {searching && drawings && drawings.length > 0 ? (
        hits.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            &ldquo;{normaliseQuery(query)}&rdquo; isn&apos;t on any drawing{wholeTag ? " as a whole tag" : ""}.
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            <ul aria-label="Drawings with matches" className="flex min-w-0 flex-[1_1_280px] flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
              {hits.map((hit) => {
                const chosen = hit.drawing.id === shown?.id;
                return (
                  <li key={hit.drawing.id}>
                    <button
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => setSelectedId(hit.drawing.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-xl border p-3 text-left",
                        chosen
                          ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/40 dark:bg-indigo-500/10"
                          : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800"
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {hit.drawing.number}
                          {hit.drawing.revision && (
                            <span className="font-normal text-slate-600 dark:text-slate-400"> rev {hit.drawing.revision}</span>
                          )}
                        </span>
                        <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200">
                          {hit.count} match{hit.count === 1 ? "" : "es"}
                        </span>
                      </span>
                      <span className="text-sm text-slate-800 dark:text-slate-200">{titles.get(hit.drawing.id)}</span>
                      {hit.snippet && (
                        <span className="break-words font-mono text-xs text-slate-600 dark:text-slate-400">
                          {hit.snippet.before}
                          <mark className="rounded-sm bg-yellow-300 px-0.5 text-slate-900">{hit.snippet.match}</mark>
                          {hit.snippet.after}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {shown && (
              <div className="min-w-0 flex-[999_1_560px]">
                {viewer(shown, { query, wholeTag })}
              </div>
            )}
          </div>
        )
      ) : (
        <>
          {shown && viewer(shown, { query: "", wholeTag: false }, () => setSelectedId(null))}

          {drawings && drawings.length > 0 && (
            <section
              aria-label="Drawings"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              {/* Relative, so the table's screen-reader labels (absolute) scroll
                  with it instead of widening the page on a phone. */}
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
                      <th scope="col" className="px-4 py-2.5 font-semibold">Drawing no.</th>
                      <th scope="col" className="px-2 py-2.5 font-semibold">Title</th>
                      <th scope="col" className="w-16 px-2 py-2.5 font-semibold">Rev</th>
                      <th scope="col" className="w-24 px-2 py-2.5 font-semibold">Size</th>
                      <th scope="col" className="w-40 px-4 py-2.5 text-right font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((drawing) =>
                      editing?.id === drawing.id ? (
                        <tr key={drawing.id} className="border-t border-slate-100 bg-indigo-50/40 dark:border-slate-800 dark:bg-indigo-500/5">
                          <td className="px-4 py-2">
                            <label className="sr-only" htmlFor={`number-${drawing.id}`}>Drawing number</label>
                            <input
                              id={`number-${drawing.id}`}
                              value={editing.number}
                              onChange={(event) => setEditing({ ...editing, number: event.target.value })}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <label className="sr-only" htmlFor={`title-${drawing.id}`}>Title</label>
                            <input
                              id={`title-${drawing.id}`}
                              value={editing.title}
                              onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <label className="sr-only" htmlFor={`rev-${drawing.id}`}>Revision</label>
                            <input
                              id={`rev-${drawing.id}`}
                              value={editing.revision}
                              onChange={(event) => setEditing({ ...editing, revision: event.target.value })}
                              className="w-14 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                          </td>
                          <td className="px-2 py-2 text-slate-600 dark:text-slate-400">{formatBytes(drawing.size)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className="inline-flex gap-1">
                              <Button variant="primary" size="sm" onClick={() => void saveEdit()}>Save</Button>
                              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                            </span>
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={drawing.id}
                          className={cn(
                            "border-t border-slate-100 align-top dark:border-slate-800",
                            drawing.id === shown?.id && "bg-indigo-50/60 dark:bg-indigo-500/10"
                          )}
                        >
                          <td className="whitespace-nowrap px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setSelectedId(drawing.id)}
                              className="font-mono font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
                            >
                              {drawing.number}
                            </button>
                          </td>
                          <td className="px-2 py-3 text-slate-800 dark:text-slate-200">
                            {titles.get(drawing.id) || <span className="text-slate-500">{drawing.fileName}</span>}
                            {(() => {
                              const open = markupsOn(drawing.id).filter(isOutstanding).length;
                              return open > 0 ? (
                                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-500/15 dark:text-red-300">
                                  {open} open markup{open === 1 ? "" : "s"}
                                </span>
                              ) : null;
                            })()}
                            {drawing.pages.every((page) => !page.trim()) && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                No text — not searchable
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-3 font-mono text-slate-800 dark:text-slate-200">{drawing.revision || "—"}</td>
                          <td className="px-2 py-3 text-slate-600 dark:text-slate-400">
                            {formatBytes(drawing.size)}
                            {drawing.pages.length > 1 && ` · ${drawing.pages.length} pp`}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <span className="inline-flex items-center gap-0.5">
                              <button
                                type="button"
                                aria-label={`Download ${drawing.number}`}
                                onClick={() =>
                                  void drawingBytes(drawing)
                                    .then((bytes) =>
                                      downloadBlob(
                                        new Blob([bytes as BlobPart], { type: "application/pdf" }),
                                        drawing.fileName || `${drawing.number}.pdf`
                                      )
                                    )
                                    .catch((error) => setMessage(error instanceof Error ? error.message : "Couldn't download it."))
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                              >
                                <Download size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Edit ${drawing.number}`}
                                onClick={() =>
                                  setEditing({
                                    id: drawing.id,
                                    number: drawing.number,
                                    revision: drawing.revision,
                                    title: titles.get(drawing.id) ?? "",
                                  })
                                }
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                              >
                                <Pencil size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${drawing.number}`}
                                onClick={() => setRemoving(drawing)}
                                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </span>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {references.length > 0 && (
            <section
              aria-labelledby="drawing-refs"
              className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 id="drawing-refs" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Referenced but not uploaded
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Drawing numbers these sheets mention that aren&apos;t in the register.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {references.map((ref) => (
                  <li
                    key={ref}
                    className="rounded-full border border-dashed border-slate-400 px-2.5 py-0.5 font-mono text-xs text-slate-700 dark:border-slate-600 dark:text-slate-300"
                  >
                    {ref}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      </>
      )}

      {newMarkup && (
        <MarkupForm
          isOpen
          heading={`New markup on ${newMarkup.drawing.number}`}
          initial={{ kind: "issue", title: "", comment: "" }}
          onCancel={() => setNewMarkup(null)}
          onSave={(details) => void saveNewMarkup(details)}
        />
      )}

      <ConfirmDialog
        isOpen={removing !== null}
        title={`Remove ${removing?.number ?? "drawing"}?`}
        body="It comes out of the register and the search. Markups and packages that use it can no longer open it."
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
      />
    </div>
  );
}
