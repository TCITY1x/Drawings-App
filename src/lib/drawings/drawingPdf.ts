import { loadPdfjs } from "@/lib/drawings/pdfjsLoader";
import { matchesIn, titleBlockLines, type PlacedText } from "@/lib/drawings/drawings";

/**
 * Reading a drawing PDF with pdf.js: its text when it is added, and where a
 * search's matches sit on a page when it is viewed.
 *
 * Both go through `pageRuns`, so the runs a search counted at upload are the
 * runs the viewer matches again to place its boxes.
 */

type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
export type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type Viewport = ReturnType<PdfPage["getViewport"]>;

/** One run of text on a page, as pdf.js placed it. */
export interface TextRun {
  str: string;
  /** Text space to PDF user space: [a, b, c, d, e, f]. */
  transform: number[];
  /** Advance along the baseline, in user space. */
  width: number;
}

/** A page's non-blank text runs. A newline never appears inside one. */
export async function pageRuns(page: PdfPage): Promise<TextRun[]> {
  const content = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const str = item.str.replace(/\s+/g, " ");
    if (!str.trim()) continue;
    runs.push({ str, transform: item.transform as number[], width: item.width });
  }
  return runs;
}

export async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: bytes }).promise;
}

/** Every page's text, plus page 1's title block. */
export async function readDrawingPdf(bytes: Uint8Array): Promise<{ pages: string[]; titleLines: string[] }> {
  const pdf = await openPdf(bytes);
  try {
    const pages: string[] = [];
    let titleLines: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const runs = await pageRuns(page);
      pages.push(runs.map((run) => run.str).join("\n"));
      if (number === 1) titleLines = titleBlockLines(placeRuns(runs, page.getViewport({ scale: 1 })));
    }
    return { pages, titleLines };
  } finally {
    void pdf.loadingTask.destroy();
  }
}

/** Runs as page fractions with size and angle, for the title block reading. */
function placeRuns(runs: TextRun[], viewport: Viewport): PlacedText[] {
  return runs.map((run) => {
    const [a, b, c, d, e, f] = run.transform;
    const [x, y] = viewport.convertToViewportPoint(e, f);
    return {
      str: run.str,
      x: x / viewport.width,
      y: y / viewport.height,
      height: Math.hypot(c, d),
      rotation: (Math.atan2(b, a) * 180) / Math.PI - viewport.rotation,
    };
  });
}

/** A highlight, in fractions of the rendered page (top-left origin). */
export interface MatchBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where `query` sits on a page: one box per match, in reading order.
 *
 * A run only says where it starts, which way it reads and how far it runs, so
 * a match inside it is placed by its share of the characters — close on the
 * single-stroke CAD fonts drawings use. Rotated runs (terminal numbers read
 * up the sheet) are handled by walking along the run's own baseline.
 */
export function matchBoxes(runs: TextRun[], viewport: Viewport, query: string, wholeTag: boolean): MatchBox[] {
  const boxes: MatchBox[] = [];
  for (const run of runs) {
    for (const [start, end] of matchesIn(run.str, query, wholeTag)) boxes.push(runBox(run, viewport, start, end));
  }
  return boxes.sort((p, q) => p.top - q.top || p.left - q.left);
}

/** Where characters `start` to `end` of a run sit on the page — the whole run by default. */
export function runBox(run: TextRun, viewport: Viewport, start = 0, end = run.str.length): MatchBox {
  const [a, b, c, d, e, f] = run.transform;
  const along = Math.hypot(a, b) || 1;
  const up = Math.hypot(c, d) || 1;
  const ux = a / along;
  const uy = b / along;
  const vx = c / up;
  const vy = d / up;
  const perChar = run.width / Math.max(run.str.length, 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of [start * perChar, end * perChar]) {
    for (const t of [-0.2 * up, up]) {
      const [px, py] = viewport.convertToViewportPoint(e + ux * s + vx * t, f + uy * s + vy * t);
      xs.push(px);
      ys.push(py);
    }
  }
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    left: left / viewport.width,
    top: top / viewport.height,
    width: (Math.max(...xs) - left) / viewport.width,
    height: (Math.max(...ys) - top) / viewport.height,
  };
}
