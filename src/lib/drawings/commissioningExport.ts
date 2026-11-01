import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import {
  CHECK_INK,
  DEFAULT_STAMP_AT,
  STAMP_RATIO,
  STAMP_WIDTH,
  criteriaLines,
  findAsBuiltBox,
  hatchLines,
  packageProgress,
  pointProgress,
  resultLabel,
  scopedPoints,
  type CommissioningPackage,
  type PackageSheet,
  type Point,
  type SheetText,
  type Signer,
} from "@/lib/drawings/commissioning";
import { placer, wrap, writable } from "@/lib/drawings/drawingMarkupExport";
import { openPdf, pageRuns, runBox } from "@/lib/drawings/drawingPdf";

/**
 * Commissioning packages out of the app.
 *
 * Each signed sheet is a copy of its drawing with every tested point drawn on
 * it — yellow for verified, red for a fault still open, grey for N/A — and a
 * sign-off stamp in red ink: who tested it, who witnessed it, with what, and
 * their signatures. Where the title block has a "COMMISSIONING AS-BUILT" box,
 * that is filled in too, beside its own labels, in red — as-built ink.
 *
 * The package is one PDF: a cover page saying what's in it and who completed
 * and signed each sheet, the signed sheets in working order, then the test
 * record — every point, its result and reading, who tested it and when.
 *
 * The original PDFs are never written to — this works on copies of their bytes.
 */

/** Red ink — how as-built information goes on a drawing, and so the sign-off. */
const RED = rgb(0.8, 0.11, 0.11);
const INK = rgb(0.1, 0.1, 0.12);
const GREY = rgb(0.38, 0.4, 0.45);
const RULE = rgb(0.8, 0.82, 0.86);

export interface ExportContext {
  projectNumber: string;
  projectName: string;
  clientName: string;
  businessName: string;
  generatedBy: string;
}

function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function embedSignature(doc: PDFDocument, signer: Signer | null): Promise<PDFImage | null> {
  const bytes = signer?.signature ? dataUrlBytes(signer.signature) : null;
  if (!bytes) return null;
  try {
    return await doc.embedPng(bytes);
  } catch {
    return null; // A damaged image: the typed name still makes the record.
  }
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

/** Text runs on page 1, boxed in page fractions — for finding the as-built box. */
async function sheetTexts(bytes: Uint8Array): Promise<SheetText[]> {
  const pdf = await openPdf(bytes);
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    return (await pageRuns(page)).map((run) => ({ str: run.str, ...runBox(run, viewport) }));
  } finally {
    void pdf.loadingTask.destroy();
  }
}

type Place = ReturnType<typeof placer>;

/** " · revisions 3, 7" — the triangles a sheet was checked against, when narrowed down. */
function trianglesNote(sheet: Pick<PackageSheet, "triangles">): string {
  return sheet.triangles.length === 0 ? "" : ` · revision${sheet.triangles.length === 1 ? "" : "s"} ${sheet.triangles.join(", ")}`;
}

/**
 * Something laid out in points from a corner of the sheet as you look at it —
 * right and down — whatever /Rotate the page carries.
 */
function local(place: Place, origin: Point) {
  const shownHeight = place.shownWidth / place.aspect;
  const at = (dx: number, dy: number) =>
    place.toUser([origin[0] + dx / place.shownWidth, origin[1] + dy / shownHeight]);
  return {
    at,
    rotate: degrees(place.angle),
    box(page: PDFPage, x: number, y: number, width: number, height: number, options: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; borderWidth?: number }) {
      const a = at(x, y);
      const c = at(x + width, y + height);
      page.drawRectangle({
        x: Math.min(a.x, c.x),
        y: Math.min(a.y, c.y),
        width: Math.abs(c.x - a.x),
        height: Math.abs(c.y - a.y),
        color: options.fill,
        borderColor: options.border,
        borderWidth: options.border ? options.borderWidth ?? 1 : 0,
      });
    },
    text(page: PDFPage, font: PDFFont, text: string, x: number, baseline: number, size: number, color = RED) {
      const p = at(x, baseline);
      page.drawText(writable(font, text), { x: p.x, y: p.y, size, font, color, rotate: degrees(place.angle) });
    },
    image(page: PDFPage, image: PDFImage, x: number, y: number, maxWidth: number, height: number) {
      const width = Math.min(maxWidth, (image.width / image.height) * height);
      const drawnHeight = (image.height / image.width) * width;
      // pdf-lib anchors an image at its bottom-left as drawn.
      const p = at(x, y + drawnHeight);
      page.drawImage(image, { x: p.x, y: p.y, width, height: drawnHeight, rotate: degrees(place.angle) });
    },
  };
}

