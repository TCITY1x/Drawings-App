/**
 * Point-to-point commissioning: a panel's drawings packaged into a working
 * set, every conductor or component on them checked off and highlighted, and
 * each sheet signed before the package is handed over.
 *
 * A PACKAGE is the drawings for one panel, in the order they're worked
 * through. Each SHEET is one drawing at the revision it was packaged at, with
 * its CHECK POINTS — a wire traced along the schematic, or an area boxed (a
 * revision cloud on a layout, a row of a termination table) — each marked
 * pass, fault or N/A as it's tested. A sheet is signed on its own once every
 * point is done; the package is complete when every sheet is signed, and goes
 * out as one PDF: a cover page, then each signed sheet.
 *
 * A sheet often carries clouds for several projects, each tagged with a
 * revision TRIANGLE whose number is a row of the sheet's revision table. Only
 * the triangles that are this package's project are in scope — a sheet's
 * `triangles` — and a cloud tagged with any other is someone else's work and
 * left alone: not added, and not counted, drawn or recorded if it was.
 *
 * Shapes are in page fractions (0–1 from the top-left), like markups, so they
 * sit in the same place at every zoom and in the exported PDF.
 *
 * Pure and free of relative imports so `node --test` can load it directly.
 */

export type Point = [number, number];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CheckStatus = "pending" | "pass" | "fault" | "na";

export const CHECK_STATUSES: CheckStatus[] = ["pending", "pass", "fault", "na"];

export const CHECK_LABEL: Record<CheckStatus, string> = {
  pending: "To test",
  pass: "Pass",
  fault: "Fault",
  na: "N/A",
};

/**
 * How each result is drawn: yellow highlighter for verified (the colour the
 * trade already uses on paper), red for a fault, grey for N/A. An untested
 * point is only outlined on screen and left off the exported sheet.
 */
export const CHECK_INK: Record<CheckStatus, { hex: string; rgb: [number, number, number]; opacity: number }> = {
  pending: { hex: "#2563eb", rgb: [0.15, 0.39, 0.92], opacity: 0 },
  pass: { hex: "#facc15", rgb: [0.98, 0.8, 0.08], opacity: 0.5 },
  fault: { hex: "#ef4444", rgb: [0.94, 0.27, 0.27], opacity: 0.45 },
  na: { hex: "#94a3b8", rgb: [0.58, 0.64, 0.72], opacity: 0.45 },
};

/** A wire, traced as straight runs; or an area boxed — a cloud, a terminal row. */
export type CheckShape = { type: "trace"; segments: [Point, Point][] } | { type: "area"; rect: Rect };

export interface FaultRecord {
  at: string;
  by: string;
  note: string;
}

export interface CheckPoint {
  id: string;
  /** Page of the drawing it's on. */
  page: number;
  /** Wire number, tag or terminal — read off the sheet where it can be, editable. */
  label: string;
  shape: CheckShape;
  status: CheckStatus;
  /** What the meter read — continuity, insulation resistance… Free text. */
  reading: string;
  note: string;
  /** Who set the status, and when. Empty while untested. */
  testedBy: string;
  testedAt: string;
  /** Every time it failed. A pass after a fault is a rectified fault. */
  faults: FaultRecord[];
  /**
   * A hatched cloud: the item is to be taken OUT, not put in, so its pass
   * reads "Removed" and it's drawn hatched. Only ever set on an area.
   */
  removal: boolean;
  /** The revision triangle the cloud is tagged with — "" when it has none. */
  triangle: string;
  /** A row of a termination table, boxed to its text — an area that reads as a terminal. */
  row: boolean;
}

export interface Signer {
  name: string;
  company: string;
  /** Licence number for the tester; role for a witness. */
  detail: string;
  /** The drawn signature, as a PNG data URL. "" when none was drawn. */
  signature: string;
  at: string;
}

export interface Instrument {
  model: string;
  serial: string;
  calibrationDue: string;
}

export interface SheetSignoff {
  tester: Signer;
  /** The client's witness. Optional — not every client sends one. */
  witness: Signer | null;
  instrument: Instrument;
  /** The account that recorded the sign-off. */
  signedBy: string;
  signedAt: string;
}

