/**
 * Markups on a project's drawings — what QA/QC found wrong, and redlines to send on.
 *
 * A markup is a group of shapes on one sheet with a note: an ISSUE is a
 * problem someone else has to fix (open → sent → fixed); a REDLINE is a
 * marked-up sheet passed on to whoever needs it (open → sent). Neither touches
 * the drawing itself — the stored PDF stays as issued, and the shapes are
 * drawn over it, or burned into a copy only when one is sent.
 *
 * Shapes are kept in page fractions (0–1 from the top-left), so they sit in
 * the same place at every zoom and in the exported PDF.
 *
 * Pure and free of relative imports so `node --test` can load it directly.
 */

export type MarkupKind = "issue" | "redline";
export type MarkupStatus = "open" | "sent" | "fixed";

/**
 * Red for what's wrong, blue for commissioning — the two inks the title
 * blocks ask for — and yellow for a highlight.
 */
export type InkColour = "red" | "blue" | "yellow";

export const INK: Record<InkColour, { label: string; hex: string; rgb: [number, number, number] }> = {
  red: { label: "Red", hex: "#dc2626", rgb: [0.86, 0.15, 0.15] },
  blue: { label: "Blue", hex: "#2563eb", rgb: [0.15, 0.39, 0.92] },
  yellow: { label: "Yellow", hex: "#facc15", rgb: [0.98, 0.8, 0.08] },
};

export type Point = [number, number];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type MarkupShape =
  /** Freehand: the redline pen, or the highlighter pen when yellow. */
  | { type: "pen"; colour: InkColour; points: Point[] }
  /** Boxes snapped over text runs — "highlight text". */
  | { type: "highlight"; colour: InkColour; rects: Rect[] }
  | { type: "line" | "arrow" | "box" | "cloud"; colour: InkColour; from: Point; to: Point }
  /** `size` scales the text from `TEXT_SIZE` (1 when missing). */
  | { type: "text"; colour: InkColour; at: Point; text: string; size?: number }
  /** A note in a white box, with an arrow from the box to what it's about (`tip`). */
  | { type: "callout"; colour: InkColour; rect: Rect; tip: Point; text: string; size?: number };

export type MarkupTool = MarkupShape["type"];

export interface MarkupSend {
  at: string;
  by: string;
  to: string[];
  /** The stored copy that went, when one was kept; "" when it was only attached. */
  fileUrl: string;
}