/** The points on a page, coloured by result. Untested points aren't drawn. */
function drawPoints(page: PDFPage, sheet: PackageSheet, pageNumber: number) {
  const place = placer(page);
  // Only this project's points: another project's clouds are left as they are.
  for (const point of scopedPoints(sheet)) {
    if (point.page !== pageNumber || point.status === "pending") continue;
    const ink = CHECK_INK[point.status];
    const color = rgb(...ink.rgb);
    if (point.shape.type === "area") {
      const { left, top, width, height } = point.shape.rect;
      const a = place.toUser([left, top]);
      const c = place.toUser([left + width, top + height]);
      page.drawRectangle({
        x: Math.min(a.x, c.x),
        y: Math.min(a.y, c.y),
        width: Math.abs(c.x - a.x),
        height: Math.abs(c.y - a.y),
        color,
        opacity: point.removal ? ink.opacity * 0.5 : ink.opacity,
      });
      // A hatched cloud — to be removed — is hatched, as it was drawn.
      if (point.removal) {
        const hatch = point.status === "pass" ? rgb(0.63, 0.38, 0.03) : color;
        for (const [from, to] of hatchLines(point.shape.rect, place.aspect)) {
          page.drawLine({ start: place.toUser(from), end: place.toUser(to), thickness: 0.0009 * place.shownWidth, color: hatch, opacity: 0.85 });
        }
      }
    } else {
      for (const [from, to] of point.shape.segments) {
        page.drawLine({
          start: place.toUser(from),
          end: place.toUser(to),
          thickness: 0.006 * place.shownWidth,
          color,
          opacity: ink.opacity,
          lineCap: LineCapStyle.Round,
        });
      }
    }
    // A fault put right: ringed in red where it starts, as it would be marked by hand.
    if (point.status === "pass" && point.faults.length > 0) {
      const start = point.shape.type === "area" ? ([point.shape.rect.left, point.shape.rect.top] as Point) : point.shape.segments[0][0];
      const centre = place.toUser(start);
      page.drawCircle({
        x: centre.x,
        y: centre.y,
        size: 0.006 * place.shownWidth,
        borderColor: rgb(0.86, 0.15, 0.15),
        borderWidth: 0.0012 * place.shownWidth,
      });
    }
  }
}

