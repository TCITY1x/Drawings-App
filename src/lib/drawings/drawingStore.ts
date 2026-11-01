import { getSupabase } from "@/lib/supabase/client";
import { CLIENT_ID } from "@/lib/clientId";
import { getDrawingFile, removeDrawingFile } from "@/lib/drawings/fileStore";
import type { ProjectDrawing } from "@/lib/drawings/drawings";
import { TEXT_SCALE, type DrawingMarkup, type InkColour, type MarkupShape, type Point } from "@/lib/drawings/drawingMarkups";
import {
  CHECK_STATUSES,
  type CheckPoint,
  type CheckShape,
  type CheckStatus,
  type CommissioningPackage,
  type PackageSheet,
  type Signer,
} from "@/lib/drawings/commissioning";

/**
 * Where a project's drawing register lives — the text index, not the PDFs,
 * which are in the file store (`fileStore.ts`).
 *
 * With the database configured: `drawings`, read one project at a time when
 * its register opens (`supabase/migrations`). Row-level security keeps each
 * organisation's rows to its own members.
 *
 * Without it (local mode, or before the migration is applied): IndexedDB on
 * this device, so the app still works for one person.
 *
 * Markups — QA/QC issues and redlines drawn on a sheet — are kept the same way
 * in `drawing_markups`, and point-to-point commissioning packages in
 * `commissioning_packages`: one document per package, its sheets, check points
 * and sign-offs inside.
 *
 * Opened PDFs are also cached in IndexedDB, so a drawing fetched once opens
 * instantly next time. The cache is bounded and safe to lose.
 */

const TABLE = "drawings";
const MARKUP_TABLE = "drawing_markups";
const PACKAGE_TABLE = "commissioning_packages";
const DB_NAME = "fieldmark-drawings";
const DB_VERSION = 1;
const RECORDS = "drawings";
const FILES = "files";
const FILES_AT = "at";
const MARKUPS = "markups";
const PACKAGES = "packages";

/** Opened PDFs kept on this device; the oldest go first. */
const CACHE_LIMIT = 80;

/** Set per table when it is missing, so we stop asking and use this device. */
const cloudMissing = new Set<string>();

function cloud(table = TABLE) {
  return cloudMissing.has(table) ? null : getSupabase();
}

function missingTable(message: string): boolean {
  return /does not exist|could not find the table|schema cache/i.test(message);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS)) {
        db.createObjectStore(RECORDS, { keyPath: "id" }).createIndex("projectId", "projectId");
      }
      const files = db.objectStoreNames.contains(FILES)
        ? request.transaction!.objectStore(FILES)
        : db.createObjectStore(FILES);
      if (!files.indexNames.contains(FILES_AT)) files.createIndex(FILES_AT, "at");
      if (!db.objectStoreNames.contains(MARKUPS)) {
        db.createObjectStore(MARKUPS, { keyPath: "id" }).createIndex("projectId", "projectId");
      }
      if (!db.objectStoreNames.contains(PACKAGES)) {
        db.createObjectStore(PACKAGES, { keyPath: "id" }).createIndex("projectId", "projectId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Couldn't open the drawing store."));
  });
}

function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = op(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Drawing store operation failed."));
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      })
  );
}

/** A stored row back into a drawing, whatever wrote it. */
export function sanitizeDrawing(raw: unknown): ProjectDrawing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  if (!text(r.id) || !text(r.projectId)) return null;
  return {
    id: text(r.id),
    projectId: text(r.projectId),
    fileName: text(r.fileName),
    number: text(r.number),
    revision: text(r.revision),
    title: text(r.title),
    titleLines: strings(r.titleLines),
    pages: strings(r.pages),
    size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
    fileKey: text(r.fileKey),
    uploadedAt: text(r.uploadedAt) || new Date(0).toISOString(),
  };
}

/** A project's drawings, in no particular order. */
export async function listDrawings(projectId: string): Promise<ProjectDrawing[]> {
  const supabase = cloud();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE).select("data").eq("project_id", projectId);
    if (!error) return (data ?? []).map((row) => sanitizeDrawing(row.data)).filter((d): d is ProjectDrawing => d !== null);
    if (!missingTable(error.message)) throw new Error(`Couldn't load the drawings: ${error.message}`);
    cloudMissing.add(TABLE);
  }
  const rows = await run<unknown[]>(RECORDS, "readonly", (store) => store.index("projectId").getAll(projectId));
  return rows.map(sanitizeDrawing).filter((d): d is ProjectDrawing => d !== null);
}