export interface DrawingMarkup {
  id: string;
  projectId: string;
  drawingId: string;
  /** Copied from the drawing, so the issue still reads right if it is replaced. */
  drawingNumber: string;
  drawingRevision: string;
  page: number;
  kind: MarkupKind;
  /** Issue number on the project: #1, #2 … — what the team writes back about. */
  number: number;
  title: string;
  comment: string;
  status: MarkupStatus;
  shapes: MarkupShape[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sends: MarkupSend[];
  fixedAt: string;
  fixedBy: string;
}

export const KIND_LABEL: Record<MarkupKind, string> = { issue: "Issue", redline: "Redline" };
export const STATUS_LABEL: Record<MarkupStatus, string> = { open: "Open", sent: "Sent", fixed: "Fixed" };

/** What's still waiting on someone: an open or sent issue, an unsent redline. */
export function isOutstanding(markup: Pick<DrawingMarkup, "kind" | "status">): boolean {
  return markup.kind === "issue" ? markup.status !== "fixed" : markup.status === "open";
}

/** The next issue number on a project — one series for issues and redlines. */
export function nextMarkupNumber(markups: Pick<DrawingMarkup, "number">[]): number {
  return markups.reduce((high, markup) => Math.max(high, markup.number), 0) + 1;
}

/**
 * A new open markup on a drawing, numbered after the project's others — made the
 * same way from the Drawings tab and from a point-to-point sheet.
 */
export function createMarkup(input: {
  drawing: { id: string; projectId: string; number: string; revision: string };
  page: number;
  shapes: MarkupShape[];
  details: Pick<DrawingMarkup, "kind" | "title" | "comment">;
  existing: Pick<DrawingMarkup, "number">[];
  by: string;
  id: string;
  now: string;
}): DrawingMarkup {
  return {
    id: input.id,
    projectId: input.drawing.projectId,
    drawingId: input.drawing.id,
    drawingNumber: input.drawing.number,
    drawingRevision: input.drawing.revision,
    page: input.page,
    kind: input.details.kind,
    number: nextMarkupNumber(input.existing),
    title: input.details.title,
    comment: input.details.comment,
    status: "open",
    shapes: input.shapes,
    createdBy: input.by,
    createdAt: input.now,
    updatedAt: input.now,
    sends: [],
    fixedAt: "",
    fixedBy: "",
  };
}

/** The status a markup moves to once sent: a fixed issue stays fixed. */
export function statusAfterSend(markup: Pick<DrawingMarkup, "status">): MarkupStatus {
  return markup.status === "fixed" ? "fixed" : "sent";
}

/** In issue-number order. */
export function sortMarkups<T extends Pick<DrawingMarkup, "number">>(markups: T[]): T[] {
  return [...markups].sort((a, b) => a.number - b.number);
}

/** The box around every shape in a markup, in page fractions. Null when it has none. */
export function markupBounds(shapes: MarkupShape[], aspect: number): Rect | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = ([x, y]: Point) => {
    xs.push(x);
    ys.push(y);
  };
  for (const shape of shapes) {
    if (shape.type === "pen") shape.points.forEach(add);
    else if (shape.type === "highlight")
      for (const rect of shape.rects) {
        add([rect.left, rect.top]);
        add([rect.left + rect.width, rect.top + rect.height]);
      }
    else if (shape.type === "callout") {
      add([shape.rect.left, shape.rect.top]);
      add([shape.rect.left + shape.rect.width, shape.rect.top + shape.rect.height]);
      add(shape.tip);
    } else if (shape.type === "text") {
      const box = textBox(shape, aspect);
      add([box.left, box.top]);
      add([box.left + box.width, box.top + box.height]);
    } else {
      add(shape.from);
      add(shape.to);
    }
  }
  if (xs.length === 0) return null;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** A box grown by `by` of the page each way and kept on the page. */
export function padRect(rect: Rect, by: number, aspect: number): Rect {
  const padY = by * aspect;
  const left = Math.max(0, rect.left - by);
  const top = Math.max(0, rect.top - padY);
  return {
    left,
    top,
    width: Math.min(1, rect.left + rect.width + by) - left,
    height: Math.min(1, rect.top + rect.height + padY) - top,
  };
}

/** Text size on the sheet, as a fraction of the page's width. */
export const TEXT_SIZE = 0.005;
/** How far text (or a callout's text) can be shrunk or grown from `TEXT_SIZE`. */
export const TEXT_SCALE: [number, number] = [0.5, 8];

/** A text's or callout's text size, as a fraction of the page's width. */
export function textSize(shape: { size?: number }): number {
  return TEXT_SIZE * (shape.size ?? 1);
}

/**
 * The box a text takes on the sheet, in page fractions: right and down from
 * where it was put, as wide as its longest line (Helvetica averages a little
 * over half its size a character) and a line high for each line.
 */
export function textBox(shape: { at: Point; text: string; size?: number }, aspect: number): Rect {
  const size = textSize(shape);
  const lines = shape.text.split("\n");
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return {
    left: shape.at[0],
    top: shape.at[1],
    width: Math.min(1 - shape.at[0], longest * size * 0.56),
    height: Math.min(1 - shape.at[1], (lines.length * 1.2 + 0.1) * size * aspect),
  };
}

/** Room inside a callout's box round its text, as a fraction of the page's width. */
export const CALLOUT_PAD = 0.002;
/** A new callout's box, in page widths across and down. */
export const CALLOUT_SIZE: [number, number] = [0.12, 0.03];
/** A callout's box never shrinks smaller than this, in page widths. */
export const CALLOUT_MIN = 0.012;

/** The least room between a callout's box and its tip, in page widths — enough for the arrow to show. */
export const CALLOUT_GAP = 0.02;

/**
 * A callout's box placed for an arrow from `tip` to `to`: beside `to`, on the
 * side away from the tip, so the arrow runs into the box's near edge. A tap
 * (or a drag too short for an arrow) puts the box up and to the right of the
 * tip. Kept on the page, and always clear of the tip by `CALLOUT_GAP` — where
 * the page's edge would push it over the tip, it goes the other side — so
 * there is always an arrow to see.
 */
export function calloutRect(tip: Point, to: Point, aspect: number): Rect {
  const [w, h] = CALLOUT_SIZE;
  const height = h * aspect;
  const gapY = CALLOUT_GAP * aspect;
  const far = Math.hypot(to[0] - tip[0], (to[1] - tip[1]) / aspect) >= CALLOUT_GAP;
  const end: Point = far ? to : [tip[0] + CALLOUT_GAP * 1.5, tip[1] - CALLOUT_GAP * 1.5 * aspect];
  const onPage = (left: number, top: number): Rect => ({
    left: Math.min(1 - w, Math.max(0, left)),
    top: Math.min(1 - height, Math.max(0, top)),
    width: w,
    height,
  });
  /** Clear of the tip, the gap and all. */
  const clear = (rect: Rect) =>
    tip[0] <= rect.left - CALLOUT_GAP ||
    tip[0] >= rect.left + rect.width + CALLOUT_GAP ||
    tip[1] <= rect.top - gapY ||
    tip[1] >= rect.top + rect.height + gapY;
  const rightward = end[0] >= tip[0];
  const wanted = onPage(rightward ? Math.max(end[0], tip[0] + CALLOUT_GAP) : Math.min(end[0] - w, tip[0] - CALLOUT_GAP - w), end[1] - height / 2);
  if (clear(wanted)) return wanted;
  // Pushed back over the tip by the page's edge: try the other side, then above and below.
  const tries = [
    onPage(rightward ? tip[0] - CALLOUT_GAP - w : tip[0] + CALLOUT_GAP, end[1] - height / 2),
    onPage(tip[0] - w / 2, tip[1] - gapY - height),
    onPage(tip[0] - w / 2, tip[1] + gapY),
  ];
  return tries.find(clear) ?? wanted;
}

/**
 * Where a callout's arrow leaves its box: the point on the box's edge on the
 * way from its middle to the tip. Null when the tip is inside the box — no
 * arrow then.
 */
export function calloutStart(rect: Rect, tip: Point, aspect: number): Point | null {
  // Square units, so the edge is found along the line as drawn.
  const cx = rect.left + rect.width / 2;
  const cy = (rect.top + rect.height / 2) / aspect;
  const dx = tip[0] - cx;
  const dy = tip[1] / aspect - cy;
  const halfW = rect.width / 2;
  const halfH = rect.height / aspect / 2;
  if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) return null;
  const t = Math.min(dx === 0 ? Infinity : halfW / Math.abs(dx), dy === 0 ? Infinity : halfH / Math.abs(dy));
  return [cx + dx * t, (cy + dy * t) * aspect];
}

