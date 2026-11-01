import { isPdfName } from "@/lib/drawings/drawings";

/**
 * What was picked or dropped, unpacked into the PDFs to add: loose PDFs as they
 * are, and every PDF inside a .zip — folders and all, since a drawing set
 * usually comes zipped inside a folder of its own. Anything else is listed as
 * skipped rather than silently dropped.
 */

export interface IncomingPdf {
  /** The file's own name, without any folder from the zip. */
  name: string;
  /** Where it came from, for the progress list: "CVR1_Drawings_1.zip › CVR1 Drawings". */
  from: string;
  blob: Blob;
}

export interface Skipped {
  name: string;
  reason: string;
}

function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

/** macOS's resource-fork clutter and other hidden entries, never drawings. */
function isClutter(path: string): boolean {
  return path.split("/").some((part) => part === "__MACOSX" || part.startsWith("._") || part === ".DS_Store");
}

export async function expandUploads(files: File[]): Promise<{ pdfs: IncomingPdf[]; skipped: Skipped[] }> {
  const pdfs: IncomingPdf[] = [];
  const skipped: Skipped[] = [];
  for (const file of files) {
    if (isPdfName(file.name) || file.type === "application/pdf") {
      pdfs.push({ name: file.name, from: "", blob: file });
      continue;
    }
    if (!isZip(file)) {
      skipped.push({ name: file.name, reason: "Not a PDF or .zip" });
      continue;
    }
    const { default: JSZip } = await import("jszip");
    let zip: InstanceType<typeof JSZip>;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      skipped.push({ name: file.name, reason: "Couldn't open the .zip" });
      continue;
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir && !isClutter(entry.name));
    for (const entry of entries) {
      const parts = entry.name.split("/");
      const name = parts.pop() ?? entry.name;
      const from = [file.name, ...parts].join(" › ");
      if (!isPdfName(name)) {
        skipped.push({ name: `${from} › ${name}`, reason: /\.zip$/i.test(name) ? "A .zip inside a .zip — unzip it first" : "Not a PDF" });
        continue;
      }
      const bytes = await entry.async("uint8array");
      pdfs.push({ name, from, blob: new Blob([bytes as BlobPart], { type: "application/pdf" }) });
    }
  }
  return { pdfs, skipped };
}
