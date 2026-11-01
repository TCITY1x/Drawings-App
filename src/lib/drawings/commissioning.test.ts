import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentDrawing,
  distanceTo,
  findAsBuiltBox,
  handoverBlockers,
  hatchLines,
  inScope,
  revisionRows,
  nextRowDown,
  rowAt,
  tableGap,
  textRows,
  scopedPoints,
  projectKeys,
  revisionProjects,
  triangleFrom,
  trianglesFor,
  withProject,
  resultLabel,
  labelFromText,
  markPoint,
  moveToRevision,
  nextPending,
  packageEmail,
  packageFileName,
  packageProgress,
  ROW_WIRE_REACH,
  pointAt,
  pointProgress,
  sheetFileName,
  sheetState,
  signBlockers,
  snapSegment,
  type CheckPoint,
  type CommissioningPackage,
  type PackageSheet,
  type SheetText,
} from "./commissioning.ts";

function point(id: string, patch: Partial<CheckPoint> = {}): CheckPoint {
  return {
    id,
    page: 1,
    label: id,
    shape: { type: "trace", segments: [[[0.1, 0.5], [0.6, 0.5]]] },
    status: "pending",
    reading: "",
    note: "",
    testedBy: "",
    testedAt: "",
    faults: [],
    removal: false,
    triangle: "",
    row: false,
    ...patch,
  };
}

function sheet(points: CheckPoint[], patch: Partial<PackageSheet> = {}): PackageSheet {
  return {
    drawingId: "d1",
    drawingNumber: "F085-E-12086",
    drawingRevision: "13",
    drawingTitle: "Termination diagram sht 1",
    fileName: "F085-E-12086_13.pdf",
    points,
    signoff: null,
    stampAt: null,
    triangles: [],
    ...patch,
  };
}

const signoff = {
  tester: { name: "A", company: "Acme", detail: "", signature: "", at: "2026-10-20T00:00:00Z" },
  witness: null,
  instrument: { model: "", serial: "", calibrationDue: "" },
  signedBy: "a@x",
  signedAt: "2026-10-20T00:00:00Z",
};

test("progress counts each result, and a pass after a fault as rectified", () => {
  const failed = markPoint(point("a"), "fault", "me", "t1");
  const fixed = markPoint(failed, "pass", "me", "t2");
  const progress = pointProgress([fixed, point("b"), markPoint(point("c"), "na", "me", "t")]);
  assert.deepEqual(progress, { total: 3, pass: 1, fault: 0, na: 1, pending: 1, rectified: 1 });
  assert.equal(fixed.faults.length, 1);
  // Marking a fault twice in a row logs it once.
  assert.equal(markPoint(failed, "fault", "me", "t3").faults.length, 1);
  // Back to untested clears who tested it.
  assert.equal(markPoint(fixed, "pending", "me", "t4").testedBy, "");
});

test("a sheet's state follows its points, its sign-off and the register's revision", () => {
  const rev13 = { revision: "13" };
  assert.equal(sheetState(sheet([]), rev13), "not-started");
  assert.equal(sheetState(sheet([point("a")]), rev13), "not-started");
  assert.equal(sheetState(sheet([point("a", { status: "pass" }), point("b")]), rev13), "testing");
  assert.equal(sheetState(sheet([point("a", { status: "fault" })]), rev13), "testing");
  assert.equal(sheetState(sheet([point("a", { status: "pass" }), point("b", { status: "na" })]), rev13), "ready");
  assert.equal(sheetState(sheet([point("a", { status: "pass" })], { signoff }), rev13), "signed");
  assert.equal(sheetState(sheet([point("a", { status: "pass" })], { signoff }), { revision: "14" }), "stale");
  // Gone from the register: nothing to compare with, so not stale.
  assert.equal(sheetState(sheet([point("a", { status: "pass" })], { signoff }), null), "signed");
});

test("a sheet can't be signed with points left, an open fault, or a newer revision", () => {
  assert.deepEqual(signBlockers(sheet([point("a", { status: "pass" })]), { revision: "13" }), []);
  assert.equal(signBlockers(sheet([]), { revision: "13" }).length, 1);
  const blocked = signBlockers(sheet([point("a"), point("b", { status: "fault" })]), { revision: "14" });
  assert.equal(blocked.length, 3);
  assert.match(blocked[0], /rev 14/);
});