/** Pen width, as a fraction of the page's width. */
export const STROKE = 0.0009;
/** Highlighter pen width. */
export const HIGHLIGHTER = 0.006;

/**
 * A revision cloud around the box from `from` to `to`, as a closed run of
 * points in page fractions: scallops along each side, sized to the box (a
 * third of its short side, kept between 0.3% and 0.8% of the sheet's width).
 * Each is a half-circle bulging outwards, made of a few points so it can be
 * drawn as plain lines anywhere.
 */
export function cloudPoints(from: Point, to: Point, aspect: number, scallop?: number): Point[] {
  // Work in square units, where a half-circle is round.
  const x0 = Math.min(from[0], to[0]);
  const x1 = Math.max(from[0], to[0]);
  const y0 = Math.min(from[1], to[1]) / aspect;
  const y1 = Math.max(from[1], to[1]) / aspect;
  const corners: Point[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const size = scallop ?? Math.min(0.008, Math.max(0.003, Math.min(x1 - x0, y1 - y0) / 3));
  const out: Point[] = [];
  for (let side = 0; side < 4; side += 1) {
    const [ax, ay] = corners[side];
    const [bx, by] = corners[(side + 1) % 4];
    const length = Math.hypot(bx - ax, by - ay);
    const count = Math.max(1, Math.round(length / size));
    const dx = (bx - ax) / count;
    const dy = (by - ay) / count;
    const step = Math.hypot(dx, dy) || 1e-9;
    // Outward normal for a box walked clockwise on screen (y down).
    const nx = dy / step;
    const ny = -dx / step;
    for (let i = 0; i < count; i += 1) {
      const sx = ax + dx * i;
      const sy = ay + dy * i;
      for (let k = 0; k <= 6; k += 1) {
        const t = k / 6;
        const bulge = Math.sin(Math.PI * t) * (step / 2);
        out.push([sx + dx * t + nx * bulge, sy + dy * t + ny * bulge]);
      }
    }
  }
  return out.map(([x, y]) => [x, y * aspect]);
}

/** The two short strokes of an arrowhead at `to`, in page fractions. */
export function arrowHead(from: Point, to: Point, aspect: number, size = 0.006): [Point, Point] {
  const dx = to[0] - from[0];
  const dy = (to[1] - from[1]) / aspect;
  const angle = Math.atan2(dy, dx);
  const wing = (offset: number): Point => [
    to[0] - size * Math.cos(angle + offset),
    to[1] - size * Math.sin(angle + offset) * aspect,
  ];
  return [wing(Math.PI / 7), wing(-Math.PI / 7)];
}

export interface Recipient {
  email: string;
  name: string;
}

/**
 * Addresses markups have gone to, kept so nobody types them twice: the ones
 * just used go to the front, duplicates (by address) are dropped, and the
 * list is capped.
 */
export function rememberRecipients(known: Recipient[], used: Recipient[], cap = 60): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const person of [...used, ...known]) {
    const email = person.email.trim();
    const key = email.toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(key)) continue;
    seen.add(key);
    // A name learnt later is kept even when this send only had the address.
    const name = person.name.trim() || known.find((k) => k.email.trim().toLowerCase() === key)?.name.trim() || "";
    out.push({ email, name });
  }
  return out.slice(0, cap);
}