export async function saveDrawing(drawing: ProjectDrawing): Promise<void> {
  const supabase = cloud();
  if (supabase) {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ id: drawing.id, project_id: drawing.projectId, data: drawing, client_id: CLIENT_ID });
    if (!error) return;
    if (!missingTable(error.message)) throw new Error(`Couldn't save ${drawing.number || drawing.fileName}: ${error.message}`);
    cloudMissing.add(TABLE);
  }
  await run(RECORDS, "readwrite", (store) => store.put(drawing));
}

/**
 * Take a drawing out of the register, and its PDF out of storage unless
 * `keepFile` — a revision replaced by a newer one keeps its file.
 */
export async function deleteDrawing(drawing: ProjectDrawing, { keepFile = false } = {}): Promise<void> {
  const supabase = cloud();
  if (supabase) {
    const { error } = await supabase.from(TABLE).delete().eq("id", drawing.id);
    if (error && !missingTable(error.message)) throw new Error(`Couldn't remove ${drawing.number}: ${error.message}`);
    if (error) cloudMissing.add(TABLE);
  }
  if (!supabase || cloudMissing.has(TABLE)) await run(RECORDS, "readwrite", (store) => store.delete(drawing.id));
  await run(FILES, "readwrite", (store) => store.delete(drawing.id)).catch(() => undefined);
  if (!keepFile && drawing.fileKey) await removeDrawingFile(drawing.fileKey).catch(() => undefined);
}

/**
 * A cached PDF. Kept as bytes, not a Blob: iOS Safari loses the file behind a
 * Blob stored in IndexedDB, and reading it then fails with "The object can not
 * be found here." Older entries may still hold a `blob`.
 */
interface CachedFile {
  bytes?: ArrayBuffer;
  blob?: Blob;
  at: number;
}

/** The PDF if this device has opened (or uploaded) it before; null when it hasn't or the copy is unreadable. */
async function cachedDrawingFile(drawingId: string): Promise<Uint8Array | null> {
  try {
    const hit = await run<CachedFile | undefined>(FILES, "readonly", (store) => store.get(drawingId));
    if (!hit) return null;
    const bytes = hit.bytes ?? (hit.blob ? await hit.blob.arrayBuffer() : null);
    if (!bytes || bytes.byteLength === 0) throw new Error("Empty cached drawing.");
    void run(FILES, "readwrite", (store) => store.put({ bytes, at: Date.now() } satisfies CachedFile, drawingId)).catch(
      () => undefined
    );
    // A copy: pdf.js takes the array it is given, and the put above may not have read it yet.
    return new Uint8Array(bytes.slice(0));
  } catch {
    // A lost or broken copy: forget it so the next open goes straight to the file store.
    await run(FILES, "readwrite", (store) => store.delete(drawingId)).catch(() => undefined);
    return null;
  }
}

/** Keep a PDF on this device. Best effort: a full or blocked store just means a slower next open. */
export async function cacheDrawingFile(drawingId: string, blob: Blob): Promise<void> {
  try {
    const bytes = await blob.arrayBuffer();
    await run(FILES, "readwrite", (store) => store.put({ bytes, at: Date.now() } satisfies CachedFile, drawingId));
    const count = await run<number>(FILES, "readonly", (store) => store.count());
    if (count <= CACHE_LIMIT) return;
    // Oldest first by the `at` index, reading keys only — never every PDF into memory.
    const oldest = await run<IDBValidKey[]>(FILES, "readonly", (store) =>
      store.index(FILES_AT).getAllKeys(null, count - CACHE_LIMIT)
    );
    for (const key of oldest) await run(FILES, "readwrite", (store) => store.delete(key));
  } catch {
    // Nothing to do: the drawing is still in the file store.
  }
}

const INKS: InkColour[] = ["red", "blue", "yellow"];