test("handover waits on every sheet", () => {
  const done = sheet([point("a", { status: "pass" })], { signoff });
  const pkg = { sheets: [done, sheet([point("b")], { drawingNumber: "X-2" })] } as CommissioningPackage;
  assert.deepEqual(handoverBlockers(pkg, () => ({ revision: "13" })), ["X-2 isn't signed yet."]);
  assert.deepEqual(handoverBlockers({ ...pkg, sheets: [done] }, () => ({ revision: "13" })), []);
  assert.equal(handoverBlockers({ ...pkg, sheets: [] }, () => null).length, 1);
  const progress = packageProgress(pkg);
  assert.equal(progress.sheets, 2);
  assert.equal(progress.signed, 1);
});

test("the next point to test goes round from the one just done", () => {
  const points = [point("a", { status: "pass" }), point("b"), point("c", { status: "pass" }), point("d")];
  assert.equal(nextPending(points, "b")?.id, "d");
  assert.equal(nextPending(points, "d")?.id, "b");
  assert.equal(nextPending(points, null)?.id, "b");
  assert.equal(nextPending([point("a", { status: "pass" })], "a"), null);
});

test("moving to a new revision keeps the points but clears results and sign-off", () => {
  const moved = moveToRevision(
    sheet([point("a", { status: "pass", testedBy: "me", reading: "0.2" })], { signoff }),
    { id: "d2", number: "F085-E-12086", revision: "14", fileName: "F085-E-12086_14.pdf" },
    ""
  );
  assert.equal(moved.drawingId, "d2");
  assert.equal(moved.drawingRevision, "14");
  assert.equal(moved.drawingTitle, "Termination diagram sht 1");
  assert.equal(moved.signoff, null);
  assert.equal(moved.points[0].status, "pending");
  assert.equal(moved.points[0].reading, "");
  assert.equal(moved.points.length, 1);
});

test("the register's drawing is the same entry, else the one that replaced it", () => {
  const drawings = [
    { id: "d2", number: "f085-e-12086", revision: "14" },
    { id: "d9", number: "OTHER", revision: "1" },
  ];
  assert.equal(currentDrawing(sheet([]), drawings)?.id, "d2");
  assert.equal(currentDrawing(sheet([], { drawingId: "d9" }), drawings)?.id, "d9");
  assert.equal(currentDrawing(sheet([], { drawingNumber: "GONE", drawingId: "x" }), drawings), null);
});

test("a dragged line snaps square when it's nearly across or down", () => {
  assert.deepEqual(snapSegment([0.1, 0.5], [0.6, 0.52], 1), [[0.1, 0.5], [0.6, 0.5]]);
  assert.deepEqual(snapSegment([0.1, 0.1], [0.11, 0.6], 1), [[0.1, 0.1], [0.1, 0.6]]);
  assert.deepEqual(snapSegment([0.1, 0.1], [0.5, 0.5], 1), [[0.1, 0.1], [0.5, 0.5]]);
  // Leftwards counts as across too.
  assert.deepEqual(snapSegment([0.6, 0.5], [0.1, 0.51], 1), [[0.6, 0.5], [0.1, 0.5]]);
});

test("a tap picks the nearest point within reach, wires before the area they sit in", () => {
  const wire = point("wire", { shape: { type: "trace", segments: [[[0.2, 0.5], [0.4, 0.5]]] } });
  const area = point("area", { shape: { type: "area", rect: { left: 0.1, top: 0.4, width: 0.4, height: 0.2 } } });
  assert.equal(distanceTo(area.shape, [0.2, 0.45], 1), 0);
  assert.equal(pointAt([area, wire], 1, [0.3, 0.502], 1)?.id, "wire");
  assert.equal(pointAt([area, wire], 1, [0.15, 0.58], 1)?.id, "area");
  assert.equal(pointAt([area, wire], 1, [0.9, 0.9], 1), null);
  assert.equal(pointAt([area, wire], 2, [0.3, 0.5], 1), null);
});