/** The email for a set of markups: subject and note, ready to edit. */
export function markupEmail(input: {
  projectNumber: string;
  projectName: string;
  markups: Pick<DrawingMarkup, "kind" | "number" | "title" | "comment" | "drawingNumber" | "drawingRevision">[];
}): { subject: string; note: string } {
  const { markups } = input;
  const issues = markups.filter((markup) => markup.kind === "issue").length;
  const what =
    issues === markups.length
      ? issues === 1
        ? "Drawing issue"
        : `${issues} drawing issues`
      : issues === 0
        ? markups.length === 1
          ? "Redline markup"
          : `${markups.length} redline markups`
        : `${markups.length} drawing markups`;
  const drawings = [...new Set(markups.map((markup) => markup.drawingNumber))];
  const about =
    markups.length === 1
      ? `${markups[0].drawingNumber}${markups[0].drawingRevision ? ` rev ${markups[0].drawingRevision}` : ""} — ${markups[0].title}`
      : drawings.join(", ");
  const subject = `${input.projectNumber} · ${what}: ${about}`;
  const lines = markups.map((markup) => {
    const head = `#${markup.number} ${KIND_LABEL[markup.kind].toLowerCase()} on ${markup.drawingNumber}${
      markup.drawingRevision ? ` rev ${markup.drawingRevision}` : ""
    }: ${markup.title}`;
    return markup.comment.trim() ? `${head}\n   ${markup.comment.trim().replace(/\n/g, "\n   ")}` : head;
  });
  const ask =
    issues > 0
      ? "Please correct the marked-up items and send back the updated drawing, quoting the issue number."
      : "The marked-up drawing is attached.";
  const note = `Hi,\n\n${ask}\n\n${lines.join("\n\n")}\n\nJob ${input.projectNumber}${input.projectName ? ` — ${input.projectName}` : ""}.`;
  return { subject, note };
}