export interface PackageSheet {
  drawingId: string;
  /** Copied from the register, so the sheet still reads right if the drawing is replaced. */
  drawingNumber: string;
  drawingRevision: string;
  drawingTitle: string;
  fileName: string;
  points: CheckPoint[];
  signoff: SheetSignoff | null;
  /** Top-left of the sign-off stamp on page 1. Null: the default corner. */
  stampAt: Point | null;
  /**
   * The revision triangles on this sheet that are this project's. Empty: not
   * narrowed down, and every point counts.
   */
  triangles: string[];
}

export interface PackageSend {
  at: string;
  by: string;
  to: string[];
  fileUrl: string;
}

export interface CommissioningPackage {
  id: string;
  projectId: string;
  name: string;
  /** The panel or equipment tag it covers. */
  panelTag: string;
  assignedTo: string;
  /**
   * The client's code(s) for the project — "PE2040" — as the drawings'
   * revision tables name it; a sheet's rows that mention one are its triangles.
   */
  projectCode: string;
  /**
   * What a point has to meet to pass, one per line — kept beside the sheet
   * while testing, and printed on the cover page.
   */
  criteria: string;
  sheets: PackageSheet[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sends: PackageSend[];
}

/** The criteria a new package starts with: the usual point-to-point checks. */
export const DEFAULT_CRITERIA = [
  "Continuity end to end ≤ 1.0 Ω",
  "Ferrule numbers match the drawing",
  "Terminations tight, no exposed copper",
].join("\n");

/** The criteria as lines, blanks dropped. */
export function criteriaLines(criteria: string): string[] {
  return criteria
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface Progress {
  total: number;
  pass: number;
  fault: number;
  na: number;
  pending: number;
  /** Passes that failed first. */
  rectified: number;
}

/** A run of text on the sheet and where it sits, in page fractions. */
export interface PlacedRun {
  box: Rect;
  str: string;
}

export interface TextRow {
  /** The row's box, a little bigger than its text. */
  rect: Rect;
  /** Its runs, left to right. */
  texts: string[];
}

/**
 * Text runs grouped into the rows of a table, as a termination diagram lays
 * out a terminal strip: runs whose middles sit at the same height are one
 * line, and a line is split into separate rows wherever there's a gap wider
 * than `maxGap` of the page (the next table along) — by default never, for
 * runs already cut to one table's width. Top to bottom, then left to right.
 */
export function textRows(runs: PlacedRun[], maxGap = Infinity): TextRow[] {
  const sorted = [...runs].sort((a, b) => a.box.top + a.box.height / 2 - (b.box.top + b.box.height / 2));
  const lines: PlacedRun[][] = [];
  for (const run of sorted) {
    const middle = run.box.top + run.box.height / 2;
    const line = lines[lines.length - 1];
    const lineMiddle = line ? line.reduce((sum, one) => sum + one.box.top + one.box.height / 2, 0) / line.length : 0;
    const height = line ? Math.max(...line.map((one) => one.box.height), run.box.height) : 0;
    if (line && Math.abs(middle - lineMiddle) <= height * 0.5) line.push(run);
    else lines.push([run]);
  }
  // Each row's text box first; padded afterwards, so the padding can stop
  // halfway to the row above or below rather than overlap it.
  const tight: { left: number; top: number; right: number; bottom: number; texts: string[] }[] = [];
  for (const line of lines) {
    const across = [...line].sort((a, b) => a.box.left - b.box.left);
    let group: PlacedRun[] = [];
    const flush = () => {
      if (group.length === 0) return;
      tight.push({
        left: Math.min(...group.map((run) => run.box.left)),
        top: Math.min(...group.map((run) => run.box.top)),
        right: Math.max(...group.map((run) => run.box.left + run.box.width)),
        bottom: Math.max(...group.map((run) => run.box.top + run.box.height)),
        texts: group.map((run) => run.str),
      });
      group = [];
    };
    for (const run of across) {
      const last = group[group.length - 1];
      if (last && run.box.left - (last.box.left + last.box.width) > maxGap) flush();
      group.push(run);
    }
    flush();
  }
  const rows = tight.map((row) => {
    const sideBySide = (other: (typeof tight)[number]) => other !== row && other.left < row.right && other.right > row.left;
    const pad = (row.bottom - row.top) * 0.2;
    const above = Math.max(-Infinity, ...tight.filter((o) => sideBySide(o) && o.bottom <= row.top).map((o) => (o.bottom + row.top) / 2));
    const below = Math.min(Infinity, ...tight.filter((o) => sideBySide(o) && o.top >= row.bottom).map((o) => (o.top + row.bottom) / 2));
    const top = Math.max(row.top - pad, above);
    const bottom = Math.min(row.bottom + pad, below);
    return { rect: { left: row.left - 0.003, top, width: row.right - row.left + 0.006, height: bottom - top }, texts: row.texts };
  });
  return rows.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
}

/**
 * The gap that separates one table from the next along a line, from the runs
 * themselves: cells within a table sit a fairly even distance apart, so a gap
 * well over the usual one is the space between tables. Never under 1.5% of
 * the page.
 */
export function tableGap(runs: PlacedRun[]): number {
  const gaps: number[] = [];
  for (const line of textRows(runs)) {
    // Runs on one line, left to right, by their text — textRows keeps them in order.
    const onLine = runs
      .filter((run) => run.box.top + run.box.height / 2 >= line.rect.top && run.box.top + run.box.height / 2 <= line.rect.top + line.rect.height)
      .sort((a, b) => a.box.left - b.box.left);
    for (let i = 1; i < onLine.length; i += 1) gaps.push(onLine[i].box.left - (onLine[i - 1].box.left + onLine[i - 1].box.width));
  }
  const positive = gaps.filter((gap) => gap > 0).sort((a, b) => a - b);
  if (positive.length === 0) return 0.015;
  const median = positive[Math.floor(positive.length / 2)];
  return Math.max(0.015, median * 2.5);
}

/** The row of a table under a tap — the one it's in, else the nearest within `reach` of the page width. */
export function rowAt(runs: PlacedRun[], at: Point, aspect: number, maxGap = Infinity, reach = 0.01): TextRow | null {
  let best: { row: TextRow; distance: number } | null = null;
  for (const row of textRows(runs, maxGap)) {
    const distance = distanceTo({ type: "area", rect: row.rect }, at, aspect);
    if (distance <= reach && (!best || distance < best.distance)) best = { row, distance };
  }
  return best?.row ?? null;
}

/** A point's result as it reads: a hatched cloud that passes was removed. */
export function resultLabel(point: Pick<CheckPoint, "status" | "removal">): string {
  return point.status === "pass" && point.removal ? "Removed" : CHECK_LABEL[point.status];
}

/**
 * Diagonal hatch lines filling a box, as hatched clouds are drawn on a
 * sheet: lines at 45° on the sheet as you look at it, `spacing` apart (in
 * page widths), each cut to the box. Page fractions in, page fractions out.
 */
export function hatchLines(rect: Rect, aspect: number, spacing = 0.006): [Point, Point][] {
  // In square units (page widths both ways) a 45° line is x + y = c.
  const x0 = rect.left;
  const x1 = rect.left + rect.width;
  const y0 = rect.top / aspect;
  const y1 = (rect.top + rect.height) / aspect;
  const out: [Point, Point][] = [];
  for (let c = x0 + y0 + spacing; c < x1 + y1; c += spacing) {
    // Where x + y = c enters and leaves the box.
    const start: Point = [Math.max(x0, c - y1), 0];
    start[1] = c - start[0];
    const end: Point = [Math.min(x1, c - y0), 0];
    end[1] = c - end[0];
    if (end[0] - start[0] <= 1e-9) continue;
    out.push([
      [start[0], start[1] * aspect],
      [end[0], end[1] * aspect],
    ]);
  }
  return out;
}

/** A point is in scope unless it's tagged with a triangle that isn't this project's. */
export function inScope(point: Pick<CheckPoint, "triangle">, sheet: Pick<PackageSheet, "triangles">): boolean {
  return sheet.triangles.length === 0 || !point.triangle || sheet.triangles.includes(point.triangle);
}

/** The sheet's points that are this project's work — what's tested, signed and recorded. */
export function scopedPoints(sheet: Pick<PackageSheet, "points" | "triangles">): CheckPoint[] {
  return sheet.points.filter((point) => inScope(point, sheet));
}

/** A row of a sheet's revision table: its number — what the triangles show — date and text. */
export interface RevisionRow {
  n: string;
  date: string;
  text: string;
}

const REV_DATE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;
/** A revision: "3", "12", or a lettered one — "A", "3AB" (a double-alpha revision). */
const REV_NUMBER = /^(?:\d{1,2}[A-Z]{0,3}|[A-Z]{1,2})$/;
const REV_COMBINED = /^(\d{1,2}[A-Z]{0,3}|[A-Z]{1,2})\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b\s*(.*)$/;

/** Revisions in the order a table lists them: 0, 1, 2, 3, 3AB, … */
const byRevision = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/**
 * The revision table, read from a page's text (its runs, one per line): a
 * number and a date, as one run or two, then the revision's text. Rows are
 * keyed by number — the first wins — and come back in number order.
 */
export function revisionRows(pageText: string): RevisionRow[] {
  const lines = pageText.split("\n").map((line) => line.trim()).filter(Boolean);
  const rows = new Map<string, RevisionRow>();
  const startsRow = (index: number) =>
    REV_COMBINED.test(lines[index] ?? "") || (REV_NUMBER.test(lines[index] ?? "") && REV_DATE.test(lines[index + 1] ?? ""));
  for (let i = 0; i < lines.length; i += 1) {
    let n = "";
    let date = "";
    let next = i + 1;
    const text: string[] = [];
    const combined = REV_COMBINED.exec(lines[i]);
    if (combined) {
      [, n, date] = combined;
      if (combined[3].trim()) text.push(combined[3].trim());
    } else if (REV_NUMBER.test(lines[i]) && REV_DATE.test(lines[i + 1] ?? "")) {
      n = lines[i];
      date = lines[i + 1];
      next = i + 2;
    } else continue;
    // Up to three lines: a project's name can sit above its code, with the issue status under them.
    for (let j = next; j < lines.length && text.length < 3 && !startsRow(j) && !REV_DATE.test(lines[j]); j += 1) text.push(lines[j]);
    if (!rows.has(n)) rows.set(n, { n, date, text: text.join(" — ") });
  }
  return [...rows.values()].sort((a, b) => byRevision(a.n, b.n));
}

/**
 * A client project code in a revision row: "PE03260", "PE-2040", "AP03135"
 * — often typed "APO3135", with a letter O — or a work breakdown code,
 * "FX00.C.96254.0200". Not a drawing number ("F080-E-12590").
 */
const PROJECT_CODE = /(?<!-)\b(?:[A-Z]{2}\d{2}\.[A-Z]\.\d{5}\.\d{4}|([A-Z]{1,4}?)-?[O0]*(\d{3,6}[A-Z]?))\b(?!-[A-Z]-)/;

/**
 * The first project code in some text, as written and as compared: the
 * letters and the number without its leading zeros, so "AP03135",
 * "APO3135" and "AP-3135" are one project.
 */
function codeIn(text: string): { raw: string; key: string } | null {
  const match = PROJECT_CODE.exec(text.toUpperCase());
  if (!match) return null;
  return { raw: match[0], key: match[1] === undefined ? match[0] : `${match[1]}${match[2]}` };
}

/**
 * What a revision row's project is known by: the first project code in it
 * ("PE03260"), else its first line of text ("ENGULFMENT RISK REDUCTION"). A
 * row with no text has no project — "".
 */
export function projectKey(text: string): string {
  const code = codeIn(text);
  if (code) return code.key;
  return text
    .toUpperCase()
    .split(" — ")[0]
    .replace(/[,;]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–:.]+$/, "")
    .trim();
}

/** A revision row's project as the sheet words it: the line naming its code ("PE04046 - SLEW STRIKER DESIGN"), else its first line. */
function projectLabel(text: string): string {
  const lines = text.split(" — ").map((line) => line.trim());
  return lines.find((line) => codeIn(line)) ?? lines[0];
}

/** A project named on a sheet's revision table, and the triangles — its rows — that are its work there. */
export interface RevisionProject {
  key: string;
  /** What's kept on the package when it's picked: its code as the sheet writes it, else its key. */
  code: string;
  /** As the sheet words it: the line of its first row with the project code, else the first line. */
  label: string;
  triangles: string[];
}

/**
 * The sheet's revision rows, gathered by project. Triangle numbers are only
 * the sheet's own — Δ2 is one project on this drawing and another on the
 * next — so what's in scope is picked by project, and each sheet's triangles
 * follow from its own table. A row with no text is a project of its own.
 */
export function revisionProjects(rows: RevisionRow[]): RevisionProject[] {
  const projects = new Map<string, RevisionProject>();
  for (const row of rows) {
    const key = projectKey(row.text) || `Δ${row.n}`;
    const known = projects.get(key);
    if (known) known.triangles.push(row.n);
    else projects.set(key, { key, code: codeIn(row.text)?.raw ?? key, label: projectLabel(row.text) || `Revision ${row.n}`, triangles: [row.n] });
  }
  return [...projects.values()];
}

/** A package's project code(s) as entries: split on commas, and on spaces between codes; a project's name kept whole. */
function projectEntries(projectCode: string): string[] {
  return projectCode
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const words = part.split(/\s+/);
      return words.every((word) => codeIn(word)?.raw === word.toUpperCase()) ? words : [part];
    });
}

