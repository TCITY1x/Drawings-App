/**
 * A project's project drawings: reading the drawing number and revision off a file
 * name, the title off the sheet's title block, and finding text across a set.
 *
 * The PDFs themselves live in the project's Drive folder (`DRAWINGS_SUBFOLDER` in
 * `driveLayout.ts`);
 * what the app keeps is each sheet's text, so a search runs over every drawing
 * without opening one. The text is stored as pdf.js gives it — one text run per
 * line — and the viewer matches the same runs again to place its highlights, so
 * a count in the results is exactly the number of boxes drawn on the sheet.
 *
 * Pure and free of relative imports so `node --test` can load it directly.
 */

/** One drawing in a project's register. Kept outside ops state: see `drawingStore.ts`. */
export interface ProjectDrawing {
  id: string;
  projectId: string;
  /** The file name as it was uploaded. */
  fileName: string;
  /** Drawing number, read from the file name. Editable. */
  number: string;
  /** Revision, read from the file name. Editable; "" when there is none. */
  revision: string;
  /** A title someone typed. "" means use `titleLines`. */
  title: string;
  /** The title block's main lines, top to bottom, as read off page 1. */
  titleLines: string[];
  /** Each page's text runs, joined by "\n". */
  pages: string[];
  size: number;
  /** Where the PDF is kept: a `fileStore.ts` key. */
  fileKey: string;
  uploadedAt: string;
}

const PDF_NAME = /\.pdf$/i;

export function isPdfName(name: string): boolean {
  return PDF_NAME.test(name);
}

/**
 * Drawing number and revision from a file name.
 *
 *   K100-E-08056_17 CODE A1.PDF  → K100-E-08056, rev 17
 *   E-101 Lighting Rev C.pdf     → E-101, rev C
 *   E-101_RevC.pdf               → E-101, rev C
 *   E-101.pdf                    → E-101, no revision
 *
 * An explicit "Rev" wins; otherwise the number is everything before the first
 * underscore and the revision is the short code straight after it. Whatever
 * follows (status codes, sheet sizes, words) is ignored.
 */
export function parseDrawingFileName(fileName: string): { number: string; revision: string } {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();

  const rev = /(?:^|[\s_.-])rev(?:ision)?[\s_.-]*([a-z0-9]{1,4})(?![a-z0-9])/i.exec(base);
  if (rev) {
    const before = base.slice(0, rev.index).replace(/[\s_.-]+$/, "");
    return { number: firstToken(before) || before || base, revision: rev[1].toUpperCase() };
  }

  const underscore = base.indexOf("_");
  if (underscore > 0) {
    const after = /^([a-z0-9]{1,4})(?![a-z0-9])/i.exec(base.slice(underscore + 1));
    return { number: base.slice(0, underscore).trim(), revision: after ? after[1].toUpperCase() : "" };
  }

  return { number: firstToken(base) || base, revision: "" };
}

/** The first word when it looks like a drawing number (has a digit); else "". */
function firstToken(text: string): string {
  const token = text.trim().split(/\s+/)[0] ?? "";
  return /\d/.test(token) ? token : "";
}

/**
 * Compare two revisions: numbers numerically, letters alphabetically, a number
 * after a letter (A, B, C, then 0 for construction). Blank sorts first.
 */
export function compareRevisions(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b);
  if (an !== bn) return an ? 1 : -1;
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

