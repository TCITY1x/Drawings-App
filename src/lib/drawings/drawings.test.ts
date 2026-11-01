import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareRevisions,
  incomingVerdict,
  matchesIn,
  parseDrawingFileName,
  referencedDrawings,
  registerTitles,
  searchDrawings,
  sortDrawings,
  titleBlockLines,
  type ProjectDrawing,
  type PlacedText,
} from "./drawings.ts";

function drawing(over: Partial<ProjectDrawing>): ProjectDrawing {
  return {
    id: over.id ?? over.number ?? "d",
    projectId: "project-1",
    fileName: "",
    number: "",
    revision: "",
    title: "",
    titleLines: [],
    pages: [],
    size: 0,
    fileKey: "",
    uploadedAt: "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

test("drawing number and revision come off the file name", () => {
  assert.deepEqual(parseDrawingFileName("K100-E-08056_17 CODE A1.PDF"), { number: "K100-E-08056", revision: "17" });
  assert.deepEqual(parseDrawingFileName("CVR1 Drawings/K100-E-12021_8 CODE A1.PDF"), {
    number: "K100-E-12021",
    revision: "8",
  });
  assert.deepEqual(parseDrawingFileName("E-101 Lighting Layout Rev C.pdf"), { number: "E-101", revision: "C" });
  assert.deepEqual(parseDrawingFileName("E-101_RevC.pdf"), { number: "E-101", revision: "C" });
  assert.deepEqual(parseDrawingFileName("E-101.pdf"), { number: "E-101", revision: "" });
  assert.deepEqual(parseDrawingFileName("Site plan.pdf"), { number: "Site plan", revision: "" });
});

test("revisions order numbers after letters", () => {
  assert.ok(compareRevisions("17", "16") > 0);
  assert.ok(compareRevisions("10", "9") > 0);
  assert.ok(compareRevisions("C", "B") > 0);
  assert.ok(compareRevisions("0", "C") > 0);
  assert.ok(compareRevisions("A", "") > 0);
  assert.equal(compareRevisions("7", "7"), 0);
});

test("a newer revision replaces, the same or older is skipped", () => {
  const register = [drawing({ number: "K100-E-08056", revision: "16" })];
  assert.equal(incomingVerdict(register, { number: "K100-E-08056", revision: "17" }).kind, "replace");
  assert.equal(incomingVerdict(register, { number: "k100-e-08056", revision: "16" }).kind, "same");
  assert.equal(incomingVerdict(register, { number: "K100-E-08056", revision: "15" }).kind, "older");
  assert.equal(incomingVerdict(register, { number: "K100-E-08057", revision: "1" }).kind, "new");
});

test("the register sorts by drawing number, numbers in order", () => {
  const sorted = sortDrawings([
    drawing({ number: "K100-E-12021" }),
    drawing({ number: "E-10" }),
    drawing({ number: "K100-E-08040" }),
    drawing({ number: "E-2" }),
  ]);
  assert.deepEqual(
    sorted.map((d) => d.number),
    ["E-2", "E-10", "K100-E-08040", "K100-E-12021"]
  );
});

test("the title block's big lines are the title, not the drawing number", () => {
  // As pdf.js reads K100-E-08040: the number is bigger but in short pieces.
  const items: PlacedText[] = [
    { str: "K100", x: 0.856, y: 0.97, height: 19.8, rotation: 0 },
    { str: "08040", x: 0.919, y: 0.97, height: 19.8, rotation: 0 },
    { str: "NOT CONSTRUCTED", x: 0.68, y: 0.84, height: 28.3, rotation: 30 },
    { str: "CONVEYOR - CVR1", x: 0.786, y: 0.919, height: 14.2, rotation: 0 },
    { str: "PORT ORE HANDLING - FINUCANE", x: 0.786, y: 0.904, height: 14.2, rotation: 0 },
    { str: "415V MCC 101 (M101C) - LP101", x: 0.786, y: 0.934, height: 14.2, rotation: 0 },
    { str: "SCHEMATIC DIAGRAM", x: 0.786, y: 0.949, height: 14.2, rotation: 0 },
    { str: "A1", x: 0.815, y: 0.967, height: 14.2, rotation: 0 },
    { str: "415V MCC 101 (M101C)", x: 0.848, y: 0.815, height: 7.1, rotation: 0 },
    { str: "GREASE LP101 LOCAL CONTROL STATION", x: 0.2, y: 0.3, height: 14.2, rotation: 0 },
  ];
  assert.deepEqual(titleBlockLines(items), [
    "PORT ORE HANDLING - FINUCANE",
    "CONVEYOR - CVR1",
    "415V MCC 101 (M101C) - LP101",
    "SCHEMATIC DIAGRAM",
  ]);
});

test("a bigger company name over the title box is not the title", () => {
  // As 085-E-13476 (BWR7 M820C-X007 schematic) reads: the client's name is a
  // size up from the title, and the signature block is a stack of its own.
  const items: PlacedText[] = [
    { str: "BHP Iron Ore Pty Ltd", x: 0.756, y: 0.879, height: 19.3, rotation: 0 },
    { str: "PORT ORE HANDLING - FINUCANE", x: 0.739, y: 0.896, height: 17.1, rotation: 0 },
    { str: "RECLAIMER - BWR7", x: 0.739, y: 0.91, height: 17.1, rotation: 0 },
    { str: "LOWER DECK PLC MARSHALLING PANEL M820C-X007", x: 0.739, y: 0.923, height: 17.1, rotation: 0 },
    { str: "SCHEMATIC DIAGRAM SHT 01", x: 0.739, y: 0.936, height: 17.1, rotation: 0 },
    { str: "Digitally signed by", x: 0.598, y: 0.903, height: 9.1, rotation: 0 },
    { str: "Anthony Selby", x: 0.598, y: 0.908, height: 9.1, rotation: 0 },
    { str: "Date: 2026.09.15", x: 0.598, y: 0.914, height: 9.1, rotation: 0 },
    { str: "07:31:18 +08'00'", x: 0.598, y: 0.919, height: 9.1, rotation: 0 },
    { str: "Daniel Tan 2026.09.09", x: 0.658, y: 0.916, height: 11.8, rotation: 0 },
    { str: "13476 / 1", x: 0.868, y: 0.959, height: 17.2, rotation: 0 },
  ];
  assert.deepEqual(titleBlockLines(items), [
    "PORT ORE HANDLING - FINUCANE",
    "RECLAIMER - BWR7",
    "LOWER DECK PLC MARSHALLING PANEL M820C-X007",
    "SCHEMATIC DIAGRAM SHT 01",
  ]);
});

test("lines every drawing shares become the heading", () => {
  const a = drawing({
    id: "a",
    titleLines: ["PORT ORE HANDLING - FINUCANE", "CONVEYOR - CVR1", "415V MCC 101 (M101C) - LP101", "SCHEMATIC DIAGRAM"],
  });
  const b = drawing({
    id: "b",
    titleLines: ["PORT ORE HANDLING - FINUCANE", "CONVEYOR - CVR1", "415V MCC 101 (M101C) - COMMON CONTROLS", "SCHEMATIC DIAGRAM SHT 3"],
  });
  const c = drawing({ id: "c", title: "Typed title", titleLines: ["PORT ORE HANDLING - FINUCANE"] });
  const { heading, titles } = registerTitles([a, b]);
  assert.deepEqual(heading, ["PORT ORE HANDLING - FINUCANE", "CONVEYOR - CVR1"]);
  assert.equal(titles.get("a"), "415V MCC 101 (M101C) - LP101 · SCHEMATIC DIAGRAM");
  assert.equal(registerTitles([a]).titles.get("a"), "415V MCC 101 (M101C) - LP101 · SCHEMATIC DIAGRAM");
  assert.equal(registerTitles([a, c]).titles.get("c"), "Typed title");
});

test("whole tag matches the tag, not longer tags that start with it", () => {
  assert.equal(matchesIn("GREASE LP101 LOCAL CONTROL STATION", "lp101", false).length, 1);
  assert.equal(matchesIn("LP101-9520", "LP101", false).length, 1);
  assert.equal(matchesIn("LP101-9520", "LP101", true).length, 0);
  assert.equal(matchesIn("LP101_O_SV01", "LP101", true).length, 0);
  assert.equal(matchesIn("XLP101", "LP101", true).length, 0);
  assert.deepEqual(matchesIn("LP101 - UNDER CARRIAGE", "LP101", true), [[0, 5]]);
  assert.deepEqual(matchesIn("TO DB-2.", "DB-2", true), [[3, 7]]);
  assert.deepEqual(matchesIn("415V MCC 101 (M101C) - LP101", "LP101", true), [[23, 28]]);
  assert.deepEqual(matchesIn("a  b", "  ", false), []);
});

test("search counts every match and orders by most matches", () => {
  const set = [
    drawing({ id: "1", number: "K100-E-08055", pages: ["LP101 - UNDER CARRIAGE\nM101C-X002"] }),
    drawing({ id: "2", number: "K100-E-08056", pages: ["GREASE LP101 LOCAL CONTROL STATION\nLP101-9520\nLP101-16631"] }),
    drawing({ id: "3", number: "K100-E-12021", pages: ["COMMON CONTROLS"] }),
  ];
  const hits = searchDrawings(set, "lp101", false);
  assert.deepEqual(
    hits.map((hit) => [hit.drawing.number, hit.count]),
    [
      ["K100-E-08056", 3],
      ["K100-E-08055", 1],
    ]
  );
  assert.deepEqual(hits[0].snippet, { before: "GREASE ", match: "LP101", after: " LOCAL CONTROL STATION" });
  assert.deepEqual(
    searchDrawings(set, "LP101", true).map((hit) => [hit.drawing.number, hit.count]),
    [
      ["K100-E-08055", 1],
      ["K100-E-08056", 1],
    ]
  );
  assert.deepEqual(searchDrawings(set, "  ", false), []);
});

test("referenced drawings are numbers shaped like the set's, not yet uploaded", () => {
  const set = [
    drawing({
      number: "K100-E-08056",
      pages: ["M101C-W184\nLP101 LUBE PUMP STATION JUNCTION BOX\nK100-E-08069\nK100-E-08028\n008-E-12001\nLP101-9520\nK100-E-08055"],
    }),
    drawing({ number: "K100-E-08055", pages: ["K100-E-08069"] }),
  ];
  assert.deepEqual(referencedDrawings(set), ["K100-E-08028", "K100-E-08069"]);
});