test("a label is read off the text under a point", () => {
  assert.equal(labelFromText(["B1_I.14", "33031", "X2"]), "33031");
  assert.equal(labelFromText(["STL010_I_ZS06"]), "STL010_I_ZS06");
  assert.equal(labelFromText(["NE SLOUGH LIMIT"]), "NE SLOUGH LIMIT");
  assert.equal(labelFromText(["  "]), "");
});

test("file names and the email name the package and its sheets", () => {
  assert.equal(packageFileName({ name: "Marshalling", panelTag: "M853C-X002" }), "M853C-X002 P2P package.pdf");
  assert.equal(packageFileName({ name: "A/B", panelTag: "" }), "A-B P2P package.pdf");
  assert.equal(sheetFileName({ fileName: "F085-E-12086_13.pdf", drawingNumber: "F085-E-12086" }), "F085-E-12086_13 P2P signed.pdf");
  const pkg = {
    name: "Marshalling",
    panelTag: "M853C-X002",
    sheets: [sheet([markPoint(markPoint(point("a"), "fault", "me", "t"), "pass", "me", "t2")], { signoff })],
  } as CommissioningPackage;
  const email = packageEmail({ projectNumber: "P-1042", projectName: "Conveyor", pkg });
  assert.match(email.subject, /M853C-X002 \(1 sheet, signed\)/);
  assert.match(email.note, /1 of 1 points tested\. 1 fault was rectified/);
  assert.match(email.note, /F085-E-12086 rev 13 — Termination diagram sht 1/);
});

test("the title block's commissioning as-built box is found by its labels", () => {
  const at = (str: string, left: number, top: number): SheetText => ({ str, left, top, width: 0.03, height: 0.004 });
  const texts = [
    at("COMMISSIONING AS-BUILT (BLUE INK)", 0.01, 0.9),
    at("COMPANY", 0.01, 0.915),
    at("SIGNATURE", 0.01, 0.93),
    at("NAME", 0.01, 0.945),
    at("PROJECT CODE", 0.01, 0.96),
    at("DRAWING MARKED UP", 0.02, 0.975),
    // Another block's labels, well to the right, aren't it.
    at("COMPANY", 0.6, 0.915),
  ];
  const box = findAsBuiltBox(texts);
  assert.ok(box);
  assert.equal(box.company?.left, 0.01);
  assert.equal(box.projectCode?.top, 0.96);
  assert.equal(box.markedUp?.str, "DRAWING MARKED UP");
  assert.equal(findAsBuiltBox(texts.slice(1)), null);
  assert.equal(findAsBuiltBox([texts[0], texts[1]]), null);
});

test("a hatched cloud that passes reads as removed, and is hatched inside its box", () => {
  assert.equal(resultLabel({ status: "pass", removal: true }), "Removed");
  assert.equal(resultLabel({ status: "pass", removal: false }), "Pass");
  assert.equal(resultLabel({ status: "fault", removal: true }), "Fault");
  const rect = { left: 0.1, top: 0.1, width: 0.1, height: 0.05 };
  const lines = hatchLines(rect, 1, 0.01);
  assert.ok(lines.length > 5);
  for (const [a, b] of lines) {
    for (const [x, y] of [a, b]) {
      assert.ok(x >= 0.1 - 1e-9 && x <= 0.2 + 1e-9 && y >= 0.1 - 1e-9 && y <= 0.15 + 1e-9);
    }
    // 45° on the sheet: as far across as down.
    assert.ok(Math.abs(Math.abs(b[0] - a[0]) - Math.abs(b[1] - a[1])) < 1e-9);
  }
});

