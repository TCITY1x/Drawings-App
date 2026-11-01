import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  CALLOUT_PAD,
  HIGHLIGHTER,
  INK,
  KIND_LABEL,
  STROKE,
  markupBounds,
  padRect,
  shapeGeometry,
  sortMarkups,
  type DrawingMarkup,
  type MarkupShape,
  type Point,
  wrapText,
} from "@/lib/drawings/drawingMarkups";
import { openPdf } from "@/lib/drawings/drawingPdf";
import { stripInteractive } from "@/lib/drawings/pdfStrip";

/**
 * Markups out of the app: burned into a copy of the drawing for whoever has
 * to fix them, and a close-up image of each so the email shows the problem
 * without opening anything.
 *
 * The original PDF is never written to — this works on a copy of its bytes.
 */

/** Page fractions (as displayed, top-left origin) to PDF user space, honouring /Rotate. */
export function placer(page: PDFPage) {
  const box = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const toUser = ([fx, fy]: Point): { x: number; y: number } => {
    switch (angle) {
      case 90:
        return { x: box.x + fy * box.width, y: box.y + fx * box.height };
      case 180:
        return { x: box.x + (1 - fx) * box.width, y: box.y + fy * box.height };
      case 270:
        return { x: box.x + (1 - fy) * box.width, y: box.y + (1 - fx) * box.height };
      default:
        return { x: box.x + fx * box.width, y: box.y + (1 - fy) * box.height };
    }
  };
  const sideways = angle === 90 || angle === 270;
  /** The sheet's width as you look at it, in points — sizes are fractions of it. */
  const shownWidth = sideways ? box.height : box.width;
  const aspect = sideways ? box.height / box.width : box.width / box.height;
  return { toUser, shownWidth, aspect, angle };
}

/** Text Helvetica can write; anything else becomes "?" rather than failing the export. */
export function writable(font: PDFFont, text: string): string {
  const known = new Set(font.getCharacterSet());
  return [...text].map((char) => (known.has(char.codePointAt(0) ?? 0) ? char : "?")).join("");
}

function drawShape(page: PDFPage, font: PDFFont, shape: MarkupShape, place: ReturnType<typeof placer>) {
  const [r, g, b] = INK[shape.colour].rgb;
  const color = rgb(r, g, b);
  const geometry = shapeGeometry(shape, place.aspect);
  if (geometry.kind === "fill") {
    for (const rect of geometry.rects) {
      const a = place.toUser([rect.left, rect.top]);
      const c = place.toUser([rect.left + rect.width, rect.top + rect.height]);
      page.drawRectangle({
        x: Math.min(a.x, c.x),
        y: Math.min(a.y, c.y),
        width: Math.abs(c.x - a.x),
        height: Math.abs(c.y - a.y),
        color,
        opacity: 0.4,
      });
    }
    return;
  }
  if (geometry.kind === "text") {
    const size = geometry.size * place.shownWidth;
    // `at` is the top-left of the text, so each baseline sits most of a line
    // below the top of its line (in page fractions, a point is aspect/width).
    geometry.text.split("\n").forEach((line, index) => {
      const drop = ((size * (0.85 + index * 1.2)) / place.shownWidth) * place.aspect;
      const baseline = place.toUser([geometry.at[0], geometry.at[1] + drop]);
      page.drawText(writable(font, line), {
        x: baseline.x,
        y: baseline.y,
        size,
        font,
        color,
        rotate: degrees(place.angle),
      });
    });
    return;
  }
  if (geometry.kind === "callout") {
    // White box, outlined in the ink; the text wrapped inside it; the arrow out to the tip.
    const { rect } = geometry;
    const a = place.toUser([rect.left, rect.top]);
    const c = place.toUser([rect.left + rect.width, rect.top + rect.height]);
    page.drawRectangle({
      x: Math.min(a.x, c.x),
      y: Math.min(a.y, c.y),
      width: Math.abs(c.x - a.x),
      height: Math.abs(c.y - a.y),
      color: rgb(1, 1, 1),
      borderColor: color,
      borderWidth: STROKE * place.shownWidth,
    });
    const size = geometry.size * place.shownWidth;
    const room = (rect.width - 2 * CALLOUT_PAD) * place.shownWidth;
    const lines = wrapText(writable(font, geometry.text), room, (text) => font.widthOfTextAtSize(text, size));
    lines.forEach((line, index) => {
      const drop = CALLOUT_PAD * place.aspect + ((size * (0.85 + index * 1.2)) / place.shownWidth) * place.aspect;
      const baseline = place.toUser([rect.left + CALLOUT_PAD, rect.top + drop]);
      page.drawText(line, { x: baseline.x, y: baseline.y, size, font, color, rotate: degrees(place.angle) });
    });
    for (const line of geometry.lines) {
      for (let i = 1; i < line.length; i += 1) {
        page.drawLine({ start: place.toUser(line[i - 1]), end: place.toUser(line[i]), thickness: STROKE * place.shownWidth, color });
      }
    }
    return;
  }
  const thickness = (geometry.highlighter ? HIGHLIGHTER : STROKE) * place.shownWidth;
  for (const line of geometry.lines) {
    const points = geometry.closed ? [...line, line[0]] : line;
    for (let i = 1; i < points.length; i += 1) {
      page.drawLine({
        start: place.toUser(points[i - 1]),
        end: place.toUser(points[i]),
        thickness,
        color,
        opacity: geometry.highlighter ? 0.4 : 1,
      });
    }
  }
}

