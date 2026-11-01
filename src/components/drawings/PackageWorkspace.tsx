"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Hand,
  ListChecks,
  Loader2,
  PenLine,
  Plus,
  Rows3,
  Search,
  Send,
  Square,
  Stamp,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { inputClass } from "@/components/ui/fields";
import { DrawingViewer } from "@/components/drawings/DrawingViewer";
import { CheckLayer, type CheckTool } from "@/components/drawings/CheckLayer";
import { MarkupsPanel } from "@/components/drawings/MarkupsPanel";
import { MarkupForm, type MarkupDetails } from "@/components/drawings/MarkupForm";
import { useProjectMarkups } from "@/components/drawings/useProjectMarkups";
import { SheetSignoff } from "@/components/drawings/SheetSignoff";
import { useWorkspace } from "@/context/WorkspaceContext";
import { downloadBlob } from "@/lib/format";
import {
  SHEET_STATE_LABEL,
  currentDrawing,
  fallbackLabel,
  handoverBlockers,
  inScope,
  labelFromText,
  markPoint,
  moveToRevision,
  nextRowDown,
  criteriaLines,
  packageFileName,
  packageProgress,
  pointProgress,
  resultLabel,
  revisionProjects,
  revisionRows,
  rowAt,
  tableGap,
  textRows,
  scopedPoints,
  shapeBounds,
  sheetFileName,
  sheetState,
  testedShare,
  triangleFrom,
  trianglesFor,
  withProject,
  type CheckPoint,
  type CheckShape,
  type CheckStatus,
  type PlacedRun,
  type CommissioningPackage,
  type PackageSheet,
  type Point,
  type Rect,
  type SheetState,
} from "@/lib/drawings/commissioning";
import { packagePdf, signedSheetPdf, type ExportContext } from "@/lib/drawings/commissioningExport";
import { createMarkup, type DrawingMarkup, type MarkupShape } from "@/lib/drawings/drawingMarkups";
import { drawingBytes } from "@/lib/drawings/drawingStore";
import { normaliseQuery, searchDrawings, type ProjectDrawing } from "@/lib/drawings/drawings";
import { cn } from "@/lib/cn";
import type { Project } from "@/lib/projects";