test("the revision table is read from the page's runs, split or joined", () => {
  const text = [
    "COMMISSIONING AS-BUILT",
    "7",
    "08.06.20",
    "PE2040 - MOC INSTALL OFFLINE CJC FILTRATION",
    "AS BUILT - NO CHANGE",
    "11 24.10.24 PE03826 PI980 BLOCKED CHUTE SWITCH",
    "ISSUED FOR CONSTRUCTION",
    "13",
    "13.08.26",
    "AP03135 - POD WEST YARD ANTICOLLISION",
    "9",
    "25.01.23",
    "PE2040 - WIND FENCES",
    "BHP",
  ].join("\n");
  const rows = revisionRows(text);
  assert.deepEqual(rows.map((row) => row.n), ["7", "9", "11", "13"]);
  assert.equal(rows[0].date, "08.06.20");
  assert.equal(rows[0].text, "PE2040 - MOC INSTALL OFFLINE CJC FILTRATION — AS BUILT - NO CHANGE");
  assert.equal(rows[2].text, "PE03826 PI980 BLOCKED CHUTE SWITCH — ISSUED FOR CONSTRUCTION");
  // A project can own several triangles; several codes can be given.
  assert.deepEqual(trianglesFor(rows, "pe2040"), ["7", "9"]);
  assert.deepEqual(trianglesFor(rows, "PE2040, AP03135"), ["7", "9", "13"]);
  assert.deepEqual(trianglesFor(rows, ""), []);
});

test("triangles are picked by project: each drawing numbers its own", () => {
  const rows = [
    { n: "0", date: "01.02.21", text: "PE03260 - PORT ELECTRICAL REDLINES — ISSUED FOR CONSTRUCTION" },
    { n: "1", date: "05.07.22", text: "PE03260 - PORT ELECTRICAL REDLINES — AS BUILT" },
    { n: "2", date: "13.08.25", text: "ENGULFMENT RISK REDUCTION — ISSUED FOR CONSTRUCTION" },
    { n: "3", date: "20.10.26", text: "ENGULFMENT RISK REDUCTION — AS BUILT" },
    { n: "4", date: "21.10.26", text: "" },
  ];
  assert.deepEqual(
    revisionProjects(rows).map(({ key, label, triangles }) => ({ key, label, triangles })),
    [
      { key: "PE3260", label: "PE03260 - PORT ELECTRICAL REDLINES", triangles: ["0", "1"] },
      { key: "ENGULFMENT RISK REDUCTION", label: "ENGULFMENT RISK REDUCTION", triangles: ["2", "3"] },
      { key: "Δ4", label: "Revision 4", triangles: ["4"] },
    ]
  );
  // A project picked on one sheet is the package's: another sheet numbers it differently.
  const code = withProject("", "ENGULFMENT RISK REDUCTION", true);
  assert.deepEqual(trianglesFor(rows, code), ["2", "3"]);
  const next = [
    { n: "5", date: "", text: "ENGULFMENT RISK REDUCTION — ISSUED FOR CONSTRUCTION" },
    { n: "6", date: "", text: "PE03260 PORT ELECTRICAL" },
  ];
  assert.deepEqual(trianglesFor(next, code), ["5"]);
  assert.equal(withProject(code, "PE03260", true), "ENGULFMENT RISK REDUCTION, PE03260");
  assert.deepEqual(projectKeys(withProject(code, "PE03260", true)), ["ENGULFMENT RISK REDUCTION", "PE3260"]);
  assert.equal(withProject("PE03260, ENGULFMENT RISK REDUCTION", "PE03260", false), "ENGULFMENT RISK REDUCTION");
  assert.deepEqual(projectKeys("PE2040 AP03135"), ["PE2040", "AP3135"]);
});

test("084-E-12756's revision table: projects by code, a name above its code, a double-alpha revision", () => {
  // As pdf.js reads it off the sheet.
  const text = [
    "PARADIGM ENG",
    "3AB",
    "23.09.26",
    "AP03135 - POD WEST YARD ANTICOLLISION",
    "ISSUED FOR CONSTRUCTION",
    "0",
    "22.10.20",
    "PE03260 - PORT ELECTRICAL REDLINES",
    "ISSUED FOR CONSTRUCTION",
    "1",
    "21.01.22",
    "PE03260 - PORT ELECTRICAL REDLINES",
    "AS BUILT",
    "2",
    "15.04.25",
    "ENGULFMENT RISK REDUCTION",
    "PE04046 - SLEW STRIKER DESIGN STK10 AND STK12",
    "ISSUED FOR CONSTRUCTION",
    "3",
    "28.07.25",
    "ENGULFMENT RISK REDUCTION",
    "PE04046 - SLEW STRIKER DESIGN STK10 AND STK12",
    "RE-ISSUED FOR CONSTRUCTION",
    "BHPIO",
    "15",
  ].join("\n");
  const rows = revisionRows(text);
  assert.deepEqual(rows.map((row) => row.n), ["0", "1", "2", "3", "3AB"]);
  assert.deepEqual(
    revisionProjects(rows).map(({ key, label, triangles }) => ({ key, label, triangles })),
    [
      { key: "PE3260", label: "PE03260 - PORT ELECTRICAL REDLINES", triangles: ["0", "1"] },
      { key: "PE4046", label: "PE04046 - SLEW STRIKER DESIGN STK10 AND STK12", triangles: ["2", "3"] },
      { key: "AP3135", label: "AP03135 - POD WEST YARD ANTICOLLISION", triangles: ["3AB"] },
    ]
  );
  assert.deepEqual(trianglesFor(rows, "PE04046"), ["2", "3"]);
  // The next drawing types the same project with a letter O.
  assert.deepEqual(trianglesFor([{ n: "9AB", date: "23.09.26", text: "APO3135 - POD WEST YARD ANTICOLLISION" }], "AP03135"), ["9AB"]);
  // The cloud on the sheet tagged 3AB.
  assert.equal(triangleFrom(["LINE 3351", "3AB"], rows), "3AB");
});