/** The sign-off stamp: what was verified, by whom, with what — in red, on page 1. */
async function drawStamp(doc: PDFDocument, page: PDFPage, sheet: PackageSheet, pkg: CommissioningPackage, context: ExportContext, fonts: { font: PDFFont; bold: PDFFont }) {
  const signoff = sheet.signoff;
  if (!signoff) return;
  const place = placer(page);
  // Sizes are all in steps of the text size, so the stamp's height is a fixed
  // share of its width — STAMP_RATIO, which the on-screen outline uses too.
  const width = STAMP_WIDTH * place.shownWidth;
  const height = width * STAMP_RATIO;
  const size = width * 0.032;
  const pad = size * 0.9;
  const line = size * 1.35;
  const sigHeight = size * 2.6;
  const column = (width - pad * 3) / 2;
  const draw = local(place, sheet.stampAt ?? DEFAULT_STAMP_AT);
  const progress = pointProgress(scopedPoints(sheet));
  const fit = (text: string, font: PDFFont, at: number, max: number) => wrap(font, writable(font, text), at, max)[0] ?? "";

  draw.box(page, 0, 0, width, height, { fill: rgb(1, 1, 1), border: RED, borderWidth: size * 0.12 });
  let y = pad + size * 1.2;
  draw.text(page, fonts.bold, "POINT-TO-POINT VERIFIED", pad, y, size * 1.25);
  y += line * 1.3;
  const counts = [
    `${progress.pass} pass`,
    progress.na > 0 ? `${progress.na} N/A` : "",
    progress.rectified > 0 ? `${progress.rectified} rectified` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  draw.text(
    page,
    fonts.font,
    fit(
      `${sheet.drawingNumber}${sheet.drawingRevision ? ` rev ${sheet.drawingRevision}` : ""}${trianglesNote(sheet)} · ${counts} of ${progress.total}`,
      fonts.font,
      size * 0.9,
      width - pad * 2
    ),
    pad,
    y,
    size * 0.9
  );
  y += line * 0.4;

  // Tester and witness side by side: label, signature, then name, company, licence or role, date.
  const signers: [string, Signer | null][] = [
    ["TESTED BY", signoff.tester],
    ["WITNESSED BY", signoff.witness],
  ];
  const label = y + line;
  const imageTop = label + size * 0.4;
  const firstLine = imageTop + sigHeight + line * 0.8;
  for (const [index, [heading, signer]] of signers.entries()) {
    const x = pad + index * (column + pad);
    draw.text(page, fonts.bold, heading, x, label, size * 0.8);
    const image = await embedSignature(doc, signer);
    if (image) draw.image(page, image, x, imageTop, column, sigHeight);
    if (!signer) {
      draw.text(page, fonts.font, "Not witnessed", x, firstLine, size * 0.85, GREY);
      continue;
    }
    [signer.name, signer.company, signer.detail, formatDate(signer.at)].forEach((text, n) => {
      if (text) draw.text(page, fonts.font, fit(text, fonts.font, size * 0.85, column), x, firstLine + n * line, size * 0.85);
    });
  }
  y = firstLine + 3 * line + line * 1.4;
  const instrument = [signoff.instrument.model, signoff.instrument.serial && `S/N ${signoff.instrument.serial}`, signoff.instrument.calibrationDue && `cal due ${signoff.instrument.calibrationDue}`]
    .filter(Boolean)
    .join(" · ");
  draw.text(page, fonts.font, fit(`Instrument: ${instrument || "—"}`, fonts.font, size * 0.8, width - pad * 2), pad, y, size * 0.8);
  y += line;
  draw.text(page, fonts.font, fit(`${pkg.panelTag || pkg.name} · ${context.projectNumber}`, fonts.font, size * 0.8, width - pad * 2), pad, y, size * 0.8, GREY);
}

/** Fill the title block's commissioning as-built box beside its labels, in red. */
async function fillAsBuilt(doc: PDFDocument, page: PDFPage, texts: SheetText[], sheet: PackageSheet, context: ExportContext, font: PDFFont) {
  const signoff = sheet.signoff;
  const box = findAsBuiltBox(texts);
  if (!signoff || !box) return;
  const place = placer(page);
  const shownHeight = place.shownWidth / place.aspect;
  const write = (label: SheetText | null, text: string) => {
    if (!label || !text) return;
    const size = Math.max(4, label.height * shownHeight * 0.95);
    const at = place.toUser([label.left + label.width + 0.006, label.top + label.height * 0.85]);
    page.drawText(writable(font, text), { x: at.x, y: at.y, size, font, color: RED, rotate: degrees(place.angle) });
  };
  write(box.company, signoff.tester.company);
  write(box.name, `${signoff.tester.name}  ${formatDate(signoff.signedAt)}`);
  write(box.projectCode, context.projectNumber);
  if (box.signature) {
    const image = await embedSignature(doc, signoff.tester);
    if (image) {
      const label = box.signature;
      const height = label.height * shownHeight * 2.2;
      local(place, [label.left + label.width + 0.006, label.top + label.height - (label.height * 2.2 * 0.8)]).image(page, image, 0, 0, height * 4, height);
    } else write(box.signature, signoff.tester.name);
  }
  if (box.markedUp) {
    // The tick box sits just left of its label.
    const label = box.markedUp;
    const h = label.height;
    const hy = h * place.aspect; // keep the tick square on the sheet
    const a = place.toUser([label.left - h * 1.3, label.top + h * 0.5]);
    const b = place.toUser([label.left - h * 0.95, label.top + h * 0.95]);
    const c = place.toUser([label.left - h * 0.25, label.top - hy * 0.15]);
    const thickness = Math.max(0.6, h * shownHeight * 0.15);
    page.drawLine({ start: a, end: b, thickness, color: RED });
    page.drawLine({ start: b, end: c, thickness, color: RED });
  }
}

/** One sheet, signed: points drawn, stamp and as-built box filled. */
async function signedSheetDoc(bytes: Uint8Array, sheet: PackageSheet, pkg: CommissioningPackage, context: ExportContext): Promise<PDFDocument> {
  const texts = await sheetTexts(bytes.slice()).catch(() => []);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach((page, index) => drawPoints(page, sheet, index + 1));
  const first = doc.getPage(0);
  await fillAsBuilt(doc, first, texts, sheet, context, font);
  await drawStamp(doc, first, sheet, pkg, context, { font, bold });
  return doc;
}

/** One signed sheet on its own, for downloading or sending singly. */
export async function signedSheetPdf(input: { bytes: Uint8Array; sheet: PackageSheet; pkg: CommissioningPackage; context: ExportContext }): Promise<Blob> {
  const doc = await signedSheetDoc(input.bytes, input.sheet, input.pkg, input.context);
  const saved = await doc.save();
  return new Blob([saved as BlobPart], { type: "application/pdf" });
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
/** Sheet rows on the cover's first page, and on each page after. */
const FIRST_ROWS = 14;
const MORE_ROWS = 34;

/** Everyone who signed, once each, with the sheets they signed and their latest signature. */
function signersOf(pkg: CommissioningPackage, role: "tester" | "witness") {
  const people = new Map<string, { signer: Signer; sheets: string[]; first: string; last: string }>();
  for (const sheet of pkg.sheets) {
    const signer = sheet.signoff?.[role];
    if (!signer) continue;
    const key = signer.name.trim().toLowerCase();
    const known = people.get(key);
    if (!known) {
      people.set(key, { signer, sheets: [sheet.drawingNumber], first: signer.at, last: signer.at });
      continue;
    }
    known.sheets.push(sheet.drawingNumber);
    if (signer.at < known.first) known.first = signer.at;
    if (signer.at >= known.last) {
      known.last = signer.at;
      known.signer = signer.signature ? signer : { ...signer, signature: known.signer.signature };
    }
  }
  return [...people.values()];
}

async function drawCover(doc: PDFDocument, pkg: CommissioningPackage, context: ExportContext, startPages: number[], fonts: { font: PDFFont; bold: PDFFont }) {
  const { font, bold } = fonts;
  const [width, height] = A4;
  const inner = width - MARGIN * 2;
  let page = doc.addPage(A4);
  let y = height - MARGIN;
  const text = (value: string, x: number, size: number, options: { font?: PDFFont; color?: ReturnType<typeof rgb>; maxWidth?: number } = {}) => {
    const used = options.font ?? font;
    const fitted = options.maxWidth ? wrap(used, writable(used, value), size, options.maxWidth)[0] ?? "" : writable(used, value);
    page.drawText(fitted, { x, y, size, font: used, color: options.color ?? INK });
  };

  text("POINT-TO-POINT COMMISSIONING RECORD", MARGIN, 8.5, { font: bold, color: GREY });
  if (context.businessName) {
    const name = writable(bold, context.businessName);
    page.drawText(name, { x: width - MARGIN - bold.widthOfTextAtSize(name, 11), y, size: 11, font: bold, color: INK });
  }
  y -= 26;
  text(pkg.panelTag || pkg.name || "Commissioning package", MARGIN, 20, { font: bold, maxWidth: inner });
  y -= 18;
  if (pkg.panelTag && pkg.name) {
    text(pkg.name, MARGIN, 11, { color: INK, maxWidth: inner });
    y -= 15;
  }
  text([context.projectNumber, context.projectName, context.clientName].filter(Boolean).join(" · "), MARGIN, 10, { color: GREY, maxWidth: inner });
  y -= 26;

  // Project, when it was tested, and the result.
  const progress = packageProgress(pkg);
  const dates = pkg.sheets
    .flatMap((sheet) => [sheet.signoff?.signedAt ?? "", ...scopedPoints(sheet).map((point) => point.testedAt)])
    .filter(Boolean)
    .sort();
  const period = dates.length === 0 ? "—" : formatDate(dates[0]) === formatDate(dates[dates.length - 1]) ? formatDate(dates[0]) : `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}`;
  const facts: [string, string][] = [
    ["PROJECT", context.projectNumber || "—"],
    ["TESTING PERIOD", period],
    ["RESULT", `${progress.total - progress.pending} / ${progress.total} tested${progress.rectified ? ` · ${progress.rectified} rectified` : ""}`],
  ];
  const cell = inner / facts.length;
  page.drawRectangle({ x: MARGIN, y: y - 30, width: inner, height: 38, borderColor: RULE, borderWidth: 0.8 });
  facts.forEach(([label, value], index) => {
    const x = MARGIN + index * cell + 8;
    page.drawText(label, { x, y: y - 4, size: 7, font, color: GREY });
    page.drawText(wrap(bold, writable(bold, value), 10, cell - 16)[0] ?? "", { x, y: y - 20, size: 10, font: bold, color: INK });
    if (index > 0) page.drawLine({ start: { x: MARGIN + index * cell, y: y + 8 }, end: { x: MARGIN + index * cell, y: y - 30 }, thickness: 0.8, color: RULE });
  });
  y -= 56;

  // The sheets, in working order, with the page each starts on.
  const columns = [
    { label: "PG", x: 0, width: 22 },
    { label: "DRAWING", x: 22, width: 92 },
    { label: "TITLE", x: 114, width: 170 },
    { label: "REV", x: 284, width: 30 },
    { label: "POINTS", x: 314, width: 48 },
    { label: "TESTED BY", x: 362, width: 80 },
    { label: "SIGNED", x: 442, width: inner - 442 },
  ];
  const header = () => {
    text("SHEETS IN THIS PACKAGE", MARGIN, 8.5, { font: bold });
    y -= 14;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: inner, height: 15, color: rgb(0.95, 0.96, 0.97) });
    for (const column of columns) page.drawText(column.label, { x: MARGIN + column.x + 4, y, size: 7, font: bold, color: GREY });
    y -= 16;
  };
  header();
  pkg.sheets.forEach((sheet, index) => {
    if (index === FIRST_ROWS || (index > FIRST_ROWS && (index - FIRST_ROWS) % MORE_ROWS === 0)) {
      page = doc.addPage(A4);
      y = height - MARGIN;
      header();
    }
    const sheetProgress = pointProgress(scopedPoints(sheet));
    const values = [
      `${startPages[index] ?? ""}`,
      sheet.drawingNumber,
      sheet.drawingTitle,
      sheet.drawingRevision || "—",
      `${sheetProgress.total - sheetProgress.pending}/${sheetProgress.total}`,
      sheet.signoff?.tester.name ?? "—",
      sheet.signoff ? formatDate(sheet.signoff.signedAt) : "Not signed",
    ];
    columns.forEach((column, c) => {
      page.drawText(wrap(font, writable(font, values[c]), 8, column.width - 8)[0] ?? "", {
        x: MARGIN + column.x + 4,
        y,
        size: 8,
        font: c === 1 ? bold : font,
        color: INK,
      });
    });
    page.drawLine({ start: { x: MARGIN, y: y - 5 }, end: { x: MARGIN + inner, y: y - 5 }, thickness: 0.5, color: RULE });
    y -= 16;
  });
  y -= 4;
  text("Each sheet carries its own sign-off stamp, and its title block's commissioning box where it has one.", MARGIN, 7.5, { color: GREY, maxWidth: inner });
  y -= 24;

  // Who completed and signed it.
  const blocks = [
    ...signersOf(pkg, "tester").map((entry) => ({ role: "TESTED BY", ...entry })),
    ...signersOf(pkg, "witness").map((entry) => ({ role: "WITNESSED BY", ...entry })),
  ];
  const blockWidth = (inner - 12) / 2;
  const blockHeight = 96;
  if (y - 16 - blockHeight < MARGIN + 70) {
    page = doc.addPage(A4);
    y = height - MARGIN;
  }
  text("COMPLETED AND SIGNED BY", MARGIN, 8.5, { font: bold });
  y -= 12;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const column = index % 2;
    if (column === 0 && index > 0) y -= blockHeight + 10;
    if (y - blockHeight < MARGIN + 70) {
      page = doc.addPage(A4);
      y = height - MARGIN;
    }
    const x = MARGIN + column * (blockWidth + 12);
    const top = y;
    page.drawRectangle({ x, y: top - blockHeight, width: blockWidth, height: blockHeight, borderColor: RULE, borderWidth: 0.8 });
    page.drawText(block.role, { x: x + 8, y: top - 12, size: 7, font, color: GREY });
    page.drawText(wrap(bold, writable(bold, block.signer.name), 10, blockWidth - 16)[0] ?? "", { x: x + 8, y: top - 25, size: 10, font: bold, color: INK });
    page.drawText(wrap(font, writable(font, [block.signer.company, block.signer.detail].filter(Boolean).join(" · ")), 8, blockWidth - 16)[0] ?? "", {
      x: x + 8,
      y: top - 37,
      size: 8,
      font,
      color: INK,
    });
    const image = await embedSignature(doc, block.signer);
    if (image) {
      const h = 26;
      const w = Math.min(blockWidth - 16, (image.width / image.height) * h);
      page.drawImage(image, { x: x + 8, y: top - 70, width: w, height: (image.height / image.width) * w });
    }
    const when = formatDate(block.first) === formatDate(block.last) ? formatDate(block.last) : `${formatDate(block.first)} – ${formatDate(block.last)}`;
    page.drawText(wrap(font, writable(font, `${block.sheets.length} sheet${block.sheets.length === 1 ? "" : "s"} · ${when}`), 7.5, blockWidth - 16)[0] ?? "", {
      x: x + 8,
      y: top - blockHeight + 8,
      size: 7.5,
      font,
      color: GREY,
    });
  }
  if (blocks.length > 0) y -= blockHeight + 22;

  // Instruments used, and the declaration.
  const instruments = [
    ...new Set(
      pkg.sheets
        .map((sheet) => sheet.signoff?.instrument)
        .filter((one): one is NonNullable<typeof one> => Boolean(one && (one.model || one.serial)))
        .map((one) => [one.model, one.serial && `S/N ${one.serial}`, one.calibrationDue && `calibration due ${one.calibrationDue}`].filter(Boolean).join(" · "))
    ),
  ];
  if (y < MARGIN + 80) {
    page = doc.addPage(A4);
    y = height - MARGIN;
  }
  const criteria = criteriaLines(pkg.criteria);
  if (criteria.length > 0) {
    text("TEST CRITERIA", MARGIN, 8.5, { font: bold });
    y -= 13;
    for (const line of criteria) {
      if (y < MARGIN + 60) {
        page = doc.addPage(A4);
        y = height - MARGIN;
      }
      text(`•  ${line}`, MARGIN, 9, { maxWidth: inner });
      y -= 12;
    }
    y -= 10;
  }
  text(instruments.length > 1 ? "TEST INSTRUMENTS" : "TEST INSTRUMENT", MARGIN, 8.5, { font: bold });
  y -= 13;
  for (const one of instruments.length > 0 ? instruments : ["—"]) {
    text(one, MARGIN, 9, { maxWidth: inner });
    y -= 12;
  }
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: MARGIN + inner, y: y + 6 }, thickness: 0.8, color: RULE });
  y -= 6;
  for (const line of wrap(
    font,
    "All conductors and components highlighted on the attached sheets were verified point to point against the drawing revisions listed. Faults found were rectified and re-tested before each sheet was signed. The test record at the back lists every point.",
    8.5,
    inner
  )) {
    text(line, MARGIN, 8.5, { color: INK });
    y -= 11;
  }
  page.drawText(writable(font, `Generated ${formatDate(new Date().toISOString())}${context.generatedBy ? ` by ${context.generatedBy}` : ""}`), {
    x: MARGIN,
    y: MARGIN - 14,
    size: 7,
    font,
    color: GREY,
  });
}

