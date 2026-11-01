import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calloutRect,
  calloutStart,
  cloudPoints,
  createMarkup,
  isOutstanding,
  markupBounds,
  markupEmail,
  markupFileName,
  moveShape,
  nextMarkupNumber,
  padRect,
  scaleShape,
  shapeGeometry,
  shapeHit,
  textBox,
  wrapText,
  rememberRecipients,
  statusAfterSend,
} from "./drawingMarkups.ts";

test("an issue waits until fixed, a redline until sent", () => {
  assert.equal(isOutstanding({ kind: "issue", status: "open" }), true);
  assert.equal(isOutstanding({ kind: "issue", status: "sent" }), true);
  assert.equal(isOutstanding({ kind: "issue", status: "fixed" }), false);
  assert.equal(isOutstanding({ kind: "redline", status: "open" }), true);
  assert.equal(isOutstanding({ kind: "redline", status: "sent" }), false);
  assert.equal(statusAfterSend({ status: "open" }), "sent");
  assert.equal(statusAfterSend({ status: "fixed" }), "fixed");
});

test("numbers run on from the highest on the project", () => {
  assert.equal(nextMarkupNumber([]), 1);
  assert.equal(nextMarkupNumber([{ number: 2 }, { number: 7 }, { number: 3 }]), 8);
});

test("a new markup is open, on the drawing's number and revision, numbered after the project's", () => {
  const markup = createMarkup({
    drawing: { id: "drawing-1", projectId: "project-1", number: "085-E-13251", revision: "1" },
    page: 1,
    shapes: [{ type: "cloud", colour: "blue", from: [0.1, 0.1], to: [0.2, 0.2] }],
    details: { kind: "redline", title: "Spare core used for Q126", comment: "" },
    existing: [{ number: 4 }, { number: 9 }],
    by: "tester@example.com",
    id: "markup-1",
    now: "2026-10-24T00:00:00.000Z",
  });
  assert.equal(markup.number, 10);
  assert.equal(markup.status, "open");
  assert.equal(markup.drawingNumber, "085-E-13251");
  assert.equal(markup.drawingRevision, "1");
  assert.equal(markup.projectId, "project-1");
  assert.equal(markup.createdAt, markup.updatedAt);
  assert.deepEqual(markup.sends, []);
});

test("bounds cover every shape", () => {
  const bounds = markupBounds(
    [
      { type: "pen", colour: "red", points: [[0.2, 0.3], [0.25, 0.35]] },
      { type: "highlight", colour: "yellow", rects: [{ left: 0.5, top: 0.1, width: 0.05, height: 0.01 }] },
      { type: "box", colour: "red", from: [0.4, 0.6], to: [0.3, 0.5] },
    ],
    1.414
  );
  assert.ok(bounds);
  assert.deepEqual(
    [bounds.left, bounds.top, +(bounds.left + bounds.width).toFixed(3), bounds.top + bounds.height],
    [0.2, 0.1, 0.55, 0.6]
  );
  assert.equal(markupBounds([], 1), null);
  const padded = padRect({ left: 0.98, top: 0, width: 0.01, height: 0.1 }, 0.05, 1);
  assert.deepEqual([+padded.left.toFixed(3), padded.top, +(padded.left + padded.width).toFixed(3)], [0.93, 0, 1]);
});

test("a cloud bulges outward on every side", () => {
  const points = cloudPoints([0.2, 0.2], [0.4, 0.3], 1);
  const ys = points.map(([, y]) => y);
  const xs = points.map(([x]) => x);
  assert.ok(Math.min(...ys) < 0.2 && Math.max(...ys) > 0.3, "top and bottom bulge out");
  assert.ok(Math.min(...xs) < 0.2 && Math.max(...xs) > 0.4, "sides bulge out");
});

test("recipients are remembered newest first, once each, names kept", () => {
  const known = [
    { email: "draftie@acme.com.au", name: "Sam (drafting)" },
    { email: "eng@client.com", name: "" },
  ];
  const next = rememberRecipients(known, [
    { email: "ENG@client.com", name: "Client engineer" },
    { email: "DRAFTIE@acme.com.au", name: "" },
    { email: "not an email", name: "x" },
  ]);
  assert.deepEqual(next, [
    { email: "ENG@client.com", name: "Client engineer" },
    { email: "DRAFTIE@acme.com.au", name: "Sam (drafting)" },
  ]);
});