test("a project is its first code — not a drawing number, nor a project a later line mentions", () => {
  const rows = [
    { n: "3", date: "", text: "APPROVED FOR CONSTRUCTION - SFPORT — BHPIO — F080-E-12590" },
    { n: "4", date: "", text: "FX00.C.96254.0200 - EOL REPLACEMENT PROJECT - CSP2 — AS BUILT - NEED AS BUILT FOR PE1299 PROJECT" },
    { n: "5", date: "", text: "PE1299 - P801 DRIVEN IDLER TRIAL - REMOVAL — APPROVED FOR CONSTRUCTION" },
    { n: "6", date: "", text: "SFPORT - FX00.C.90022.4000 — AS BUILT - NO CHANGE" },
    { n: "7", date: "", text: "PORT PCN CORE SWITCH REFRESH - TP03040 — ISSUED FOR CONSTRUCTION" },
    { n: "8", date: "", text: "TP03040 - T PCN CORE SWITCH REFRESH — PROJECT NOT PROCEEDING" },
  ];
  assert.deepEqual(
    revisionProjects(rows).map(({ code, triangles }) => ({ code, triangles })),
    [
      { code: "APPROVED FOR CONSTRUCTION - SFPORT", triangles: ["3"] },
      { code: "FX00.C.96254.0200", triangles: ["4"] },
      { code: "PE1299", triangles: ["5"] },
      { code: "FX00.C.90022.4000", triangles: ["6"] },
      { code: "TP03040", triangles: ["7", "8"] },
    ]
  );
  assert.deepEqual(trianglesFor(rows, "PE1299"), ["5"]);
});

test("a cloud's triangle is the one revision number beside it", () => {
  const rows = [
    { n: "3", date: "", text: "" },
    { n: "5", date: "", text: "" },
  ];
  // "22" is an item balloon, not a revision.
  assert.equal(triangleFrom(["22", "5", "SECTION 1"], rows), "5");
  assert.equal(triangleFrom(["22"], rows), "");
  assert.equal(triangleFrom(["3", "5"], rows), "");
});

test("only this project's triangles count", () => {
  const ours = point("ours", { triangle: "3", status: "pass" });
  const theirs = point("theirs", { triangle: "5" });
  const untagged = point("untagged", { status: "pass" });
  const scoped = sheet([ours, theirs, untagged], { triangles: ["3", "7"] });
  assert.equal(inScope(theirs, scoped), false);
  assert.equal(inScope(untagged, scoped), true);
  assert.deepEqual(scopedPoints(scoped).map((p) => p.id), ["ours", "untagged"]);
  // The other project's untested cloud doesn't hold up sign-off.
  assert.equal(sheetState(scoped, { revision: "13" }), "ready");
  // Not narrowed down: everything counts.
  assert.equal(sheetState({ ...scoped, triangles: [] }, { revision: "13" }), "testing");
});