/** The test record: every point on every sheet, landscape A4. */
function drawRecord(doc: PDFDocument, pkg: CommissioningPackage, fonts: { font: PDFFont; bold: PDFFont }) {
  const { font, bold } = fonts;
  const [width, height] = [A4[1], A4[0]];
  const inner = width - MARGIN * 2;
  const columns = [
    { label: "#", x: 0, width: 24 },
    { label: "POINT", x: 24, width: 120 },
    { label: "RESULT", x: 144, width: 60 },
    { label: "READING", x: 204, width: 80 },
    { label: "NOTE / FAULT HISTORY", x: 284, width: 286 },
    { label: "TESTED BY", x: 570, width: 120 },
    { label: "WHEN", x: 690, width: inner - 690 },
  ];
  let page = doc.addPage([width, height]);
  let y = height - MARGIN;
  const fresh = () => {
    page = doc.addPage([width, height]);
    y = height - MARGIN;
  };
  page.drawText(writable(bold, `Test record · ${pkg.panelTag || pkg.name}`), { x: MARGIN, y, size: 14, font: bold, color: INK });
  y -= 24;
  for (const sheet of pkg.sheets) {
    if (y < MARGIN + 60) fresh();
    page.drawText(writable(bold, `${sheet.drawingNumber}${sheet.drawingRevision ? ` rev ${sheet.drawingRevision}` : ""}${trianglesNote(sheet)}  ${sheet.drawingTitle}`), {
      x: MARGIN,
      y,
      size: 10,
      font: bold,
      color: INK,
    });
    y -= 14;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: inner, height: 14, color: rgb(0.95, 0.96, 0.97) });
    for (const column of columns) page.drawText(column.label, { x: MARGIN + column.x + 3, y, size: 6.5, font: bold, color: GREY });
    y -= 14;
    scopedPoints(sheet).forEach((point, index) => {
      // A fault's note is left off when it's the note the point still carries.
      const history = point.faults.map(
        (fault) => `Fault ${formatDate(fault.at)}${fault.note && fault.note !== point.note ? ` (${fault.note})` : ""}`
      );
      const noteLines = wrap(font, writable(font, [point.note, ...history].filter(Boolean).join(" · ") || "—"), 7.5, columns[4].width - 6).slice(0, 4);
      const rowHeight = Math.max(1, noteLines.length) * 10 + 4;
      if (y - rowHeight < MARGIN) fresh();
      const values = [`${index + 1}`, point.label, resultLabel(point), point.reading || "—", "", point.testedBy || "—", formatDate(point.testedAt)];
      columns.forEach((column, c) => {
        if (c === 4) return;
        page.drawText(wrap(font, writable(font, values[c]), 7.5, column.width - 6)[0] ?? "", {
          x: MARGIN + column.x + 3,
          y,
          size: 7.5,
          font: c === 2 ? bold : font,
          color: point.status === "fault" && c === 2 ? rgb(0.7, 0.1, 0.1) : INK,
        });
      });
      noteLines.forEach((line, n) => page.drawText(line, { x: MARGIN + columns[4].x + 3, y: y - n * 10, size: 7.5, font, color: INK }));
      y -= rowHeight;
      page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: MARGIN + inner, y: y + 6 }, thickness: 0.4, color: RULE });
    });
    if (scopedPoints(sheet).length === 0) {
      page.drawText("No points.", { x: MARGIN + 3, y, size: 7.5, font, color: GREY });
      y -= 12;
    }
    y -= 14;
  }
}

