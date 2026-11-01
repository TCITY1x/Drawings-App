import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { stripInteractive } from "./pdfStrip.ts";

/** A one-page PDF shaped like a client's signed drawing: a script, a form, a signing placeholder. */
async function signedDrawing() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawText("drawing", { x: 20, y: 20 });
  const { context, catalog } = doc;
  const script = context.obj({ S: "JavaScript", JS: "app.setInterval('blinker()', 500);" });
  const names = context.obj({ Names: ["generalScript", context.register(script)] });
  catalog.set(PDFName.of("Names"), context.obj({ JavaScript: context.register(names) }));
  catalog.set(PDFName.of("OpenAction"), context.register(context.obj({ S: "JavaScript", JS: "blinker()" })));
  const sig = context.register(
    context.obj({ Type: "Sig", ByteRange: [0, 9223372036854775807, 9223372036854775807, 9223372036854775807] })
  );
  const widget = context.register(
    context.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", T: "Target", V: sig, Rect: [0, 0, 10, 10], AA: { K: { S: "JavaScript", JS: "x" } } })
  );
  page.node.set(PDFName.of("Annots"), context.obj([widget]));
  catalog.set(PDFName.of("AcroForm"), context.obj({ Fields: [widget], SigFlags: 3 }));
  catalog.set(PDFName.of("Perms"), context.obj({ DocMDP: sig }));
  return doc;
}

test("stripInteractive drops scripts, the form and signatures but keeps the page and its annotations", async () => {
  const doc = await signedDrawing();
  stripInteractive(doc);
  const saved = await doc.save();
  const text = Buffer.from(await PDFDocument.load(saved).then((d) => d.save({ useObjectStreams: false }))).toString("latin1");
  for (const gone of ["/S /JavaScript", "app.setInterval", "/AcroForm", "/Perms", "/OpenAction", "/ByteRange", "/AA", "9223372036854776000"]) {
    assert.ok(!text.includes(gone), `${gone} should be gone`);
  }
  const reloaded = await PDFDocument.load(saved);
  assert.equal(reloaded.getPageCount(), 1);
  const annots = reloaded.getPage(0).node.Annots();
  assert.equal(annots?.size(), 1);
  const widget = reloaded.context.lookup(annots!.get(0), PDFDict);
  assert.equal(widget.get(PDFName.of("V")), undefined);
});

test("stripInteractive leaves a plain drawing alone", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  stripInteractive(doc);
  assert.equal((await PDFDocument.load(await doc.save())).getPageCount(), 1);
});