function point(value: unknown): Point | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value.map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** A text size kept as it was set, within what the sizes on offer allow; dropped when it's the usual one. */
function textScale(value: unknown): { size?: number } {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0 || size === 1) return {};
  return { size: Math.min(TEXT_SCALE[1], Math.max(TEXT_SCALE[0], size)) };
}

function sanitizeShape(raw: unknown): MarkupShape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const colour = INKS.includes(r.colour as InkColour) ? (r.colour as InkColour) : "red";
  switch (r.type) {
    case "pen": {
      const points = Array.isArray(r.points) ? r.points.map(point).filter((p): p is Point => p !== null) : [];
      return points.length > 0 ? { type: "pen", colour, points } : null;
    }
    case "highlight": {
      const rects = (Array.isArray(r.rects) ? r.rects : [])
        .map((rect) => rect as Record<string, unknown>)
        .map((rect) => ({ left: Number(rect?.left), top: Number(rect?.top), width: Number(rect?.width), height: Number(rect?.height) }))
        .filter((rect) => [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite));
      return rects.length > 0 ? { type: "highlight", colour, rects } : null;
    }
    case "line":
    case "arrow":
    case "box":
    case "cloud": {
      const from = point(r.from);
      const to = point(r.to);
      return from && to ? { type: r.type, colour, from, to } : null;
    }
    case "callout": {
      const tip = point(r.tip);
      const box = (r.rect ?? {}) as Record<string, unknown>;
      const rect = { left: Number(box.left), top: Number(box.top), width: Number(box.width), height: Number(box.height) };
      const text = typeof r.text === "string" ? r.text : "";
      const sound = [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
      return tip && sound && text.trim() ? { type: "callout", colour, rect, tip, text, ...textScale(r.size) } : null;
    }
    case "text": {
      const at = point(r.at);
      const text = typeof r.text === "string" ? r.text : "";
      return at && text.trim() ? { type: "text", colour, at, text, ...textScale(r.size) } : null;
    }
    default:
      return null;
  }
}

/** A stored markup back into shape, whatever wrote it. */
export function sanitizeMarkup(raw: unknown): DrawingMarkup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (!text(r.id) || !text(r.projectId)) return null;
  const sends = (Array.isArray(r.sends) ? r.sends : []).map((one) => {
    const send = (one ?? {}) as Record<string, unknown>;
    return {
      at: text(send.at),
      by: text(send.by),
      to: Array.isArray(send.to) ? send.to.filter((v): v is string => typeof v === "string") : [],
      fileUrl: text(send.fileUrl),
    };
  });
  const createdAt = text(r.createdAt) || new Date(0).toISOString();
  return {
    id: text(r.id),
    projectId: text(r.projectId),
    drawingId: text(r.drawingId),
    drawingNumber: text(r.drawingNumber),
    drawingRevision: text(r.drawingRevision),
    page: Math.max(1, Math.floor(Number(r.page) || 1)),
    kind: r.kind === "redline" ? "redline" : "issue",
    number: Math.max(0, Math.floor(Number(r.number) || 0)),
    title: text(r.title),
    comment: text(r.comment),
    status: r.status === "sent" || r.status === "fixed" ? r.status : "open",
    shapes: (Array.isArray(r.shapes) ? r.shapes : []).map(sanitizeShape).filter((s): s is MarkupShape => s !== null),
    createdBy: text(r.createdBy),
    createdAt,
    updatedAt: text(r.updatedAt) || createdAt,
    sends,
    fixedAt: text(r.fixedAt),
    fixedBy: text(r.fixedBy),
  };
}

/** A project's markups on every drawing, in no particular order. */
export async function listMarkups(projectId: string): Promise<DrawingMarkup[]> {
  const supabase = cloud(MARKUP_TABLE);
  if (supabase) {
    const { data, error } = await supabase.from(MARKUP_TABLE).select("data").eq("project_id", projectId);
    if (!error) return (data ?? []).map((row) => sanitizeMarkup(row.data)).filter((m): m is DrawingMarkup => m !== null);
    if (!missingTable(error.message)) throw new Error(`Couldn't load the markups: ${error.message}`);
    cloudMissing.add(MARKUP_TABLE);
  }
  const rows = await run<unknown[]>(MARKUPS, "readonly", (store) => store.index("projectId").getAll(projectId));
  return rows.map(sanitizeMarkup).filter((m): m is DrawingMarkup => m !== null);
}