const STATE_STYLE: Record<SheetState, string> = {
  signed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  ready: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200",
  testing: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  "not-started": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  stale: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

const STATUS_STYLE: Record<CheckStatus, string> = {
  pending: "border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300",
  pass: "bg-yellow-200 text-yellow-950",
  fault: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
  na: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

const TOOLS: { tool: CheckTool; label: string; hint: string; icon: React.ReactNode }[] = [
  { tool: "pan", label: "Pan", hint: "Move around the sheet; tap a point to pick it", icon: <Hand size={16} aria-hidden="true" /> },
  { tool: "trace", label: "Trace wire", hint: "Drag along a wire to add it as a point", icon: <PenLine size={16} aria-hidden="true" /> },
  { tool: "area", label: "Box area", hint: "Drag a box round a revision cloud", icon: <Square size={15} aria-hidden="true" /> },
  {
    tool: "row",
    label: "Tap row",
    hint: "Tap a terminal row to box it to its text; drag down a column to add every row in it",
    icon: <Rows3 size={16} aria-hidden="true" />,
  },
  { tool: "extend", label: "Extend wire", hint: "Drag another run onto the picked wire, where it turns a corner", icon: <Plus size={16} aria-hidden="true" /> },
  { tool: "stamp", label: "Place stamp", hint: "Drag the sign-off stamp to where it goes on page 1", icon: <Stamp size={16} aria-hidden="true" /> },
];

/**
 * A point's text field, saved when it's left (or Enter is pressed) rather than
 * on every key — each save writes the whole package.
 */
function PointField({
  value,
  onCommit,
  className,
  ...props
}: { value: string; onCommit: (value: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className={className}
    />
  );
}

/** A revision triangle with its number, as on the sheet. */
function Triangle({ n, size = 28 }: { n: string; size?: number }) {
  return (
    <svg width={size} height={size * 0.9} viewBox="0 0 24 22" aria-hidden="true" className="shrink-0">
      <polygon points="12,1.5 23,20.5 1,20.5" fill="#ffffff" stroke="#111827" strokeWidth="1.3" />
      <text
        x="12"
        y="18"
        textAnchor="middle"
        fontSize={n.length > 2 ? 7 : n.length > 1 ? 9 : 11}
        fontWeight="bold"
        fontFamily="Arial, sans-serif"
        fill="#111827"
      >
        {n}
      </text>
    </svg>
  );
}

/** The box around a cloud where its triangle is looked for — clouds carry them just outside. */
function triangleArea(rect: Rect, aspect: number): Rect {
  const pad = 0.025;
  return { left: rect.left - pad, top: rect.top - pad * aspect, width: rect.width + pad * 2, height: rect.height + pad * 2 * aspect };
}

/** Where this device keeps its drawing hand. */
const HAND_KEY = "p2p-hand";

/** Where this device keeps the test criteria hidden, once someone has put them away. */
const CRITERIA_KEY = "p2p-criteria-hidden";

/** Room round a traced run when reading the wire number off the sheet beside it. */
function labelArea(shape: CheckShape, aspect: number): Rect {
  const box = shapeBounds(shape);
  if (shape.type === "area") return box;
  const across = box.width >= box.height / aspect;
  const padX = across ? 0 : 0.012;
  const padY = across ? 0.012 * aspect : 0;
  return { left: box.left - padX, top: box.top - padY, width: box.width + padX * 2, height: box.height + padY * 2 };
}

/**
 * Working through a commissioning package, sheet by sheet.
 *
 * Down the side, the package's sheets with where each is up to; in the middle
 * the sheet itself, where wires are traced and areas boxed as check points;
 * beside it the point being tested — pass, fault or N/A, a reading and a note
 * — and the sheet's points. Passing a point moves to the next untested one.
 *
 * A sheet is signed once every point is done; a signed sheet is locked until
 * it is reopened. The package can be downloaded at any time and handed over
 * once every sheet is signed.
 *
 * "Mark up" works as on the Drawings tab, in blue ink to start — the colour
 * the title block asks for commissioning changes. What's found not to match
 * the sheet, or changed on the day, is a project markup like any other: listed
 * under the sheet here, on the Drawings tab and on the QA/QC Issues list, to
 * send, fix or edit. Marking up never touches the sheet's check points or
 * its sign-off.
 *
 * Search finds text on every sheet in the package: each sheet's card counts
 * its matches, and the open sheet boxes them with the viewer's step-through,
 * as the Drawings tab does. It only highlights — points and tools carry on.
 */
export function PackageWorkspace({
  project,
  pkg,
  drawings,
  titles,
  onBack,
  onSave,
  onEdit,
  onHandover,
}: {
  project: Project;
  pkg: CommissioningPackage;
  drawings: ProjectDrawing[];
  titles: Map<string, string>;
  onBack: () => void;
  onSave: (pkg: CommissioningPackage) => void;
  onEdit: () => void;
  onHandover: () => void;
}) {
  const { me, businessName, userEmail } = useWorkspace();
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<CheckTool>("pan");
  /** The drawing hand, kept on this device — the loupe and chip go on the other side of the pencil. */
  const [hand, setHand] = useState<"left" | "right">("right");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(HAND_KEY) === "left") setHand("left");
    } catch {
      // Storage blocked: right-handed it is.
    }
  }, []);
  const chooseHand = (next: "left" | "right") => {
    setHand(next);
    try {
      localStorage.setItem(HAND_KEY, next);
    } catch {
      // Kept for this visit only.
    }
  };
  /** Test criteria put away, kept on this device — they take room from the sheet beside it. */
  const [criteriaHidden, setCriteriaHidden] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(CRITERIA_KEY) === "1") setCriteriaHidden(true);
    } catch {
      // Storage blocked: shown, as they start.
    }
  }, []);
  const hideCriteria = (hidden: boolean) => {
    setCriteriaHidden(hidden);
    try {
      if (hidden) localStorage.setItem(CRITERIA_KEY, "1");
      else localStorage.removeItem(CRITERIA_KEY);
    } catch {
      // Kept for this visit only.
    }
  };
  const [focus, setFocus] = useState<{ page: number; box: Rect; n: number } | null>(null);
  const [signing, setSigning] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [removing, setRemoving] = useState<CheckPoint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** A cloud just boxed that's tagged with another project's triangle — left alone unless someone says it's ours. */
  const [ignored, setIgnored] = useState<{ point: CheckPoint; triangle: string } | null>(null);
  const [newTriangle, setNewTriangle] = useState("");
  // Markups: the project's, so one made here is on the Drawings tab and the QA/QC Issues list too.
  const markupStore = useProjectMarkups(project.id);
  const [newMarkup, setNewMarkup] = useState<{ drawing: ProjectDrawing; page: number; shapes: MarkupShape[] } | null>(null);
  const [markupFocus, setMarkupFocus] = useState<{ id: string; n: number } | null>(null);
  // Search: the text on the package's sheets, as on the Drawings tab.
  const [query, setQuery] = useState("");
  const [wholeTag, setWholeTag] = useState(false);

  const sheetIndex = Math.min(index, Math.max(0, pkg.sheets.length - 1));
  const sheet: PackageSheet | undefined = pkg.sheets[sheetIndex];
  const current = sheet ? currentDrawing(sheet, drawings) : null;
  // The sheet as it was packaged when the register still has it, else the drawing that replaced it.
  const shown = sheet ? drawings.find((drawing) => drawing.id === sheet.drawingId) ?? current : null;
  const sheetStatus = sheet ? sheetState(sheet, current) : "not-started";
  const locked = sheetStatus === "signed";
  const selected = sheet?.points.find((point) => point.id === selectedId) ?? null;
  // The revision table on the sheet, for its triangles.
  const shownText = shown?.pages[0] ?? "";
  const rows = useMemo(() => revisionRows(shownText), [shownText]);
  const rowOf = (n: string) => rows.find((row) => row.n === n);
  const triangleOptions = sheet
    ? [...new Set([...rows.map((row) => row.n), ...sheet.triangles])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  // The projects on the sheet's revision table — what's picked — and any triangle added by hand that isn't one of theirs.
  const projects = useMemo(() => revisionProjects(rows), [rows]);
  const projectOf = (n: string) => projects.find((project) => project.triangles.includes(n));
  const looseTriangles = sheet ? sheet.triangles.filter((n) => !projectOf(n)) : [];
  const progress = useMemo(() => packageProgress(pkg), [pkg]);
  // Each sheet's drawing as the viewer shows it, and how many matches the search finds on it.
  const sheetDrawings = useMemo(
    () => pkg.sheets.map((one) => drawings.find((drawing) => drawing.id === one.drawingId) ?? currentDrawing(one, drawings)),
    [pkg.sheets, drawings]
  );
  const searching = Boolean(normaliseQuery(query));
  const sheetMatches = useMemo(() => {
    const found = searchDrawings(
      sheetDrawings.filter((drawing): drawing is ProjectDrawing => drawing !== null),
      query,
      wholeTag
    );
    return sheetDrawings.map((drawing) => (drawing ? found.find((hit) => hit.drawing.id === drawing.id)?.count ?? 0 : 0));
  }, [sheetDrawings, query, wholeTag]);
  const totalMatches = sheetMatches.reduce((sum, count) => sum + count, 0);
  const sheetsMatching = sheetMatches.filter((count) => count > 0).length;
  // The next sheet along with a match, coming round to the start.
  const nextMatching = searching
    ? pkg.sheets.map((_, i) => (sheetIndex + 1 + i) % pkg.sheets.length).find((i) => i !== sheetIndex && sheetMatches[i] > 0)
    : undefined;
  const sheetMarkups = shown ? (markupStore.markups ?? []).filter((markup) => markup.drawingId === shown.id) : [];
  const blockers = handoverBlockers(pkg, (one) => currentDrawing(one, drawings));

  const context: ExportContext = {
    projectNumber: project.number,
    projectName: project.name,
    clientName: project.client,
    businessName: businessName,
    generatedBy: me?.name || userEmail || "",
  };

  const updateSheet = (change: (sheet: PackageSheet) => PackageSheet) =>
    onSave({ ...pkg, sheets: pkg.sheets.map((one, i) => (i === sheetIndex ? change(one) : one)) });

  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(pkg.sheets.length - 1, next)));
    setSelectedId(null);
    setTool("pan");
    setFocus(null);
    setMarkupFocus(null);
    setMessage(null);
    setIgnored(null);
  };

  const showMarkup = (markup: DrawingMarkup) => setMarkupFocus((last) => ({ id: markup.id, n: (last?.n ?? 0) + 1 }));

  const saveNewMarkup = async (details: MarkupDetails) => {
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
      showMarkup(markup);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't save the markup.");
    }
  };

  const pick = (point: CheckPoint | null, zoom = false) => {
    setSelectedId(point?.id ?? null);
    if (point && zoom) setFocus((last) => ({ page: point.page, box: shapeBounds(point.shape), n: (last?.n ?? 0) + 1 }));
  };

  const addPoint = (shape: CheckShape, page: number, aspect: number, textIn: (rect: Rect) => string[]) => {
    if (!sheet || locked) return;
    const point: CheckPoint = {
      id: `check-${crypto.randomUUID()}`,
      page,
      label: labelFromText(textIn(labelArea(shape, aspect))) || fallbackLabel(sheet.points),
      shape,
      status: "pending",
      reading: "",
      note: "",
      testedBy: "",
      testedAt: "",
      faults: [],
      removal: false,
      triangle: shape.type === "area" ? triangleFrom(textIn(triangleArea(shape.rect, aspect)), rows) : "",
      row: false,
    };
    setIgnored(null);
    // Another project's cloud: left alone, unless someone says it's ours.
    if (!inScope(point, sheet)) {
      setIgnored({ point, triangle: point.triangle });
      setSelectedId(null);
      return;
    }
    updateSheet((one) => ({ ...one, points: [...one.points, point] }));
    setSelectedId(point.id);
  };

  /**
   * Terminal rows as points, boxed to their text and labelled from it — the
   * wire number where the row has one. A row already checked here is skipped,
   * so dragging down a column twice doesn't double up.
   */
  /** True when a row was added. */
  const addRows = (found: { rect: Rect; texts: string[] }[], page: number): boolean => {
    if (!sheet || locked) return false;
    const taken = sheet.points.filter((point) => point.page === page && point.shape.type === "area");
    const fresh = found.filter(({ rect }) => {
      const middle: Point = [rect.left + rect.width / 2, rect.top + rect.height / 2];
      return !taken.some(
        (point) =>
          point.shape.type === "area" &&
          middle[0] >= point.shape.rect.left &&
          middle[0] <= point.shape.rect.left + point.shape.rect.width &&
          middle[1] >= point.shape.rect.top &&
          middle[1] <= point.shape.rect.top + point.shape.rect.height
      );
    });
    setIgnored(null);
    if (fresh.length === 0) {
      setMessage(found.length === 0 ? "No row of text there — zoom in and tap on the row's text." : "Those rows are already on the sheet.");
      return false;
    }
    setMessage(null);
    const points: CheckPoint[] = fresh.map(({ rect, texts }, index) => ({
      id: `check-${crypto.randomUUID()}`,
      page,
      label: labelFromText(texts) || `Row ${sheet.points.length + index + 1}`,
      shape: { type: "area", rect },
      status: "pending",
      reading: "",
      note: "",
      testedBy: "",
      testedAt: "",
      faults: [],
      removal: false,
      triangle: "",
      row: true,
    }));
    updateSheet((one) => ({ ...one, points: [...one.points, ...points] }));
    setSelectedId(points[0].id);
    return true;
  };

  /**
   * A tap on a terminal row. A row already added on the same table gives the
   * table's width, so the new row matches it; the first tap on a table works
   * the width out from the gaps between the text (see `tableGap`).
   */
  const addRowAt = (at: Point, page: number, aspect: number, runsIn: (rect: Rect) => PlacedRun[]): boolean => {
    if (!sheet) return false;
    const template = [...sheet.points]
      .reverse()
      .find(
        (point) =>
          point.row &&
          point.page === page &&
          point.shape.type === "area" &&
          at[0] >= point.shape.rect.left &&
          at[0] <= point.shape.rect.left + point.shape.rect.width
      );
    const band = { top: at[1] - 0.015, height: 0.03 };
    if (template && template.shape.type === "area") {
      const { left, width } = template.shape.rect;
      const near = runsIn({ left, width, ...band }).filter(({ box }) => {
        const middle = box.left + box.width / 2;
        return middle >= left && middle <= left + width;
      });
      const row = rowAt(near, at, aspect);
      return addRows(row ? [{ ...row, rect: { ...row.rect, left, width } }] : [], page);
    }
    // Only the text near the tap: a band across the page, a couple of rows deep.
    const near = runsIn({ left: at[0] - 0.25, width: 0.5, ...band });
    const row = rowAt(near, at, aspect, tableGap(near));
    return addRows(row ? [row] : [], page);
  };

  /** A box dragged over rows: its width is the table's, and each line of text inside it is a row. */
  const addRowsIn = (rect: Rect, page: number, runsIn: (rect: Rect) => PlacedRun[]) => {
    // Only text inside the box: a row it merely clips isn't wanted.
    const inside = runsIn(rect).filter(({ box }) => {
      const middle = [box.left + box.width / 2, box.top + box.height / 2];
      return middle[0] >= rect.left && middle[0] <= rect.left + rect.width && middle[1] >= rect.top && middle[1] <= rect.top + rect.height;
    });
    addRows(
      textRows(inside).map((row) => ({ ...row, rect: { ...row.rect, left: rect.left, width: rect.width } })),
      page
    );
  };

  /**
   * A project on this sheet picked as the package's, or taken off. Triangle
   * numbers belong to their own sheet, so it's the project that's kept on the
   * package, and every sheet not yet signed takes the triangles its own
   * revision table gives that project. A row with no text has no project to
   * follow: only this sheet's triangle changes.
   */
  const setProject = (key: string, on: boolean, add: CheckPoint[] = []) => {
    const project = projects.find((one) => one.key === key);
    if (!sheet || !project) return;
    const change = (triangles: string[], mine: string[]) =>
      on ? [...new Set([...triangles, ...mine])] : triangles.filter((n) => !mine.includes(n));
    if (key.startsWith("Δ")) {
      updateSheet((one) => ({ ...one, triangles: change(one.triangles, project.triangles), points: [...one.points, ...add] }));
      return;
    }
    onSave({
      ...pkg,
      projectCode: withProject(pkg.projectCode, project.code, on),
      sheets: pkg.sheets.map((one, i) => {
        if (i === sheetIndex) return { ...one, triangles: change(one.triangles, project.triangles), points: [...one.points, ...add] };
        if (one.signoff) return one;
        const drawing = drawings.find((d) => d.id === one.drawingId);
        const theirs = drawing ? trianglesFor(revisionRows(drawing.pages[0] ?? ""), project.code) : [];
        return theirs.length === 0 ? one : { ...one, triangles: change(one.triangles, theirs) };
      }),
    });
  };

  /** The ignored cloud is ours after all: its project becomes the package's, and the cloud is added. */
  const claimIgnored = () => {
    if (!ignored) return;
    const { point, triangle } = ignored;
    setIgnored(null);
    const project = projectOf(triangle);
    if (project) setProject(project.key, true, [point]);
    else updateSheet((one) => ({ ...one, triangles: [...new Set([...one.triangles, triangle])], points: [...one.points, point] }));
    setSelectedId(point.id);
  };

  const toggleTriangle = (n: string) =>
    updateSheet((one) => ({
      ...one,
      triangles: one.triangles.includes(n) ? one.triangles.filter((t) => t !== n) : [...one.triangles, n],
    }));

  const extendPoint = (segment: [Point, Point], page: number, aspect: number, textIn: (rect: Rect) => string[]) => {
    if (!selected || selected.shape.type !== "trace" || selected.page !== page) {
      addPoint({ type: "trace", segments: [segment] }, page, aspect, textIn);
      return;
    }
    const shape: CheckShape = { type: "trace", segments: [...selected.shape.segments, segment] };
    updatePoint(selected.id, (point) => ({ ...point, shape }));
  };

  const updatePoint = (id: string, change: (point: CheckPoint) => CheckPoint) =>
    updateSheet((one) => ({ ...one, points: one.points.map((point) => (point.id === id ? change(point) : point)) }));

  const mark = (status: CheckStatus) => {
    if (!sheet || !selected || locked) return;
    const marked = markPoint(selected, status, userEmail ?? "", new Date().toISOString());
    const points = sheet.points.map((point) => (point.id === selected.id ? marked : point));
    updateSheet((one) => ({ ...one, points }));
    // Down a termination table, on to the next row, as on a printed sheet. A wire or a cloud
    // stays put, let go so its result shows: the next one could be anywhere on the sheet.
    if (status !== "pending") {
      const next = nextRowDown(scopedPoints({ ...sheet, points }), marked);
      if (next) pick(next, true);
      else pick(null);
    }
  };

  const download = async (which: "package" | "sheet") => {
    if (!sheet) return;
    setBusy(which === "package" ? "Making the package PDF…" : `Making ${sheet.drawingNumber}…`);
    setMessage(null);
    try {
      const bytesOf = async (one: PackageSheet) => {
        const drawing = drawings.find((d) => d.id === one.drawingId);
        if (!drawing) throw new Error(`${one.drawingNumber} rev ${one.drawingRevision} is no longer in the register.`);
        return drawingBytes(drawing);
      };
      if (which === "package") {
        downloadBlob(await packagePdf({ pkg, context, bytesOf, onProgress: setBusy }), packageFileName(pkg));
      } else {
        downloadBlob(await signedSheetPdf({ bytes: await bytesOf(sheet), sheet, pkg, context }), sheetFileName(sheet));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't make the PDF.");
    } finally {
      setBusy(null);
    }
  };

  const sheetProgress = sheet ? pointProgress(scopedPoints(sheet)) : null;

  const toolbar = sheet && (
    <div
      role="toolbar"
      aria-label="Point-to-point tools"
      className="flex flex-wrap items-center gap-1 border-b border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-500/30 dark:bg-indigo-500/10"
    >
      <button
        type="button"
        aria-label="Previous sheet"
        onClick={() => goTo(sheetIndex - 1)}
        disabled={sheetIndex === 0}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-white/70 disabled:opacity-30 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <span className="min-w-20 text-center text-sm tabular-nums text-slate-700 dark:text-slate-200">
        Sheet {sheetIndex + 1} of {pkg.sheets.length}
      </span>
      <button
        type="button"
        aria-label="Next sheet"
        onClick={() => goTo(sheetIndex + 1)}
        disabled={sheetIndex >= pkg.sheets.length - 1}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-white/70 disabled:opacity-30 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="mx-1 h-6 w-px bg-indigo-200 dark:bg-indigo-500/30" />
      {TOOLS.map((entry) => {
        const disabled = entry.tool !== "pan" && (locked || (entry.tool === "extend" && selected?.shape.type !== "trace"));
        return (
          <button
            key={entry.tool}
            type="button"
            aria-pressed={tool === entry.tool}
            title={entry.hint}
            disabled={disabled}
            onClick={() => setTool(entry.tool)}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium disabled:opacity-30",
              tool === entry.tool
                ? "bg-white text-indigo-700 shadow ring-1 ring-indigo-300 dark:bg-slate-900 dark:text-indigo-300"
                : "text-slate-700 hover:bg-white/70 dark:text-slate-200 dark:hover:bg-slate-800"
            )}
          >
            {entry.icon}
            {entry.label}
          </button>
        );
      })}
      <span aria-hidden="true" className="mx-1 h-6 w-px bg-indigo-200 dark:bg-indigo-500/30" />
      <span role="group" aria-label="Drawing hand" className="inline-flex rounded-lg bg-white/70 p-0.5 dark:bg-slate-900/60">
        {(["left", "right"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={hand === side}
            title={`${side === "left" ? "Left" : "Right"}-handed: the magnifier sits on the ${side === "left" ? "right" : "left"} of the pencil`}
            onClick={() => chooseHand(side)}
            className={cn(
              "h-9 rounded-md px-2.5 text-sm font-medium",
              hand === side ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800"
            )}
          >
            {side === "left" ? "Left hand" : "Right hand"}
          </button>
        ))}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        {locked ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Check size={13} aria-hidden="true" /> Signed {sheet.signoff?.tester.name ? `by ${sheet.signoff.tester.name}` : ""}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setReopening(true)}>
              Reopen
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setSigning(true)}
            disabled={sheetStatus !== "ready"}
            title={sheetStatus === "ready" ? "Sign this sheet off" : "Every point needs testing, with no fault left open, first"}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            Sign off sheet
          </button>
        )}
      </span>
    </div>
  );

  /** The package's test criteria, kept in view while testing — beside the sheet, and in full screen — unless put away. */
  const criteriaCard = criteriaHidden ? (
    <button
      type="button"
      onClick={() => hideCriteria(false)}
      className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      <ChevronDown className="h-4 w-4" aria-hidden="true" />
      Show test criteria
    </button>
  ) : (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Test criteria</h3>
        <button
          type="button"
          onClick={() => hideCriteria(true)}
          aria-label="Hide test criteria"
          title="Hide test criteria"
          className="-my-2 -mr-2 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {criteriaLines(pkg.criteria).length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-900 dark:text-slate-100">
          {criteriaLines(pkg.criteria).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">None set — add them under “Sheets”.</p>
      )}
    </section>
  );

  /** The point in hand and the sheet's points: beside the sheet, and the full-screen sidebar. */
  const panel = sheet && shown ? (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {!selected ? (
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {sheet.points.length === 0 ? "Add the points to test" : "Pick a point"}
            </p>
            <p>
              <strong>Trace wire</strong> and drag along a wire — it snaps straight, and its wire number is read off the sheet. Use{" "}
              <strong>Extend wire</strong> where it turns a corner.
            </p>
            <p>
              <strong>Box area</strong>
              {" round a revision cloud on a layout. A cloud's triangle is read off the sheet beside it; another project's cloud is left alone."}
            </p>
            <p>
              <strong>Tap row</strong>
              {" on a termination diagram: tap a terminal row to box it, or drag down a column to add every row in it, top to bottom."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                Point {sheet.points.findIndex((point) => point.id === selected.id) + 1} of {sheet.points.length}
              </p>
              <button
                type="button"
                aria-label="Deselect"
                onClick={() => setSelectedId(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Wire / tag</span>
              <PointField
                key={`label-${selected.id}`}
                value={selected.label}
                disabled={locked}
                onCommit={(label) => updatePoint(selected.id, (point) => ({ ...point, label }))}
                className={cn(inputClass, "font-mono text-base")}
              />
            </label>
            {selected.shape.type === "area" && !selected.row && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Revision triangle</legend>
                <div className="flex flex-wrap gap-1.5">
                  {["", ...triangleOptions].map((n) => (
                    <button
                      key={n || "none"}
                      type="button"
                      title={n ? projectOf(n)?.label : undefined}
                      aria-pressed={selected.triangle === n}
                      disabled={locked}
                      onClick={() => updatePoint(selected.id, (point) => ({ ...point, triangle: n }))}
                      className={cn(
                        "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-2 text-sm disabled:opacity-60",
                        selected.triangle === n
                          ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200"
                          : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300"
                      )}
                    >
                      {n ? (
                        <span className="inline-flex items-center gap-1">
                          <Triangle n={n} size={22} />
                          <span className="font-semibold">Δ{n}</span>
                        </span>
                      ) : (
                        "None"
                      )}
                    </button>
                  ))}
                </div>
                {!inScope(selected, sheet) && (
                  <p className="text-xs text-red-700 dark:text-red-300">
                    {`Δ${selected.triangle} isn't this project's — this cloud is left out of the count, the sheet and the record.`}
                  </p>
                )}
              </fieldset>
            )}
            {selected.shape.type === "area" && !selected.row && (
              <label className="flex min-h-11 items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={selected.removal}
                  disabled={locked}
                  onChange={(event) => {
                    const removal = event.target.checked;
                    updatePoint(selected.id, (point) => ({ ...point, removal }));
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
                />
                <span>
                  Hatched cloud — <strong>remove</strong>
                  <span className="block text-xs text-slate-600 dark:text-slate-400">Checked off as removed, and drawn hatched.</span>
                </span>
              </label>
            )}
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Reading</span>
                <PointField
                  key={`reading-${selected.id}`}
                  value={selected.reading}
                  disabled={locked}
                  placeholder="e.g. 0.3 Ω"
                  onCommit={(reading) => updatePoint(selected.id, (point) => ({ ...point, reading }))}
                  className={inputClass}
                />
              </label>
              <label className="block flex-[2]">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Note</span>
                <PointField
                  key={`note-${selected.id}`}
                  value={selected.note}
                  disabled={locked}
                  placeholder={selected.status === "fault" ? "What's wrong, what was done" : "Optional"}
                  onCommit={(note) => updatePoint(selected.id, (point) => ({ ...point, note }))}
                  className={inputClass}
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => mark("pass")}
                disabled={locked}
                aria-pressed={selected.status === "pass"}
                className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 text-[15px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
              >
                {selected.removal ? (
                  "Removed"
                ) : (
                  <>
                    <Check size={17} aria-hidden="true" /> Pass
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => mark("fault")}
                disabled={locked}
                aria-pressed={selected.status === "fault"}
                className="inline-flex h-12 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-red-50 text-[15px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
              >
                <X size={17} aria-hidden="true" /> Fault
              </button>
              <button
                type="button"
                onClick={() => mark("na")}
                disabled={locked}
                aria-pressed={selected.status === "na"}
                className="h-12 rounded-lg border border-slate-300 text-[15px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                N/A
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span>
                {selected.status === "pending"
                  ? "Not tested yet"
                  : `${resultLabel(selected)} · ${selected.testedBy || "—"}`}
                {selected.faults.length > 0 && ` · failed ${selected.faults.length}×`}
              </span>
              {!locked && (
                <span className="flex gap-1">
                  {selected.status !== "pending" && (
                    <Button variant="ghost" size="sm" onClick={() => mark("pending")}>
                      Untest
                    </Button>
                  )}
                  <button
                    type="button"
                    aria-label={`Delete point ${selected.label}`}
                    onClick={() => setRemoving(selected)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Points on this sheet</h3>
          {sheetProgress && sheetProgress.total > 0 && (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {sheetProgress.total - sheetProgress.pending}/{sheetProgress.total}
            </span>
          )}
        </div>
        {sheet.points.length === 0 ? (
          <p className="p-4 text-sm text-slate-600 dark:text-slate-400">None yet.</p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto">
            {sheet.points.map((point) => (
              <li key={point.id}>
                <button
                  type="button"
                  aria-pressed={point.id === selectedId}
                  onClick={() => pick(point, true)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 border-b border-slate-100 px-4 py-2 text-left dark:border-slate-800",
                    point.id === selectedId ? "bg-indigo-50 dark:bg-indigo-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{point.label}</span>
                    <span className="block truncate text-xs text-slate-600 dark:text-slate-400">
                      {point.triangle && `Δ${point.triangle} · `}
                      {point.shape.type === "area" ? (point.row ? "Terminal row" : point.removal ? "Hatched cloud · remove" : "Area") : `Wire${point.shape.segments.length > 1 ? ` · ${point.shape.segments.length} runs` : ""}`}
                      {point.page > 1 && ` · page ${point.page}`}
                      {point.reading && ` · ${point.reading}`}
                      {point.status === "pass" && point.faults.length > 0 && " · rectified"}
                    </span>
                  </span>
                  {inScope(point, sheet) ? (
                    <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[point.status])}>
                      {resultLabel(point)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border border-dashed border-slate-400 px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-400">
                      Other project
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {locked && (
        <Button variant="secondary" className="w-full" onClick={() => void download("sheet")} disabled={Boolean(busy)}>
          <span className="inline-flex items-center gap-1.5">
            <Download size={15} aria-hidden="true" /> Download this signed sheet
          </span>
        </Button>
      )}
      {(sheetMarkups.length > 0 || markupStore.error) && (
        <section
          aria-label={`Markups on ${shown.number}`}
          className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Markups on this sheet</h3>
          {markupStore.error && <p role="alert" className="mb-2 text-sm text-red-700 dark:text-red-300">{markupStore.error}</p>}
          <MarkupsPanel
            project={project}
            drawings={drawings}
            store={markupStore}
            markups={sheetMarkups}
            emptyText="No markups on this sheet."
            onShow={showMarkup}
          />
        </section>
      )}
    </>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          aria-label="Back to the packages"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-[1_1_240px]">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Commissioning package{pkg.assignedTo ? ` · ${pkg.assignedTo}` : ""}
          </p>
          <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
            {pkg.panelTag}
            {pkg.panelTag && pkg.name ? " — " : ""}
            {pkg.name}
          </p>
        </div>
        <div className="w-52">
          <p className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>
              {progress.signed} of {progress.sheets} sheets signed
            </span>
            <span>
              {progress.total - progress.pending}/{progress.total}
            </span>
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full bg-emerald-600" style={{ width: `${Math.round(testedShare(progress) * 100)}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <span className="inline-flex items-center gap-1.5">
              <ListChecks size={15} aria-hidden="true" /> Sheets
            </span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void download("package")} disabled={Boolean(busy)}>
            <span className="inline-flex items-center gap-1.5">
              <Download size={15} aria-hidden="true" /> Package PDF
            </span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onHandover}
            disabled={blockers.length > 0}
            title={blockers.length > 0 ? blockers.join("\n") : "Send the signed package"}
          >
            <span className="inline-flex items-center gap-1.5">
              <Send size={15} aria-hidden="true" /> Hand over package
            </span>
          </Button>
        </div>
      </div>

      {(busy || message) && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {busy ?? message}
        </p>
      )}

      {pkg.sheets.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <label htmlFor="p2p-search" className="sr-only">
            Search the text on the package&apos;s sheets
          </label>
          <div className="flex min-h-11 min-w-0 flex-[999_1_320px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800">
            <Search size={17} className="shrink-0 text-slate-500" aria-hidden="true" />
            <input
              id="p2p-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search text on the package's sheets — a tag, cable or terminal, e.g. M820C-W045"
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
              {totalMatches === 0 ? (
                <>
                  &ldquo;{normaliseQuery(query)}&rdquo; isn&apos;t on any sheet in the package{wholeTag ? " as a whole tag" : ""}.
                </>
              ) : (
                <>
                  <strong className="text-slate-900 dark:text-slate-100">
                    {totalMatches} match{totalMatches === 1 ? "" : "es"}
                  </strong>{" "}
                  on {sheetsMatching} of {pkg.sheets.length} sheet{pkg.sheets.length === 1 ? "" : "s"}
                  {sheetMatches[sheetIndex] === 0 && " — none on this one"}
                </>
              )}
            </p>
          )}
          {nextMatching !== undefined && (
            <Button variant="secondary" size="sm" onClick={() => goTo(nextMatching)}>
              <span className="inline-flex items-center gap-1.5">
                Sheet {nextMatching + 1} <ChevronRight size={15} aria-hidden="true" />
              </span>
            </Button>
          )}
        </div>
      )}

      <nav aria-label="Sheets in the package" className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <ol className="flex gap-2 overflow-x-auto p-2">
          {pkg.sheets.map((one, i) => {
            const status = sheetState(one, currentDrawing(one, drawings));
            const points = pointProgress(scopedPoints(one));
            return (
              <li key={`${one.drawingId}-${i}`} className="w-60 shrink-0">
                <button
                  type="button"
                  aria-current={i === sheetIndex ? "page" : undefined}
                  onClick={() => goTo(i)}
                  className={cn(
                    "flex h-full w-full flex-col gap-1 rounded-xl border-2 px-3 py-2 text-left",
                    i === sheetIndex
                      ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-500/10"
                      : "border-transparent bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800"
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {i + 1}. {one.drawingNumber}
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", STATE_STYLE[status])}>{SHEET_STATE_LABEL[status]}</span>
                  </span>
                  <span className="truncate text-sm text-slate-800 dark:text-slate-200">{one.drawingTitle || one.fileName}</span>
                  <span className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <span className="block h-full bg-emerald-600" style={{ width: `${Math.round(testedShare(points) * 100)}%` }} />
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {points.total === 0 ? "No points yet" : `${points.total - points.pending} of ${points.total} tested`}
                    {points.fault > 0 && ` · ${points.fault} fault${points.fault === 1 ? "" : "s"}`}
                  </span>
                  {searching && sheetMatches[i] > 0 && (
                    <span className="self-start rounded-full bg-yellow-200 px-2 py-0.5 text-[11px] font-semibold text-yellow-950">
                      {sheetMatches[i]} match{sheetMatches[i] === 1 ? "" : "es"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_560px] space-y-3">
          {!sheet ? (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
              This package has no sheets. Add some with “Sheets”.
            </p>
          ) : !shown ? (
            <p role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {sheet.drawingNumber} is no longer in the drawing register. Add it back, or take it out of the package with “Sheets”.
            </p>
          ) : (
            <>
              {sheetStatus === "stale" && current && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
                  <AlertTriangle size={17} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    {sheet.drawingNumber} was checked at rev {sheet.drawingRevision || "—"}; the register now has rev {current.revision || "—"}. Move the sheet to it —
                    the points stay where they are, but every one goes back to untested and the sign-off is cleared.
                  </span>
                  <Button variant="danger" size="sm" onClick={() => updateSheet((one) => moveToRevision(one, current, titles.get(current.id) ?? ""))}>
                    Move to rev {current.revision || "—"}
                  </Button>
                </div>
              )}
              <section
                aria-label="This project's work on the sheet"
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-2xl border px-3",
                  projects.length === 0 && looseTriangles.length === 0
                    ? "border-slate-200 bg-white py-1.5 dark:border-slate-800 dark:bg-slate-900"
                    : "border-amber-200 bg-amber-50 py-2 dark:border-amber-500/30 dark:bg-amber-500/10"
                )}
              >
                {projects.length === 0 ? (
                  // Most termination diagrams and schematics: no revision table to pick from, so one quiet line.
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    No revision table read off this sheet — if its clouds belong to more than one project, add this project&apos;s triangles by number.
                  </span>
                ) : (
                  <span className="basis-full text-sm font-semibold text-amber-950 dark:text-amber-100">Which projects on this drawing are ours?</span>
                )}
                {projects.map((project) => {
                  const on = project.triangles.every((n) => sheet.triangles.includes(n));
                  return (
                    <button
                      key={project.key}
                      type="button"
                      aria-pressed={on}
                      disabled={locked}
                      onClick={() => setProject(project.key, !on)}
                      title={project.triangles.map((n) => `Δ${n} ${rowOf(n)?.date ?? ""} ${rowOf(n)?.text ?? ""}`.trim()).join("\n")}
                      className={cn(
                        "inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-left text-sm disabled:opacity-60",
                        on
                          ? "border-amber-500 bg-amber-200 text-amber-950 dark:bg-amber-500/30 dark:text-amber-50"
                          : "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                      )}
                    >
                      <span className="inline-flex shrink-0 -space-x-1">
                        {project.triangles.map((n) => (
                          <Triangle key={n} n={n} size={24} />
                        ))}
                      </span>
                      <span className="min-w-0 truncate font-semibold">{project.label}</span>
                      {on && <Check size={14} aria-hidden="true" className="shrink-0" />}
                    </button>
                  );
                })}
                {looseTriangles.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed
                    disabled={locked}
                    onClick={() => toggleTriangle(n)}
                    title={`Δ${n}, added by hand — tap to take it off`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-amber-500 bg-amber-200 px-2.5 py-1 text-sm text-amber-950 disabled:opacity-60 dark:bg-amber-500/30 dark:text-amber-50"
                  >
                    <Triangle n={n} size={24} />
                    <strong>Δ{n}</strong>
                    <Check size={14} aria-hidden="true" className="shrink-0" />
                  </button>
                ))}
                {!locked && projects.length === 0 && (
                  <form
                    className="inline-flex items-center gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const n = newTriangle.trim();
                      if (n && !sheet.triangles.includes(n)) toggleTriangle(n);
                      setNewTriangle("");
                    }}
                  >
                    <label className="sr-only" htmlFor="add-triangle">
                      Add a triangle by number
                    </label>
                    <input
                      id="add-triangle"
                      value={newTriangle}
                      onChange={(event) => setNewTriangle(event.target.value)}
                      autoCapitalize="characters"
                      placeholder="Δ no."
                      className="h-10 w-20 rounded-lg border border-amber-300 bg-white px-2 text-sm dark:border-amber-500/40 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <Button variant="secondary" size="sm" type="submit" disabled={!newTriangle.trim()}>
                      Add
                    </Button>
                  </form>
                )}
                {projects.length > 0 && (
                  <span className="basis-full text-xs text-amber-900 dark:text-amber-200">
                    {sheet.triangles.length > 0
                      ? "Clouds tagged with another project's triangles are left alone, and not counted, drawn or recorded. A project picked here is picked on every sheet of the package."
                      : "Tick every project on the revision table that is your work — each takes all of its triangles on this drawing, and on the package's other drawings too. Until then every cloud counts."}
                  </span>
                )}
              </section>
              {ignored && (
                <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
                  <Triangle n={ignored.triangle} />
                  <span className="min-w-0 flex-1">
                    {`That cloud is tagged Δ${ignored.triangle}${projectOf(ignored.triangle) ? ` — ${projectOf(ignored.triangle)?.label}` : ""}, another project's. It's been left alone.`}
                  </span>
                  <Button variant="secondary" size="sm" onClick={claimIgnored}>
                    {projectOf(ignored.triangle) ? "It's ours — add the project" : `It's ours — add Δ${ignored.triangle}`}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setIgnored(null)}>
                    OK
                  </Button>
                </div>
              )}
              <DrawingViewer
                key={shown.id}
                drawing={shown}
                title={titles.get(shown.id) ?? sheet.drawingTitle}
                query={query}
                wholeTag={wholeTag}
                toolbar={toolbar}
                focusBox={focus}
                markups={sheetMarkups}
                // Marking up stays open on a signed sheet: a change found later still needs recording.
                onMarkupDone={({ page, shapes }) => setNewMarkup({ drawing: shown, page, shapes })}
                focusMarkup={markupFocus}
                onPickMarkup={showMarkup}
                onMarkupChange={(markup) =>
                  void markupStore.save(markup).catch((error) => setMessage(error instanceof Error ? error.message : "Couldn't save the markup."))
                }
                markupInk="blue"
                sidebar={
                  <div className="space-y-3 p-3">
                    {criteriaCard}
                    {panel}
                  </div>
                }
                overlay={(view) => (
                  <CheckLayer
                    aspect={view.aspect}
                    page={view.page}
                    points={sheet.points}
                    dimmed={sheet.points.filter((point) => !inScope(point, sheet)).map((point) => point.id)}
                    selectedId={selectedId}
                    tool={locked ? "pan" : tool}
                    canDraw={!locked}
                    hand={hand}
                    labelFor={(segment) => labelFromText(view.textIn(labelArea({ type: "trace", segments: [segment] }, view.aspect)))}
                    onReshape={(point, shape) => updatePoint(point.id, (one) => ({ ...one, shape }))}
                    onMark={mark}
                    onDelete={(point) => {
                      // Just drawn and untouched: gone at once, like an undo. Anything with a result asks first.
                      if (point.status === "pending" && !point.reading && !point.note) {
                        updateSheet((one) => ({ ...one, points: one.points.filter((p) => p.id !== point.id) }));
                        setSelectedId(null);
                      } else setRemoving(point);
                    }}
                    onExtendStart={() => setTool("extend")}
                    stampAt={sheet.stampAt}
                    // Not just because every point so far has a result: tapping rows one at a time, each
                    // pass leaves the sheet "ready", and the stamp's corner sits over the terminal table —
                    // it covered the row just passed. Shown while placing it, signing, or once signed.
                    showStamp={tool === "stamp" || signing || sheetStatus === "signed"}
                    onAdd={(shape) => addPoint(shape, view.page, view.aspect, view.textIn)}
                    onExtend={(segment) => extendPoint(segment, view.page, view.aspect, view.textIn)}
                    onPick={(point) => pick(point)}
                    onRow={(at) => addRowAt(at, view.page, view.aspect, view.runsIn)}
                    onRows={(rect) => addRowsIn(rect, view.page, view.runsIn)}
                    // Place stamp stays on, so it can be nudged again until it sits right.
                    onStamp={(at) => updateSheet((one) => ({ ...one, stampAt: at }))}
                  />
                )}
              />
            </>
          )}
        </div>

        {sheet && shown && (
          <aside aria-label="Check points" className="min-w-0 flex-[1_1_300px] space-y-3 xl:max-w-[360px]">
            {criteriaCard}
            {panel}
          </aside>
        )}
      </div>

      {newMarkup && (
        <MarkupForm
          isOpen
          heading={`New markup on ${newMarkup.drawing.number}`}
          initial={{ kind: "issue", title: "", comment: "" }}
          onCancel={() => setNewMarkup(null)}
          onSave={(details) => void saveNewMarkup(details)}
        />
      )}

      {signing && sheet && (
        <SheetSignoff
          pkg={pkg}
          sheet={sheet}
          current={current}
          onCancel={() => setSigning(false)}
          onSign={(signoff) => {
            setSigning(false);
            setTool("pan");
            updateSheet((one) => ({ ...one, signoff }));
          }}
        />
      )}

      <ConfirmDialog
        isOpen={reopening}
        title={`Reopen ${sheet?.drawingNumber ?? "the sheet"}?`}
        body="The sign-off is cleared so points can be changed. The sheet needs signing again before the package can be handed over."
        confirmLabel="Reopen"
        onCancel={() => setReopening(false)}
        onConfirm={() => {
          setReopening(false);
          updateSheet((one) => ({ ...one, signoff: null }));
        }}
      />
      <ConfirmDialog
        isOpen={removing !== null}
        title={`Delete point ${removing?.label ?? ""}?`}
        body="It comes off the sheet, with its result."
        confirmLabel="Delete"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const gone = removing;
          setRemoving(null);
          if (!gone) return;
          updateSheet((one) => ({ ...one, points: one.points.filter((point) => point.id !== gone.id) }));
          setSelectedId(null);
        }}
      />
    </div>
  );
}