/** The project keys in a package's project code(s). */
export function projectKeys(projectCode: string): string[] {
  return [...new Set(projectEntries(projectCode).map(projectKey).filter((key) => key.length >= 3))];
}

/** The package's project code(s) with a project added or taken out. */
export function withProject(projectCode: string, code: string, on: boolean): string {
  const key = projectKey(code);
  const kept = projectEntries(projectCode).filter((entry) => projectKey(entry) !== key);
  return (on ? [...kept, code] : kept).join(", ");
}

/** The triangles whose revision rows are one of the package's projects ("PE2040", or several, comma-separated). */
export function trianglesFor(rows: RevisionRow[], projectCode: string): string[] {
  const keys = projectKeys(projectCode);
  if (keys.length === 0) return [];
  return rows.filter((row) => keys.includes(projectKey(row.text))).map((row) => row.n);
}

/**
 * The triangle a boxed cloud is tagged with, from the text around it: a lone
 * number that is a row of the revision table. Item balloons are numbers too,
 * so only revision numbers count, and only when exactly one is there.
 */
export function triangleFrom(texts: string[], rows: RevisionRow[]): string {
  const known = new Set(rows.map((row) => row.n));
  const found = new Set(texts.map((text) => text.trim()).filter((text) => REV_NUMBER.test(text) && known.has(text)));
  return found.size === 1 ? [...found][0] : "";
}