export async function saveMarkup(markup: DrawingMarkup): Promise<void> {
  const supabase = cloud(MARKUP_TABLE);
  if (supabase) {
    const { error } = await supabase
      .from(MARKUP_TABLE)
      .upsert({ id: markup.id, project_id: markup.projectId, data: markup, client_id: CLIENT_ID });
    if (!error) return;
    if (!missingTable(error.message)) throw new Error(`Couldn't save markup #${markup.number}: ${error.message}`);
    cloudMissing.add(MARKUP_TABLE);
  }
  await run(MARKUPS, "readwrite", (store) => store.put(markup));
}

export async function deleteMarkup(markup: DrawingMarkup): Promise<void> {
  const supabase = cloud(MARKUP_TABLE);
  if (supabase) {
    const { error } = await supabase.from(MARKUP_TABLE).delete().eq("id", markup.id);
    if (!error) return;
    if (!missingTable(error.message)) throw new Error(`Couldn't delete markup #${markup.number}: ${error.message}`);
    cloudMissing.add(MARKUP_TABLE);
  }
  await run(MARKUPS, "readwrite", (store) => store.delete(markup.id));
}

function sanitizeCheckShape(raw: unknown): CheckShape | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type === "area") {
    const rect = (r.rect ?? {}) as Record<string, unknown>;
    const out = { left: Number(rect.left), top: Number(rect.top), width: Number(rect.width), height: Number(rect.height) };
    return [out.left, out.top, out.width, out.height].every(Number.isFinite) ? { type: "area", rect: out } : null;
  }
  if (r.type === "trace") {
    const segments = (Array.isArray(r.segments) ? r.segments : [])
      .map((segment) => (Array.isArray(segment) && segment.length === 2 ? [point(segment[0]), point(segment[1])] : null))
      .filter((segment): segment is [Point, Point] => segment !== null && segment[0] !== null && segment[1] !== null);
    return segments.length > 0 ? { type: "trace", segments } : null;
  }
  return null;
}

function sanitizeCheckPoint(raw: unknown): CheckPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const shape = sanitizeCheckShape(r.shape);
  if (!text(r.id) || !shape) return null;
  return {
    id: text(r.id),
    page: Math.max(1, Math.floor(Number(r.page) || 1)),
    label: text(r.label),
    shape,
    status: CHECK_STATUSES.includes(r.status as CheckStatus) ? (r.status as CheckStatus) : "pending",
    reading: text(r.reading),
    note: text(r.note),
    testedBy: text(r.testedBy),
    testedAt: text(r.testedAt),
    faults: (Array.isArray(r.faults) ? r.faults : []).map((one) => {
      const fault = (one ?? {}) as Record<string, unknown>;
      return { at: text(fault.at), by: text(fault.by), note: text(fault.note) };
    }),
    removal: shape.type === "area" && r.removal === true,
    triangle: text(r.triangle).trim(),
    row: shape.type === "area" && r.row === true,
  };
}

function sanitizeSigner(raw: unknown): Signer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (!text(r.name).trim()) return null;
  // Only an image this app drew — never a remote URL in a document someone else wrote.
  const signature = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(text(r.signature)) ? text(r.signature) : "";
  return { name: text(r.name), company: text(r.company), detail: text(r.detail), signature, at: text(r.at) };
}

function sanitizeSheet(raw: unknown): PackageSheet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (!text(r.drawingId)) return null;
  const rawSignoff = (r.signoff ?? null) as Record<string, unknown> | null;
  const tester = rawSignoff ? sanitizeSigner(rawSignoff.tester) : null;
  const instrument = (rawSignoff?.instrument ?? {}) as Record<string, unknown>;
  return {
    drawingId: text(r.drawingId),
    drawingNumber: text(r.drawingNumber),
    drawingRevision: text(r.drawingRevision),
    drawingTitle: text(r.drawingTitle),
    fileName: text(r.fileName),
    points: (Array.isArray(r.points) ? r.points : []).map(sanitizeCheckPoint).filter((p): p is CheckPoint => p !== null),
    signoff:
      rawSignoff && tester
        ? {
            tester,
            witness: sanitizeSigner(rawSignoff.witness),
            instrument: { model: text(instrument.model), serial: text(instrument.serial), calibrationDue: text(instrument.calibrationDue) },
            signedBy: text(rawSignoff.signedBy),
            signedAt: text(rawSignoff.signedAt),
          }
        : null,
    stampAt: point(r.stampAt),
    triangles: Array.isArray(r.triangles)
      ? [...new Set(r.triangles.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))]
      : [],
  };
}