/** Drawing numbers in register order: K100-E-08040 before K100-E-12021, E-2 before E-10. */
export function compareDrawingNumbers(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

export function sortDrawings<T extends Pick<ProjectDrawing, "number" | "fileName">>(drawings: T[]): T[] {
  return [...drawings].sort(
    (a, b) => compareDrawingNumbers(a.number, b.number) || a.fileName.localeCompare(b.fileName)
  );
}

/** What to do with an incoming drawing given the register. */
export type IncomingVerdict =
  | { kind: "new" }
  | { kind: "replace"; existing: ProjectDrawing }
  | { kind: "same"; existing: ProjectDrawing }
  | { kind: "older"; existing: ProjectDrawing };

/**
 * A drawing number appears once in the register, at its latest revision. A
 * newer revision replaces the one there; the same or an older one is skipped.
 */
export function incomingVerdict(
  register: ProjectDrawing[],
  incoming: { number: string; revision: string }
): IncomingVerdict {
  const key = incoming.number.trim().toLowerCase();
  const existing = register.find((drawing) => drawing.number.trim().toLowerCase() === key);
  if (!existing) return { kind: "new" };
  const order = compareRevisions(incoming.revision, existing.revision);
  if (order > 0) return { kind: "replace", existing };
  if (order === 0) return { kind: "same", existing };
  return { kind: "older", existing };
}

/** A text run on a page, placed in page fractions (0–1, top-left origin). */
export interface PlacedText {
  str: string;
  x: number;
  y: number;
  /** Font height in PDF points. */
  height: number;
  /** Rotation in degrees; 0 reads left to right. */
  rotation: number;
}

/**
 * The title block's main lines: the largest horizontal text in the bottom-right
 * of the sheet that is not the drawing number, stacked in one column.
 *
 * On a typical sheet that is the project, the area, then the drawing's own
 * title — "PORT ORE HANDLING - FINUCANE / CONVEYOR - CVR1 / 415V MCC 101
 * (M101C) - LP101 / SCHEMATIC DIAGRAM". The drawing number is printed bigger
 * still but in short pieces ("K100", "E", "08040", "/7"), which the length rule
 * leaves out, as it does "A1" and "NTS".
 *
 * The title is the biggest stack of same-size lines in one column, not simply
 * the biggest text: on the Civmec-drafted BWR7 sheets "BHP Iron Ore Pty Ltd"
 * sits above the title box a size larger, alone on its line.
 */
export function titleBlockLines(items: PlacedText[]): string[] {
  const candidates = items.filter(
    (item) =>
      item.x > 0.55 &&
      item.y > 0.7 &&
      Math.abs(item.rotation) < 1 &&
      item.str.trim().length >= 6 &&
      (item.str.match(/[a-z]/gi) ?? []).length >= 3
  );
  if (candidates.length === 0) return [];
  const tallest = Math.max(...candidates.map((item) => item.height));
  // Notes, signatures and the revision table are well under title size.
  const big = candidates.filter((item) => item.height >= tallest * 0.6);
  // Stacks of lines that start in one column at one size (within 10%).
  const stacks: { key: number; height: number; items: PlacedText[] }[] = [];
  for (const item of [...big].sort((a, b) => b.height - a.height)) {
    const key = Math.round(item.x * 50);
    const stack = stacks.find((s) => s.key === key && item.height >= s.height * 0.9);
    if (stack) stack.items.push(item);
    else stacks.push({ key, height: item.height, items: [item] });
  }
  // Most lines wins; a tie goes to the bigger text.
  const column = stacks.sort((a, b) => b.items.length - a.items.length || b.height - a.height)[0]?.items ?? [];
  const seen = new Set<string>();
  return column
    .sort((a, b) => a.y - b.y)
    .map((item) => item.str.replace(/\s+/g, " ").trim())
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

/**
 * Titles for the register. Lines every drawing shares (the project and area)
 * are the set's heading, not part of each title, so they come off — unless a
 * drawing has nothing else, or the set is a single drawing, when the last two
 * lines are the likeliest title.
 */
export function registerTitles(drawings: ProjectDrawing[]): { heading: string[]; titles: Map<string, string> } {
  const withLines = drawings.filter((drawing) => drawing.titleLines.length > 0);
  const shared =
    withLines.length >= 2
      ? withLines[0].titleLines.filter((line) =>
          withLines.every((drawing) => drawing.titleLines.some((other) => other.toLowerCase() === line.toLowerCase()))
        )
      : [];
  const sharedKeys = new Set(shared.map((line) => line.toLowerCase()));
  const titles = new Map<string, string>();
  for (const drawing of drawings) {
    if (drawing.title.trim()) {
      titles.set(drawing.id, drawing.title.trim());
      continue;
    }
    const own = withLines.length >= 2 ? drawing.titleLines.filter((line) => !sharedKeys.has(line.toLowerCase())) : [];
    const lines = own.length > 0 ? own : drawing.titleLines.slice(-2);
    titles.set(drawing.id, lines.join(" · "));
  }
  return { heading: shared, titles };
}

/** Normalise a search for matching: trimmed, inner spaces collapsed. */
export function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

/** A character that continues a tag: LP101 is a different tag from LP101-9520. */
const TAG_CHAR = /[a-z0-9_\-./]/i;

/**
 * Where `query` occurs in one text run, case-insensitively, as [start, end)
 * character ranges. With `wholeTag`, a match must not run into more of a tag
 * on either side — "LP101" then finds "GREASE LP101 LOCAL" but not
 * "LP101-9520".
 */
export function matchesIn(text: string, query: string, wholeTag: boolean): Array<[number, number]> {
  const needle = normaliseQuery(query).toLowerCase();
  if (!needle) return [];
  const hay = text.toLowerCase();
  const found: Array<[number, number]> = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
    const end = at + needle.length;
    if (wholeTag) {
      const before = at > 0 ? text[at - 1] : "";
      const after = end < text.length ? text[end] : "";
      // "-" and "." at a tag's edge are punctuation, not more of the tag,
      // only when they end the run or a space follows.
      const continuesBefore = before !== "" && TAG_CHAR.test(before) && TAG_CHAR.test(needle[0]);
      const continuesAfter =
        after !== "" &&
        TAG_CHAR.test(after) &&
        TAG_CHAR.test(needle[needle.length - 1]) &&
        !(/[-./]/.test(after) && (end + 1 >= text.length || /\s/.test(text[end + 1])));
      if (continuesBefore || continuesAfter) continue;
    }
    found.push([at, end]);
  }
  return found;
}

export interface DrawingHit {
  drawing: ProjectDrawing;
  count: number;
  /** The first matching run, cut down around the match. */
  snippet: { before: string; match: string; after: string } | null;
}

const SNIPPET_SIDE = 40;

/** Every drawing with the query in it, most matches first, then by number. */
export function searchDrawings(drawings: ProjectDrawing[], query: string, wholeTag: boolean): DrawingHit[] {
  if (!normaliseQuery(query)) return [];
  const hits: DrawingHit[] = [];
  for (const drawing of drawings) {
    let count = 0;
    let snippet: DrawingHit["snippet"] = null;
    for (const page of drawing.pages) {
      for (const run of page.split("\n")) {
        const found = matchesIn(run, query, wholeTag);
        if (found.length === 0) continue;
        count += found.length;
        if (!snippet) {
          const [start, end] = found[0];
          snippet = {
            before: (start > SNIPPET_SIDE ? "…" : "") + run.slice(Math.max(0, start - SNIPPET_SIDE), start),
            match: run.slice(start, end),
            after: run.slice(end, end + SNIPPET_SIDE) + (end + SNIPPET_SIDE < run.length ? "…" : ""),
          };
        }
      }
    }
    if (count > 0) hits.push({ drawing, count, snippet });
  }
  return hits.sort((a, b) => b.count - a.count || compareDrawingNumbers(a.drawing.number, b.drawing.number));
}

/** Letters to A, digits to 9: K100-E-08056 → A999-A-99999. */
function numberShape(number: string): string {
  return number.toUpperCase().replace(/[A-Z]/g, "A").replace(/\d/g, "9");
}

const DRAWING_REF = /(?<![A-Z0-9-])[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,6}){1,3}(?![A-Z0-9-])/gi;

/**
 * Drawing numbers the sheets mention that are not in the register — the cable
 * schedules and reference tables point at the rest of the set. Only numbers
 * shaped like ones already uploaded count, so equipment tags (M101C-W116,
 * LP101-9520) never pass for drawings.
 */
export function referencedDrawings(drawings: ProjectDrawing[]): string[] {
  const shapes = new Set(drawings.map((drawing) => numberShape(drawing.number)).filter((shape) => shape.includes("-")));
  if (shapes.size === 0) return [];
  const have = new Set(drawings.map((drawing) => drawing.number.toUpperCase()));
  const found = new Set<string>();
  for (const drawing of drawings) {
    for (const page of drawing.pages) {
      for (const match of page.matchAll(DRAWING_REF)) {
        const ref = match[0].toUpperCase();
        if (!have.has(ref) && shapes.has(numberShape(ref))) found.add(ref);
      }
    }
  }
  return [...found].sort(compareDrawingNumbers);
}