export function pointProgress(points: CheckPoint[]): Progress {
  const out: Progress = { total: points.length, pass: 0, fault: 0, na: 0, pending: 0, rectified: 0 };
  for (const point of points) {
    out[point.status] += 1;
    if (point.status === "pass" && point.faults.length > 0) out.rectified += 1;
  }
  return out;
}

export function packageProgress(pkg: Pick<CommissioningPackage, "sheets">): Progress & { sheets: number; signed: number } {
  const all = pointProgress(pkg.sheets.flatMap(scopedPoints));
  return { ...all, sheets: pkg.sheets.length, signed: pkg.sheets.filter((sheet) => sheet.signoff).length };
}

/** Points tested so far, out of the total — what a progress bar shows. */
export function testedShare(progress: Progress): number {
  return progress.total === 0 ? 0 : (progress.total - progress.pending) / progress.total;
}

export type SheetState = "signed" | "ready" | "testing" | "not-started" | "stale";

/**
 * Where a sheet is: signed; ready to sign (every point tested, no fault left);
 * being tested; not started; or stale — the drawing was re-issued since it was
 * packaged, so what was checked may not be what's on the panel.
 */
export function sheetState(sheet: PackageSheet, current: { revision: string } | null): SheetState {
  if (isStale(sheet, current)) return "stale";
  if (sheet.signoff) return "signed";
  const progress = pointProgress(scopedPoints(sheet));
  if (progress.total > 0 && progress.pending === 0 && progress.fault === 0) return "ready";
  return progress.total === progress.pending ? "not-started" : "testing";
}