/** A stored package back into shape, whatever wrote it. */
export function sanitizePackage(raw: unknown): CommissioningPackage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (!text(r.id) || !text(r.projectId)) return null;
  const createdAt = text(r.createdAt) || new Date(0).toISOString();
  return {
    id: text(r.id),
    projectId: text(r.projectId),
    name: text(r.name),
    panelTag: text(r.panelTag),
    assignedTo: text(r.assignedTo),
    projectCode: text(r.projectCode),
    criteria: text(r.criteria),
    sheets: (Array.isArray(r.sheets) ? r.sheets : []).map(sanitizeSheet).filter((s): s is PackageSheet => s !== null),
    createdBy: text(r.createdBy),
    createdAt,
    updatedAt: text(r.updatedAt) || createdAt,
    sends: (Array.isArray(r.sends) ? r.sends : []).map((one) => {
      const send = (one ?? {}) as Record<string, unknown>;
      return {
        at: text(send.at),
        by: text(send.by),
        to: Array.isArray(send.to) ? send.to.filter((v): v is string => typeof v === "string") : [],
        fileUrl: text(send.fileUrl),
      };
    }),
  };
}

/** A project's commissioning packages, in no particular order. */
export async function listPackages(projectId: string): Promise<CommissioningPackage[]> {
  const supabase = cloud(PACKAGE_TABLE);
  if (supabase) {
    const { data, error } = await supabase.from(PACKAGE_TABLE).select("data").eq("project_id", projectId);
    if (!error) return (data ?? []).map((row) => sanitizePackage(row.data)).filter((p): p is CommissioningPackage => p !== null);
    if (!missingTable(error.message)) throw new Error(`Couldn't load the commissioning packages: ${error.message}`);
    cloudMissing.add(PACKAGE_TABLE);
  }
  const rows = await run<unknown[]>(PACKAGES, "readonly", (store) => store.index("projectId").getAll(projectId));
  return rows.map(sanitizePackage).filter((p): p is CommissioningPackage => p !== null);
}

export async function savePackage(pkg: CommissioningPackage): Promise<void> {
  const supabase = cloud(PACKAGE_TABLE);
  if (supabase) {
    const { error } = await supabase
      .from(PACKAGE_TABLE)
      .upsert({ id: pkg.id, project_id: pkg.projectId, data: pkg, client_id: CLIENT_ID });
    if (!error) return;
    if (!missingTable(error.message)) throw new Error(`Couldn't save ${pkg.name || "the package"}: ${error.message}`);
    cloudMissing.add(PACKAGE_TABLE);
  }
  await run(PACKAGES, "readwrite", (store) => store.put(pkg));
}

export async function deletePackage(pkg: CommissioningPackage): Promise<void> {
  const supabase = cloud(PACKAGE_TABLE);
  if (supabase) {
    const { error } = await supabase.from(PACKAGE_TABLE).delete().eq("id", pkg.id);
    if (!error) return;
    if (!missingTable(error.message)) throw new Error(`Couldn't delete ${pkg.name || "the package"}: ${error.message}`);
    cloudMissing.add(PACKAGE_TABLE);
  }
  await run(PACKAGES, "readwrite", (store) => store.delete(pkg.id));
}

/**
 * A drawing's PDF bytes: this device's cached copy, else the file store's
 * (then cached here). A fresh array each call — pdf.js takes ownership of
 * what it is given.
 */
export async function drawingBytes(drawing: Pick<ProjectDrawing, "id" | "fileKey">): Promise<Uint8Array> {
  const cached = await cachedDrawingFile(drawing.id);
  if (cached) return cached;
  const blob = await getDrawingFile(drawing.fileKey);
  void cacheDrawingFile(drawing.id, blob);
  return new Uint8Array(await blob.arrayBuffer());
}
