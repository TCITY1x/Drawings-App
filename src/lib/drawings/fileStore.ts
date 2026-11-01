import { getSupabase } from "@/lib/supabase/client";

/**
 * Where drawing PDFs are kept — the only copy of each.
 *
 * With the database configured: the private `drawings` bucket in Supabase
 * Storage, at `<project id>/<drawing id>.pdf`. The storage policies
 * (`supabase/migrations`) let only members of the project's organisation
 * read or write under its folder. Keys look like `sb:<path>`.
 *
 * Without it: IndexedDB on this device, never evicted (unlike the opened-PDF
 * cache in `drawingStore.ts`). Keys look like `local:<path>`.
 *
 * Kept as bytes, not Blobs: iOS Safari loses the file behind a Blob stored
 * in IndexedDB.
 */

export const BUCKET = "drawings";

const DB_NAME = "sitepax-files";
const STORE = "originals";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Couldn't open the file store."));
  });
}

function local<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = op(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("File store operation failed."));
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      })
  );
}

function pathFor(projectId: string, name: string): string {
  return `${projectId}/${name}`;
}

/** Store a file under a project and return its key. */
export async function putProjectFile(input: { projectId: string; name: string; blob: Blob; contentType: string }): Promise<string> {
  const path = pathFor(input.projectId, input.name);
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, input.blob, { contentType: input.contentType, upsert: true });
    if (error) throw new Error(`Couldn't store ${input.name}: ${error.message}`);
    return `sb:${path}`;
  }
  const bytes = await input.blob.arrayBuffer();
  await local("readwrite", (store) => store.put({ bytes, type: input.contentType }, path));
  return `local:${path}`;
}

/** Store a drawing's PDF and return its key. */
export function putDrawingFile(input: { projectId: string; drawingId: string; blob: Blob }): Promise<string> {
  return putProjectFile({ projectId: input.projectId, name: `${input.drawingId}.pdf`, blob: input.blob, contentType: "application/pdf" });
}

function split(key: string): { where: "sb" | "local"; path: string } {
  const at = key.indexOf(":");
  const where = key.slice(0, at);
  if (at < 0 || (where !== "sb" && where !== "local")) throw new Error("That file isn't in SitePax's storage.");
  return { where, path: key.slice(at + 1) };
}

export async function getDrawingFile(key: string): Promise<Blob> {
  const { where, path } = split(key);
  if (where === "sb") {
    const supabase = getSupabase();
    if (!supabase) throw new Error("This drawing is stored online, and SitePax isn't connected.");
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`Couldn't fetch the drawing: ${error?.message ?? "no file"}`);
    return data;
  }
  const hit = await local<{ bytes: ArrayBuffer; type: string } | undefined>("readonly", (store) => store.get(path));
  if (!hit) throw new Error("This drawing's PDF isn't on this device.");
  return new Blob([hit.bytes], { type: hit.type });
}

export async function removeDrawingFile(key: string): Promise<void> {
  const { where, path } = split(key);
  if (where === "sb") {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(`Couldn't delete the file: ${error.message}`);
    return;
  }
  await local("readwrite", (store) => store.delete(path));
}