/**
 * The package as it's handed over: cover, each signed sheet, test record.
 * `bytesOf` fetches a sheet's drawing PDF.
 */
export async function packagePdf(input: {
  pkg: CommissioningPackage;
  context: ExportContext;
  bytesOf: (sheet: PackageSheet) => Promise<Uint8Array>;
  onProgress?: (message: string) => void;
}): Promise<Blob> {
  const { pkg, context } = input;
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  const sheets: PDFDocument[] = [];
  for (const sheet of pkg.sheets) {
    input.onProgress?.(`Signing ${sheet.drawingNumber}…`);
    sheets.push(await signedSheetDoc(await input.bytesOf(sheet), sheet, pkg, context));
  }

  // The page each sheet starts on, after however many pages the cover takes —
  // laid out once on a scratch document to count them, since a long sheet list
  // or many signers can push it past one.
  input.onProgress?.("Writing the cover page…");
  const probe = await PDFDocument.create();
  await drawCover(probe, pkg, context, [], {
    font: await probe.embedFont(StandardFonts.Helvetica),
    bold: await probe.embedFont(StandardFonts.HelveticaBold),
  });
  const startPages: number[] = [];
  let next = probe.getPageCount() + 1;
  for (const sheet of sheets) {
    startPages.push(next);
    next += sheet.getPageCount();
  }
  await drawCover(out, pkg, context, startPages, { font, bold });

  for (const sheet of sheets) {
    const pages = await out.copyPages(sheet, sheet.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  input.onProgress?.("Writing the test record…");
  drawRecord(out, pkg, { font, bold });
  out.setTitle(`${pkg.panelTag || pkg.name} — point-to-point commissioning`);
  const saved = await out.save();
  return new Blob([saved as BlobPart], { type: "application/pdf" });
}