/** The markup's number in a red disc by its top-left corner, as the email refers to it. */
function drawTag(page: PDFPage, font: PDFFont, markup: DrawingMarkup, place: ReturnType<typeof placer>) {
  const bounds = markupBounds(markup.shapes, place.aspect);
  if (!bounds) return;
  const radius = 0.0055 * place.shownWidth;
  const centre = place.toUser([
    Math.max(0.007, bounds.left - 0.007),
    Math.max(0.007 * place.aspect, bounds.top - 0.007 * place.aspect),
  ]);
  page.drawCircle({ x: centre.x, y: centre.y, size: radius, color: rgb(0.86, 0.15, 0.15) });
  const label = `${markup.number}`;
  const size = radius * 1.1;
  page.drawText(label, {
    x: centre.x - font.widthOfTextAtSize(label, size) / 2,
    y: centre.y - size * 0.36,
    size,
    font,
    color: rgb(1, 1, 1),
  });
}

/** Wrap `text` to `width` points at `size`. */
export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * A copy of the drawing with `markups` drawn on it, numbered, and a last page
 * listing each one — number, kind, title, note, who raised it and when.
 */
export async function markedUpPdf(input: {
  bytes: Uint8Array;
  markups: DrawingMarkup[];
  /** "" when it isn't known — the list's heading then starts at the drawing. */
  projectNumber: string;
  drawingLabel: string;
}): Promise<Blob> {
  const doc = await PDFDocument.load(input.bytes, { ignoreEncryption: true });
  stripInteractive(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const markups = sortMarkups(input.markups);
  for (const markup of markups) {
    const page = pages[markup.page - 1];
    if (!page) continue;
    const place = placer(page);
    for (const shape of markup.shapes) drawShape(page, font, shape, place);
    drawTag(page, bold, markup, place);
  }

  // The list of what was marked, on an A4 landscape page of its own.
  const width = 842;
  const height = 595;
  let sheet = doc.addPage([width, height]);
  let y = height - 50;
  sheet.drawText(writable(bold, `${input.projectNumber ? `${input.projectNumber} · ` : ""}Markups on ${input.drawingLabel}`), { x: 40, y, size: 15, font: bold });
  y -= 28;
  for (const markup of markups) {
    const head = `#${markup.number}  ${KIND_LABEL[markup.kind]} — ${markup.title || "Untitled"}`;
    const meta = `Page ${markup.page} · raised by ${markup.createdBy || "—"} on ${markup.createdAt.slice(0, 10)}`;
    const body = wrap(font, writable(font, markup.comment.trim()), 10, width - 100);
    const needed = 18 + 14 + body.length * 13 + 14;
    if (y - needed < 40) {
      sheet = doc.addPage([width, height]);
      y = height - 50;
    }
    sheet.drawText(writable(bold, head), { x: 40, y, size: 12, font: bold, color: rgb(0.6, 0.1, 0.1) });
    y -= 15;
    sheet.drawText(writable(font, meta), { x: 40, y, size: 9, font, color: rgb(0.35, 0.35, 0.4) });
    y -= 14;
    for (const line of body.filter((l) => l.trim())) {
      sheet.drawText(line, { x: 52, y, size: 10, font });
      y -= 13;
    }
    y -= 12;
  }

  const saved = await doc.save();
  return new Blob([saved as BlobPart], { type: "application/pdf" });
}

/**
 * Draw `shapes` onto a 2D context whose page fractions map through `toPx`.
 * Pen lines are never thinner than `minLine` pixels — the magnifier asks
 * for that so a fine line stays clear; the close-up keeps them true to the sheet.
 */
export function paintShapes(
  context: CanvasRenderingContext2D,
  shapes: MarkupShape[],
  aspect: number,
  pageWidthPx: number,
  toPx: (point: Point) => [number, number],
  minLine = 0
) {
  for (const shape of shapes) {
    const geometry = shapeGeometry(shape, aspect);
    context.save();
    context.strokeStyle = context.fillStyle = INK[shape.colour].hex;
    if (geometry.kind === "fill") {
      context.globalAlpha = 0.4;
      for (const rect of geometry.rects) {
        const [x, y] = toPx([rect.left, rect.top]);
        const [x2, y2] = toPx([rect.left + rect.width, rect.top + rect.height]);
        context.fillRect(x, y, x2 - x, y2 - y);
      }
    } else if (geometry.kind === "text") {
      const size = geometry.size * pageWidthPx;
      context.font = `${size}px Helvetica, Arial, sans-serif`;
      context.textBaseline = "top";
      const [x, y] = toPx(geometry.at);
      geometry.text.split("\n").forEach((line, index) => context.fillText(line, x, y + index * size * 1.2));
    } else if (geometry.kind === "callout") {
      const { rect } = geometry;
      const [x, y] = toPx([rect.left, rect.top]);
      const [x2, y2] = toPx([rect.left + rect.width, rect.top + rect.height]);
      context.lineWidth = Math.max(minLine, STROKE * pageWidthPx);
      context.lineJoin = context.lineCap = "round";
      context.fillStyle = "#ffffff";
      context.fillRect(x, y, x2 - x, y2 - y);
      context.strokeRect(x, y, x2 - x, y2 - y);
      context.fillStyle = INK[shape.colour].hex;
      const size = geometry.size * pageWidthPx;
      const pad = CALLOUT_PAD * pageWidthPx;
      context.font = `${size}px Helvetica, Arial, sans-serif`;
      context.textBaseline = "top";
      wrapText(geometry.text, x2 - x - 2 * pad, (text) => context.measureText(text).width).forEach((line, index) =>
        context.fillText(line, x + pad, y + pad + index * size * 1.2)
      );
      for (const line of geometry.lines) {
        context.beginPath();
        line.forEach((point, index) => {
          const [px, py] = toPx(point);
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        });
        context.stroke();
      }
    } else {
      context.globalAlpha = geometry.highlighter ? 0.4 : 1;
      context.lineWidth = Math.max(minLine, (geometry.highlighter ? HIGHLIGHTER : STROKE) * pageWidthPx);
      context.lineJoin = context.lineCap = "round";
      for (const line of geometry.lines) {
        context.beginPath();
        line.forEach((point, index) => {
          const [x, y] = toPx(point);
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        if (geometry.closed) context.closePath();
        context.stroke();
      }
    }
    context.restore();
  }
}

/** Longest edge of a close-up, in pixels. */
const CLOSE_UP_EDGE = 1400;

/**
 * The marked part of the sheet as a PNG: the markup's bounds with room around
 * them, drawn sharp enough to read, the markup painted over it. Only that
 * part of the page is rendered, so an A0 sheet doesn't need a giant canvas.
 */
export async function closeUpPng(bytes: Uint8Array, markup: DrawingMarkup): Promise<Blob | null> {
  const pdf = await openPdf(bytes);
  try {
    const page = await pdf.getPage(markup.page);
    const natural = page.getViewport({ scale: 1 });
    const aspect = natural.width / natural.height;
    const bounds = markupBounds(markup.shapes, aspect);
    if (!bounds) return null;
    // At least a tenth of the sheet, so a small mark keeps some context.
    const grown = padRect(bounds, Math.max(0.02, (0.1 - bounds.width) / 2), aspect);
    const regionW = grown.width * natural.width;
    const regionH = grown.height * natural.height;
    const scale = Math.min(CLOSE_UP_EDGE / Math.max(regionW, regionH), 6);
    const viewport = page.getViewport({
      scale,
      offsetX: -grown.left * natural.width * scale,
      offsetY: -grown.top * natural.height * scale,
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(regionW * scale));
    canvas.height = Math.max(1, Math.round(regionH * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const pageWidthPx = natural.width * scale;
    paintShapes(context, markup.shapes, aspect, pageWidthPx, ([x, y]) => [
      (x - grown.left) * pageWidthPx,
      (y - grown.top) * natural.height * scale,
    ]);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    void pdf.loadingTask.destroy();
  }
}