export const SHEET_STATE_LABEL: Record<SheetState, string> = {
  signed: "Signed",
  ready: "Ready to sign",
  testing: "Testing",
  "not-started": "Not started",
  stale: "Re-issued",
};

/** The register's entry has moved on from the revision this sheet was checked at. */
export function isStale(sheet: Pick<PackageSheet, "drawingRevision">, current: { revision: string } | null): boolean {
  return current !== null && current.revision.trim() !== sheet.drawingRevision.trim();
}

/**
 * The register's drawing for a sheet: the same entry, else the drawing that
 * replaced it (same number — a new revision is a new entry). Null when it's
 * gone from the register.
 */
export function currentDrawing<T extends { id: string; number: string }>(sheet: Pick<PackageSheet, "drawingId" | "drawingNumber">, drawings: T[]): T | null {
  return (
    drawings.find((drawing) => drawing.id === sheet.drawingId) ??
    drawings.find((drawing) => drawing.number.trim().toLowerCase() === sheet.drawingNumber.trim().toLowerCase()) ??
    null
  );
}

/** Why a sheet can't be signed yet; empty when it can. */
export function signBlockers(sheet: PackageSheet, current: { revision: string } | null): string[] {
  const out: string[] = [];
  if (isStale(sheet, current)) out.push(`The drawing is now rev ${current?.revision || "—"} — move the sheet to it and re-check first.`);
  const progress = pointProgress(scopedPoints(sheet));
  if (progress.total === 0) out.push("No points have been added to this sheet.");
  if (progress.pending > 0) out.push(`${progress.pending} point${progress.pending === 1 ? " is" : "s are"} still to test.`);
  if (progress.fault > 0)
    out.push(`${progress.fault} fault${progress.fault === 1 ? " is" : "s are"} still open — rectify and re-test, or mark N/A with a note.`);
  return out;
}