/** "K100-E-08056_17 MARKUP #3.pdf" — the copy that goes out. */
export function markupFileName(drawingFileName: string, numbers: number[]): string {
  const base = drawingFileName.replace(/\.pdf$/i, "").trim() || "Drawing";
  const tags = [...numbers].sort((a, b) => a - b).map((n) => `#${n}`).join(" ");
  return `${base} MARKUP ${tags}.pdf`;
}

/**
 * How a shape is drawn, in page fractions: the lines it is made of, the boxes
 * it fills, or the text it writes. The screen overlay, the close-up image and
 * the exported PDF all draw from this, so they can't disagree.
 */
export function shapeGeometry(
  shape: MarkupShape,
  aspect: number
):
  | { kind: "lines"; lines: Point[][]; closed: boolean; highlighter: boolean }
  | { kind: "fill"; rects: Rect[] }
  | { kind: "text"; at: Point; text: string; size: number }
  | { kind: "callout"; rect: Rect; text: string; size: number; lines: Point[][] } {
  switch (shape.type) {
    case "pen":
      return { kind: "lines", lines: [shape.points], closed: false, highlighter: shape.colour === "yellow" };
    case "highlight":
      return { kind: "fill", rects: shape.rects };
    case "line":
      return { kind: "lines", lines: [[shape.from, shape.to]], closed: false, highlighter: false };
    case "arrow": {
      const [a, b] = arrowHead(shape.from, shape.to, aspect);
      return { kind: "lines", lines: [[shape.from, shape.to], [a, shape.to, b]], closed: false, highlighter: false };
    }
    case "box": {
      const [x0, y0] = shape.from;
      const [x1, y1] = shape.to;
      return { kind: "lines", lines: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], closed: true, highlighter: false };
    }
    case "cloud":
      return { kind: "lines", lines: [cloudPoints(shape.from, shape.to, aspect)], closed: true, highlighter: false };
    case "text":
      return { kind: "text", at: shape.at, text: shape.text, size: textSize(shape) };
    case "callout": {
      const start = calloutStart(shape.rect, shape.tip, aspect);
      const size = textSize(shape);
      if (!start) return { kind: "callout", rect: shape.rect, text: shape.text, size, lines: [] };
      const [a, b] = arrowHead(start, shape.tip, aspect);
      return { kind: "callout", rect: shape.rect, text: shape.text, size, lines: [[start, shape.tip], [a, shape.tip, b]] };
    }
  }
}

/** Freehand points closer than this (of the page width) are dropped as noise. */
export const PEN_STEP = 0.0008;

/**
 * Text broken into lines that fit `width`, as measured by `measure` — words
 * kept whole where they fit, a word too long for a line broken anywhere.
 * The PDF and the close-up both wrap a callout's text this way.
 */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const tried = line ? `${line} ${word}` : word;
      if (measure(tried) <= width || !line) {
        line = tried;
      } else {
        out.push(line);
        line = word;
      }
      // A word wider than the box on its own: break it.
      while (measure(line) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > width) cut -= 1;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

/** A drag too small to be a shape — a tap, not a line. */
export function tooSmall(from: Point, to: Point): boolean {
  return Math.hypot(to[0] - from[0], to[1] - from[1]) < 0.002;
}