test("the email names the issues and asks for them back by number", () => {
  const { subject, note } = markupEmail({
    projectNumber: "J-0042",
    projectName: "CVR1 lube upgrade",
    markups: [
      {
        kind: "issue",
        number: 3,
        title: "Wrong drawing reference",
        comment: "M101C-W184 goes to K100-E-08069, not 08068",
        drawingNumber: "K100-E-08056",
        drawingRevision: "17",
      },
    ],
  });
  assert.equal(subject, "J-0042 · Drawing issue: K100-E-08056 rev 17 — Wrong drawing reference");
  assert.match(note, /quoting the issue number/);
  assert.match(note, /#3 issue on K100-E-08056 rev 17: Wrong drawing reference\n {3}M101C-W184/);
  assert.match(
    markupEmail({
      projectNumber: "J-1",
      projectName: "",
      markups: [
        { kind: "redline", number: 1, title: "a", comment: "", drawingNumber: "E-1", drawingRevision: "" },
        { kind: "redline", number: 2, title: "b", comment: "", drawingNumber: "E-2", drawingRevision: "" },
      ],
    }).subject,
    /^J-1 · 2 redline markups: E-1, E-2$/
  );
});

test("the sent copy is named after the drawing and its issues", () => {
  assert.equal(markupFileName("K100-E-08056_17 CODE A1.PDF", [4, 2]), "K100-E-08056_17 CODE A1 MARKUP #2 #4.pdf");
});

test("a callout's box goes where it was dragged to, on the side away from the tip", () => {
  const right = calloutRect([0.2, 0.5], [0.4, 0.5], 1);
  assert.equal(right.left, 0.4);
  assert.ok(Math.abs(right.top + right.height / 2 - 0.5) < 1e-9);
  const left = calloutRect([0.6, 0.5], [0.4, 0.5], 1);
  assert.ok(Math.abs(left.left + left.width - 0.4) < 1e-9);
  // Kept on the page.
  const edge = calloutRect([0.5, 0.5], [0.99, 0.01], 1);
  assert.ok(edge.left + edge.width <= 1 && edge.top >= 0);
});

test("a callout's arrow leaves its box's edge toward the tip, and is gone with the tip inside", () => {
  const rect = { left: 0.4, top: 0.4, width: 0.2, height: 0.1 };
  assert.deepEqual(calloutStart(rect, [0.1, 0.45], 1), [0.4, 0.45]);
  assert.equal(calloutStart(rect, [0.5, 0.45], 1), null);
  const geometry = shapeGeometry({ type: "callout", colour: "red", rect, tip: [0.1, 0.45], text: "Transposed" }, 1);
  assert.equal(geometry.kind, "callout");
  if (geometry.kind === "callout") assert.equal(geometry.lines.length, 2);
});

test("callout text wraps on words to the box, and breaks a word too long for it", () => {
  const measure = (text: string) => text.length;
  assert.deepEqual(wrapText("These were transposed and rectified", 12, measure), ["These were", "transposed", "and", "rectified"]);
  assert.deepEqual(wrapText("one\ntwo", 12, measure), ["one", "two"]);
  assert.deepEqual(wrapText("abcdefghij", 4, measure), ["abcd", "efgh", "ij"]);
});

test("a callout always has room for its arrow: a short drag, or the page's edge, never puts the box over the tip", () => {
  const clear = (rect: { left: number; top: number; width: number; height: number }, tip: [number, number]) =>
    calloutStart(rect, tip, 0.7) !== null;
  // Barely dragged.
  assert.ok(clear(calloutRect([0.5, 0.5], [0.501, 0.5], 0.7), [0.5, 0.5]));
  // Dragged toward the right edge from near it: the box would be pushed back over the tip.
  const edge = calloutRect([0.95, 0.5], [0.99, 0.5], 0.7);
  assert.ok(edge.left + edge.width <= 1);
  assert.ok(clear(edge, [0.95, 0.5]));
  // Straight up or down: the box still starts clear of the tip.
  assert.ok(clear(calloutRect([0.3, 0.6], [0.3, 0.3], 0.7), [0.3, 0.6]));
  // In a corner.
  assert.ok(clear(calloutRect([0.99, 0.01], [0.99, 0.01], 0.7), [0.99, 0.01]));
  for (const tip of [[0.01, 0.01], [0.99, 0.99], [0.01, 0.99], [0.5, 0.01]] as [number, number][]) {
    assert.ok(clear(calloutRect(tip, tip, 0.7), tip), `tip at ${tip}`);
  }
});

test("text is sized, and its box grows with its longest line and its lines", () => {
  const one = textBox({ at: [0.1, 0.1], text: "AB" }, 1);
  const big = textBox({ at: [0.1, 0.1], text: "AB", size: 2 }, 1);
  const two = textBox({ at: [0.1, 0.1], text: "AB\nABCD" }, 1);
  assert.ok(Math.abs(big.width - one.width * 2) < 1e-9);
  assert.ok(two.width > one.width && two.height > one.height);
  const geometry = shapeGeometry({ type: "text", colour: "red", at: [0, 0], text: "x", size: 3 }, 1);
  assert.equal(geometry.kind === "text" && geometry.size, 0.015);
});

test("a mark moves whole, and no further than the page's edge", () => {
  const box = { type: "box" as const, colour: "red" as const, from: [0.1, 0.1] as [number, number], to: [0.3, 0.2] as [number, number] };
  const moved = moveShape(box, 0.1, 0.1, 1);
  assert.ok(Math.abs(moved.from[0] - 0.2) < 1e-9 && Math.abs(moved.to[1] - 0.3) < 1e-9);
  const pushed = moveShape(box, 0.9, -0.5, 1);
  assert.ok(Math.abs(pushed.to[0] - 1) < 1e-9 && Math.abs(pushed.from[1]) < 1e-9);
  const callout = { type: "callout" as const, colour: "red" as const, rect: { left: 0.5, top: 0.5, width: 0.1, height: 0.05 }, tip: [0.4, 0.4] as [number, number], text: "x" };
  const shifted = moveShape(callout, 0.05, 0, 1);
  assert.ok(Math.abs(shifted.rect.left - 0.55) < 1e-9 && Math.abs(shifted.tip[0] - 0.45) < 1e-9);
});

test("a mark stretches to a new box; text grows with the box's width", () => {
  const cloud = { type: "cloud" as const, colour: "red" as const, from: [0.1, 0.1] as [number, number], to: [0.2, 0.3] as [number, number] };
  const out = scaleShape(cloud, { left: 0.1, top: 0.1, width: 0.1, height: 0.2 }, { left: 0.1, top: 0.1, width: 0.2, height: 0.4 });
  assert.ok(Math.abs(out.to[0] - 0.3) < 1e-9 && Math.abs(out.to[1] - 0.5) < 1e-9);
  const text = { type: "text" as const, colour: "red" as const, at: [0.1, 0.1] as [number, number], text: "Note" };
  const bounds = textBox(text, 1);
  assert.equal(scaleShape(text, bounds, { ...bounds, width: bounds.width * 2 }).size, 2);
});

test("a tap picks up a line along it, a box anywhere inside it", () => {
  const line = { type: "line" as const, colour: "red" as const, from: [0.1, 0.1] as [number, number], to: [0.5, 0.1] as [number, number] };
  assert.ok(shapeHit(line, [0.3, 0.105], 0.01, 1));
  assert.ok(!shapeHit(line, [0.3, 0.2], 0.01, 1));
  const box = { type: "box" as const, colour: "red" as const, from: [0.1, 0.1] as [number, number], to: [0.5, 0.5] as [number, number] };
  assert.ok(shapeHit(box, [0.3, 0.3], 0.01, 1));
  assert.ok(!shapeHit(box, [0.6, 0.6], 0.01, 1));
  const text = { type: "text" as const, colour: "red" as const, at: [0.1, 0.1] as [number, number], text: "Hello" };
  assert.ok(shapeHit(text, [0.11, 0.102], 0.001, 1));
});