/** Why the package can't be handed over yet; empty when it can. */
export function handoverBlockers(pkg: CommissioningPackage, currentOf: (sheet: PackageSheet) => { revision: string } | null): string[] {
  if (pkg.sheets.length === 0) return ["The package has no sheets."];
  const out: string[] = [];
  for (const sheet of pkg.sheets) {
    const state = sheetState(sheet, currentOf(sheet));
    if (state === "stale") out.push(`${sheet.drawingNumber} has been re-issued since it was checked.`);
    else if (state !== "signed") out.push(`${sheet.drawingNumber} isn't signed yet.`);
  }
  return out;
}

/** A point given a result, with a fault logged when it fails. */
export function markPoint(point: CheckPoint, status: CheckStatus, by: string, at: string): CheckPoint {
  if (status === "pending") return { ...point, status, testedBy: "", testedAt: "" };
  return {
    ...point,
    status,
    testedBy: by,
    testedAt: at,
    faults: status === "fault" && point.status !== "fault" ? [...point.faults, { at, by, note: point.note }] : point.faults,
  };
}

/**
 * After a terminal row: the next untested row down the same table, as you
 * work along a strip. Null when it was the last, or isn't a row.
 */
export function nextRowDown(points: CheckPoint[], from: CheckPoint): CheckPoint | null {
  if (!from.row || from.shape.type !== "area") return null;
  const { left, top, width } = from.shape.rect;
  let best: CheckPoint | null = null;
  for (const point of points) {
    if (!point.row || point.status !== "pending" || point.page !== from.page || point.shape.type !== "area") continue;
    const rect = point.shape.rect;
    const sameTable = rect.left < left + width && rect.left + rect.width > left;
    if (!sameTable || rect.top <= top) continue;
    if (!best || (best.shape.type === "area" && rect.top < best.shape.rect.top)) best = point;
  }
  return best;
}

/** The next untested point after `fromId`, going round; null when none are left. */
export function nextPending(points: CheckPoint[], fromId: string | null): CheckPoint | null {
  const start = points.findIndex((point) => point.id === fromId);
  for (let step = 1; step <= points.length; step += 1) {
    const point = points[(start + step + points.length) % points.length];
    if (point && point.status === "pending" && point.id !== fromId) return point;
  }
  return null;
}

/**
 * The sheet moved onto a new revision of its drawing: the points stay where
 * they were drawn, but every one goes back to untested and the sign-off is
 * cleared — the re-issue may have changed what they cover.
 */