test("a termination table's text is grouped into rows, one per terminal", () => {
  // Two tables side by side, three terminals each, cells as separate runs
  // spread well apart, as on a drawing.
  const run = (str: string, left: number, top: number, width = 0.02) => ({ str, box: { left, top, width, height: 0.008 } });
  const runs = [];
  for (const [i, wire] of ["30621", "22022", "22041"].entries()) {
    const top = 0.3 + i * 0.012;
    // Real runs wobble a little in height on the same line.
    runs.push(run(["D75", "A117", "B106"][i], 0.1, top), run(`${i}`, 0.145, top + 0.0005, 0.005), run(`IN${i}`, 0.17, top), run(wire, 0.225, top - 0.0004));
    runs.push(run(`3210${i}`, 0.5, top), run(`OUT${i}`, 0.545, top));
  }
  // Cut to one table, every line is one row.
  const left = runs.filter((one) => one.box.left < 0.4);
  const rows = textRows(left);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].texts, ["D75", "0", "IN0", "30621"]);
  // Rows don't overlap the next one down.
  assert.ok(rows[0].rect.top + rows[0].rect.height <= rows[1].rect.top + 1e-9);
  // Both tables at once: the gap between them is told from the cells' spacing.
  const gap = tableGap(runs);
  assert.ok(gap > 0.025 && gap < 0.2, `gap ${gap}`);
  const both = textRows(runs, gap);
  assert.equal(both.length, 6);
  assert.deepEqual(both[1].texts, ["32100", "OUT0"]);
  // A tap on a row finds that row; a tap in the margin finds none.
  assert.deepEqual(rowAt(runs, [0.15, 0.316], 1, gap)?.texts, ["A117", "1", "IN1", "22022"]);
  assert.equal(rowAt(runs, [0.9, 0.9], 1, gap), null);
});

test("a terminal row is labelled by its wire number, and pass goes down the strip", () => {
  assert.equal(labelFromText(["A121", "5", "IN5", "22092"]), "22092");
  assert.equal(labelFromText(["A121", "5", "IN5"]), "A121");
  const rowPoint = (id: string, top: number, left = 0.1, status: CheckPoint["status"] = "pending") =>
    point(id, { row: true, status, shape: { type: "area", rect: { left, top, width: 0.2, height: 0.01 } } });
  // Added out of order: row 1, row 6, then rows 2–3; and a row of the next table along.
  const points = [rowPoint("r1", 0.3, 0.1, "pass"), rowPoint("r6", 0.36), rowPoint("r2", 0.31), rowPoint("r3", 0.32), rowPoint("other", 0.305, 0.5)];
  assert.equal(nextRowDown(points, points[0])?.id, "r2");
  assert.equal(nextRowDown(points, points[1]), null);
  assert.equal(nextRowDown(points, point("wire")), null);
});

test("a ROW tap between two rows already added picks neither — it's for the row under it", () => {
  // As drawn on 085-E-13253: rows 0.0101 of the page apart and 0.00878 tall, on an A3 landscape sheet.
  const aspect = 1.4555;
  const row = (id: string, top: number) => point(id, { shape: { type: "area", rect: { left: 0.0305, top, width: 0.1911, height: 0.00878 } } });
  const above = row("13", 0.1973);
  const below = row("15", 0.2175);
  const jumper = point("jumper", { shape: { type: "trace", segments: [[[0.2346, 0.2073], [0.2346, 0.2416]]] } });
  const points = [above, below, jumper];
  // Row 14 runs 0.2074–0.2162: near its top and its bottom, the old reach took the tap for a neighbour.
  for (const y of [0.2078, 0.2118, 0.2158]) {
    assert.ok(pointAt(points, 1, [0.1, 0.2078], aspect) !== null, "the usual reach picks a neighbour near the edge");
    assert.equal(pointAt(points, 1, [0.1, y], aspect, ROW_WIRE_REACH, true), null);
  }
  // Inside a row, or right on the jumper, still picks it.
  assert.equal(pointAt(points, 1, [0.1, 0.2010], aspect, ROW_WIRE_REACH, true)?.id, "13");
  assert.equal(pointAt(points, 1, [0.2350, 0.2118], aspect, ROW_WIRE_REACH, true)?.id, "jumper");
  // The row's own number, a fingertip from the jumper, is still the row's.
  assert.equal(pointAt(points, 1, [0.2156, 0.2118], aspect, ROW_WIRE_REACH, true), null);
});
