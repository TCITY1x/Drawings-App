/**
 * One place that loads pdf.js, so the worker is pointed exactly once.
 *
 * The `legacy` build, deliberately: the modern one calls
 * `Map.getOrInsertComputed`, which the Chromium on a site tablet does not have,
 * and the failure is a blank page rather than an error anybody can act on.
 */

/**
 * Safari below ~18 cannot `for await` over a ReadableStream — the stream has
 * no `Symbol.asyncIterator`. pdf.js v6 does exactly that inside
 * `getTextContent`, legacy build included, so on an older iPhone every page
 * read died with "undefined is not a function (near '...t of e...')" — first
 * seen from a site phone running calibration, but the fill-and-sign viewer
 * goes through the same call. The shim is the standard reader loop, guarded
 * so browsers that have the real thing never see it.
 */
type AsyncIterableStream = ReadableStream & {
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

if (
  typeof ReadableStream !== "undefined" &&
  !(Symbol.asyncIterator in ReadableStream.prototype)
) {
  (ReadableStream.prototype as AsyncIterableStream)[Symbol.asyncIterator] =
    async function* iterate(this: ReadableStream) {
      const reader = this.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    };
}

/** Set at module scope, so a re-render cannot re-point the worker. */
let workerReady = false;

export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!workerReady) {
    // Served from `public/`, and version-locked: pdf.js refuses to run against
    // a worker built from a different release rather than misbehaving quietly.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    workerReady = true;
  }
  return pdfjs;
}

export type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