export function moveToRevision(
  sheet: PackageSheet,
  drawing: { id: string; number: string; revision: string; fileName: string },
  title: string
): PackageSheet {
  return {
    ...sheet,
    drawingId: drawing.id,
    drawingNumber: drawing.number,
    drawingRevision: drawing.revision,
    drawingTitle: title || sheet.drawingTitle,
    fileName: drawing.fileName,
    signoff: null,
    points: sheet.points.map((point) => ({ ...point, status: "pending", testedBy: "", testedAt: "", reading: "" })),
  };
}

/**
 * A dragged line, straightened: within 12° of across or down the sheet, it is
 * snapped to exactly that — schematics are drawn square, and a hand on a
 * tablet isn't. Measured in screen units, so a tall sheet snaps the same.
 */
export function snapSegment(from: Point, to: Point, aspect: number): [Point, Point] {
  const dx = to[0] - from[0];
  const dy = (to[1] - from[1]) / aspect;
  const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  const off = Math.min(angle, 180 - angle);
  if (off <= 12) return [from, [to[0], from[1]]];
  if (Math.abs(90 - angle) <= 12) return [from, [from[0], to[1]]];
  return [from, to];
}

/** The box a shape covers, in page fractions. */
export function shapeBounds(shape: CheckShape): Rect {
  if (shape.type === "area") return shape.rect;
  const xs = shape.segments.flatMap(([a, b]) => [a[0], b[0]]);
  const ys = shape.segments.flatMap(([a, b]) => [a[1], b[1]]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** How far `point` is from a shape, in page widths (0 inside an area). */
export function distanceTo(shape: CheckShape, point: Point, aspect: number): number {
  const [px, py] = [point[0], point[1] / aspect];
  if (shape.type === "area") {
    const { left, top, width, height } = shape.rect;
    const dx = Math.max(left - px, 0, px - (left + width));
    const dy = Math.max(top / aspect - py, 0, py - (top + height) / aspect);
    return Math.hypot(dx, dy);
  }
  let best = Infinity;
  for (const [a, b] of shape.segments) {
    const [ax, ay] = [a[0], a[1] / aspect];
    const [bx, by] = [b[0], b[1] / aspect];
    const length = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / length));
    best = Math.min(best, Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))));
  }
  return best;
}

/** The point under a tap: the nearest within `reach` (page widths), areas losing ties to wires inside them. */
/**
 * How close a ROW tap must be to a wire to pick it, in page widths: right on
 * it. A terminal row is under 0.007 of the page tall, so the usual reach
 * would take a tap on the row beside a jumper for the jumper.
 */
export const ROW_WIRE_REACH = 0.003;

export function pointAt(points: CheckPoint[], page: number, at: Point, aspect: number, reach = 0.008, insideAreas = false): CheckPoint | null {
  let best: { point: CheckPoint; distance: number } | null = null;
  for (const point of points) {
    if (point.page !== page) continue;
    const raw = distanceTo(point.shape, at, aspect);
    // `insideAreas`: an area only when the tap is in it, not just near it.
    if (insideAreas && point.shape.type === "area" && raw > 0) continue;
    // A wire inside a boxed area should still be pickable: areas count as a little further away.
    const distance = raw + (point.shape.type === "area" ? reach / 2 : 0);
    if (distance <= reach && (!best || distance < best.distance)) best = { point, distance };
  }
  return best?.point ?? null;
}

/**
 * A label for a new point from the text it covers: a wire number when there
 * is one (3–6 digits, maybe with a letter or dash), else the first tag-like
 * run, else the text joined. Empty when there's no text there.
 */
export function labelFromText(texts: string[]): string {
  const runs = texts.map((text) => text.trim()).filter(Boolean);
  const tokens = runs.flatMap((run) => run.split(/\s+/));
  // All digits first: a termination row carries a core label ("A121") beside its wire number.
  const wire = tokens.find((token) => /^\d{3,6}$/.test(token)) ?? tokens.find((token) => /^[A-Z]?\d{3,6}[A-Z]?$/i.test(token));
  if (wire) return wire;
  const tag = tokens.find((token) => /^[A-Z0-9]+([_.:/-][A-Z0-9]+)+$/i.test(token) && /\d/.test(token));
  if (tag) return tag;
  return runs.join(" ").slice(0, 40);
}

/** The point numbered after the ones already on the sheet, when no label could be read. */
export function fallbackLabel(points: CheckPoint[]): string {
  return `Point ${points.length + 1}`;
}

