import { PDFDict, PDFName, PDFRef, PDFStream, type PDFDocument, type PDFObject } from "pdf-lib";

/**
 * Strip what can't survive pdf-lib rewriting the file: document and field
 * JavaScript, the interactive form, and digital signatures.
 *
 * Client drawings often arrive signed, append-only, with scripts that drive
 * their form (a blinking "Target" field, review stamps). pdf-lib saves a whole
 * new file, not an incremental update, so every signature's byte range is
 * then wrong — and it writes a signing placeholder's 2^63-1 byte range back as
 * a number too big for a PDF integer. Opened in Acrobat on the recipient's
 * computer, the scripts then run against a broken, "altered" signed form and
 * the drawing doesn't show. The copy is for reading the markups, so it keeps
 * every page and annotation appearance and drops the rest.
 */
export function stripInteractive(doc: PDFDocument): void {
  const { context, catalog } = doc;
  const name = (key: string) => PDFName.of(key);
  const dictOf = (object: PDFObject | undefined): PDFDict | undefined => {
    const resolved = object instanceof PDFRef ? context.lookup(object) : object;
    if (resolved instanceof PDFDict) return resolved;
    if (resolved instanceof PDFStream) return resolved.dict;
    return undefined;
  };
  const isScript = (object: PDFObject | undefined) =>
    dictOf(object)?.get(name("S")) === name("JavaScript");

  for (const key of ["AcroForm", "Perms", "AA"]) catalog.delete(name(key));
  if (isScript(catalog.get(name("OpenAction")))) catalog.delete(name("OpenAction"));
  dictOf(catalog.get(name("Names")))?.delete(name("JavaScript"));

  // Signature dictionaries and script actions go; anything still pointing at one forgets it.
  const removed = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    const dict = dictOf(object);
    if (dict?.has(name("ByteRange")) || dict?.get(name("Type")) === name("Sig") || isScript(dict)) {
      context.delete(ref);
      removed.add(ref.toString());
    }
  }
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict = dictOf(object);
    if (!dict) continue;
    dict.delete(name("AA"));
    dict.delete(name("JS"));
    if (isScript(dict.get(name("A")))) dict.delete(name("A"));
    for (const [key, value] of dict.entries()) {
      if (value instanceof PDFRef && removed.has(value.toString())) dict.delete(key);
    }
  }
}