/** Every point a shape is placed by, run through `map` — the rest of it kept. */
function mapPoints(shape: MarkupShape, map: (point: Point) => Point): MarkupShape {
  const rect = (r: Rect): Rect => {
    const [left, top] = map([r.left, r.top]);
    const [right, bottom] = map([r.left + r.width, r.top + r.height]);
    return { left, top, width: right - left, height: bottom - top };
  };
  switch (shape.type) {
    case "pen":
      return { ...shape, points: shape.points.map(map) };
    case "highlight":
      return { ...shape, rects: shape.rects.map(rect) };
    case "text":
      return { ...shape, at: map(shape.at) };
    case "callout":
      return { ...shape, rect: rect(shape.rect), tip: map(shape.tip) };
    default:
      return { ...shape, from: map(shape.from), to: map(shape.to) };
  }
}

/** A shape moved by `dx`, `dy` of the page — no further than keeps all of it on the page. */
export function moveShape<T extends MarkupShape>(shape: T, dx: number, dy: number, aspect: number): T {
  const bounds = markupBounds([shape], aspect);
  if (!bounds) return shape;
  const x = Math.min(1 - bounds.left - bounds.width, Math.max(-bounds.left, dx));
  const y = Math.min(1 - bounds.top - bounds.height, Math.max(-bounds.top, dy));
  return mapPoints(shape, ([px, py]) => [px + x, py + y]) as T;
}

/**
 * A shape stretched from the box `from` to the box `to` (its bounds, and where
 * they are dragged to). Text keeps its shape and grows or shrinks with the
 * box's width; a callout's text keeps its size while its box is resized.
 */
export function scaleShape<T extends MarkupShape>(shape: T, from: Rect, to: Rect): T {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  if (shape.type === "text") {
    const [lo, hi] = TEXT_SCALE;
    return { ...shape, at: [to.left, to.top], size: Math.min(hi, Math.max(lo, (shape.size ?? 1) * sx)) };
  }
  return mapPoints(shape, ([x, y]) => [to.left + (x - from.left) * sx, to.top + (y - from.top) * sy]) as T;
}

/** Distance from `p` to the segment `a`–`b`, in page widths. */
function toSegment(p: Point, a: Point, b: Point, aspect: number): number {
  const [px, py] = [p[0], p[1] / aspect];
  const [ax, ay] = [a[0], a[1] / aspect];
  const [bx, by] = [b[0], b[1] / aspect];
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Whether a tap at `point` picks up `shape`, `reach` page widths either side
 * of it allowed (a fingertip's worth). Boxes, clouds, text, callouts and
 * highlights are picked up anywhere inside; lines and pen strokes along them.
 */
export function shapeHit(shape: MarkupShape, point: Point, reach: number, aspect: number): boolean {
  const inside = (rect: Rect) =>
    point[0] >= rect.left - reach &&
    point[0] <= rect.left + rect.width + reach &&
    point[1] >= rect.top - reach * aspect &&
    point[1] <= rect.top + rect.height + reach * aspect;
  const near = (line: Point[]) => line.some((a, i) => i > 0 && toSegment(point, line[i - 1], a, aspect) <= reach) || (line.length === 1 && toSegment(point, line[0], line[0], aspect) <= reach);
  switch (shape.type) {
    case "pen":
      return near(shape.points);
    case "line":
      return near([shape.from, shape.to]);
    case "highlight":
      return shape.rects.some(inside);
    case "text":
      return inside(textBox(shape, aspect));
    case "callout":
      return inside(shape.rect) || near([calloutStart(shape.rect, shape.tip, aspect) ?? shape.tip, shape.tip]);
    case "arrow":
      return near([shape.from, shape.to]);
    default: {
      const bounds = markupBounds([shape], aspect);
      return bounds ? inside(bounds) : false;
    }
  }
}