/** Where the sign-off stamp goes when nobody has placed it: the top-left, inside the border. */
export const DEFAULT_STAMP_AT: Point = [0.02, 0.03];
/** The stamp's width as a fraction of the sheet's. */
export const STAMP_WIDTH = 0.21;
/** Its height as a multiple of its width — what the exported stamp's lines add up to. */
export const STAMP_RATIO = 0.58;

/** A filename-safe version of a label. */
function safe(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

/** "M853C-X002 P2P package.pdf" — the package as it goes out. */
export function packageFileName(pkg: Pick<CommissioningPackage, "name" | "panelTag">): string {
  return `${safe(pkg.panelTag || pkg.name) || "Commissioning"} P2P package.pdf`;
}

/** "F085-E-12086_13 P2P signed.pdf" — one signed sheet on its own. */
export function sheetFileName(sheet: Pick<PackageSheet, "fileName" | "drawingNumber">): string {
  const base = sheet.fileName.replace(/\.pdf$/i, "").trim() || sheet.drawingNumber || "Drawing";
  return `${safe(base)} P2P signed.pdf`;
}

/** The email the package goes out with, ready to edit. */
export function packageEmail(input: {
  projectNumber: string;
  projectName: string;
  pkg: CommissioningPackage;
}): { subject: string; note: string } {
  const { pkg } = input;
  const progress = packageProgress(pkg);
  const what = pkg.panelTag || pkg.name;
  const subject = `${input.projectNumber} · P2P commissioning package — ${what} (${pkg.sheets.length} sheet${pkg.sheets.length === 1 ? "" : "s"}, signed)`;
  const lines = pkg.sheets.map(
    (sheet) =>
      `${sheet.drawingNumber}${sheet.drawingRevision ? ` rev ${sheet.drawingRevision}` : ""}${sheet.drawingTitle ? ` — ${sheet.drawingTitle}` : ""}`
  );
  const rectified = progress.rectified > 0 ? ` ${progress.rectified} fault${progress.rectified === 1 ? " was" : "s were"} rectified and re-tested.` : "";
  const note =
    `Hi,\n\nPoint-to-point commissioning of ${what} is complete. Every sheet is signed individually; the attached PDF has a cover page listing who tested and witnessed each one, then the signed sheets with the verified conductors highlighted, then the full test record.\n\n` +
    `${progress.total - progress.pending} of ${progress.total} points tested.${rectified}\n\n` +
    `${lines.join("\n")}\n\nJob ${input.projectNumber}${input.projectName ? ` — ${input.projectName}` : ""}.`;
  return { subject, note };
}

/** A run of text on the sheet with its box, in page fractions. */
export interface SheetText {
  str: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AsBuiltBox {
  company: SheetText | null;
  signature: SheetText | null;
  name: SheetText | null;
  projectCode: SheetText | null;
  markedUp: SheetText | null;
}

/**
 * The "COMMISSIONING AS-BUILT" box many clients' title blocks carry — its
 * labels, so the sign-off can be written beside them in red as-built ink, as it would be
 * by hand. Looked for just below and right of the heading. Null when the sheet
 * has no such box, or too little of it is readable to fill.
 */
export function findAsBuiltBox(texts: SheetText[]): AsBuiltBox | null {
  const heading = texts.find((text) => /COMMISSIONING\s+AS[\s-]*BUILT/i.test(text.str));
  if (!heading) return null;
  const below = texts.filter(
    (text) =>
      text !== heading &&
      text.top >= heading.top &&
      text.top <= heading.top + 0.14 &&
      text.left >= heading.left - 0.02 &&
      text.left <= heading.left + Math.max(heading.width, 0.05) + 0.03
  );
  const find = (pattern: RegExp) =>
    below.filter((text) => pattern.test(text.str.trim())).sort((a, b) => a.top - b.top)[0] ?? null;
  const box: AsBuiltBox = {
    company: find(/^COMPANY\b/i),
    signature: find(/^SIGNATURE\b/i),
    name: find(/^NAME\b/i),
    projectCode: find(/^PROJECT\s*CODE\b/i),
    markedUp: find(/DRAWING\s+MARKED\s+UP/i),
  };
  const found = [box.company, box.signature, box.name, box.projectCode].filter(Boolean).length;
  return found >= 2 ? box : null;
}
