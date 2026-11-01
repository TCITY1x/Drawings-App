"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AArrowDown, AArrowUp, Check, Pencil, Trash2, X } from "lucide-react";
import {
  CALLOUT_MIN,
  CALLOUT_PAD,
  HIGHLIGHTER,
  INK,
  PEN_STEP,
  STROKE,
  TEXT_SCALE,
  calloutRect,
  markupBounds,
  moveShape,
  scaleShape,
  shapeGeometry,
  shapeHit,
  textBox,
  textSize,
  tooSmall,
  type DrawingMarkup,
  type InkColour,
  type MarkupShape,
  type MarkupTool,
  type Point,
  type Rect,
} from "@/lib/drawings/drawingMarkups";
import { paintShapes } from "@/lib/drawings/drawingMarkupExport";
import { snapSegment } from "@/lib/drawings/commissioning";
import { cn } from "@/lib/cn";

/**
 * Markups over a drawing, and drawing new ones.
 *
 * Laid exactly over the rendered page, in page fractions, so everything
 * scales with the zoom like ink on the sheet. The SVG's units are a
 * thousandth of the page's width — `UNITS` across by `UNITS / aspect` down —
 * which keeps clouds round and strokes even on any sheet size. Not page
 * fractions themselves: Safari rounds SVG geometry far too coarsely for a
 * line a thousandth of a unit wide, and drew arrows as slivers, or nothing.
 *
 * While marking up, every pointer — mouse, finger or pencil — draws with the
 * tool in hand; a second finger landing gives up the stroke so two fingers
 * always pinch and pan the sheet. The hand tool pans. "Highlight text" drags
 * a box and snaps it to the text runs it touches, using the same text
 * positions the search uses.
 *
 * The select tool picks up any mark on the page — in the markup being made,
 * or saved — with a tap: drag it to move it, its corner grip to resize it, a
 * callout's tip grip to move what its arrow points at. Tapping empty sheet
 * lets go and pans. Text and callouts just placed come up selected.
 *
 * Typing — and what to do with what's selected (edit, size, delete) — happens
 * in a bar of its own under the tools (`dock`), never over the sheet: its
 * text is phone-sized, so iOS doesn't zoom the page to it, and it can't be
 * lost off the side of a zoomed sheet. The text shows on the sheet as it's
 * typed. A saved one's change is kept at once (`onMarkupChange`).
 *
 * A callout is dragged from what it points at to where its box goes, then
 * typed in. Its box is HTML — white, so it reads over the drawing, its text
 * wrapping inside it — sized in page widths (`cqw`) so it scales with the
 * sheet; only its arrow is in the SVG.
 */

/** A length in page widths, as CSS — the layer is a size container, so `cqw` is a hundredth of the page's width. */
const cqw = (widths: number) => `${widths * 100}cqw`;

/** Callouts are red or blue: yellow text on a white box can't be read. */
const calloutInk = (colour: InkColour): InkColour => (colour === "yellow" ? "red" : colour);

/** How far a tap can miss a mark and still pick it up, in screen pixels. */
const REACH_PX = 14;

/** Lines on screen are never thinner than this many pixels, whatever the zoom. */
const THINNEST_PX = 1.5;

/** The magnifier's size in CSS pixels, and how much it magnifies — as on a point-to-point sheet. */
const LOUPE = 168;
const LOUPE_ZOOM = 3;

/** The bar under the tools — one height whatever it holds, so the sheet never jumps as it changes. */
const BAR = "flex h-[3.25rem] shrink-0 items-center gap-1 border-b border-orange-200 bg-orange-50 px-3 dark:border-orange-500/30 dark:bg-orange-500/10";

/** What the bar says while nothing is being typed or is selected: how the tool in hand works. */
const HINT: Partial<Record<LayerTool, string>> = {
  select: "Tap a mark to move, resize, edit or delete it. Drag empty sheet to move around.",
  pan: "Drag to move around the sheet.",
  text: "Tap where the text goes.",
  callout: "Drag from what it's about to where the note goes.",
  highlight: "Drag over the words to highlight.",
};

/** Each press of a size button grows or shrinks text by this much. */
const SIZE_STEP = 1.25;

const NAME: Record<MarkupShape["type"], string> = {
  pen: "Pen",
  highlight: "Highlight",
  line: "Line",
  arrow: "Arrow",
  box: "Box",
  cloud: "Cloud",
  text: "Text",
  callout: "Callout",
};

type Callout = Extract<MarkupShape, { type: "callout" }>;

/** What a callout's box looks like on screen — the same whether shown, being dragged, or typed in. */
function calloutStyle(shape: Callout): React.CSSProperties {
  const { left, top, width, height } = shape.rect;
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    padding: cqw(CALLOUT_PAD),
    fontSize: cqw(textSize(shape)),
    lineHeight: 1.2,
    fontFamily: "Helvetica, Arial, sans-serif",
    color: INK[shape.colour].hex,
    borderColor: INK[shape.colour].hex,
    borderWidth: `max(1px, ${cqw(STROKE)})`,
  };
}

/** A callout's box with its text, as saved. */
function CalloutBox({ shape, className, ...rest }: { shape: Callout } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn("pointer-events-none absolute overflow-hidden whitespace-pre-wrap break-words border-solid bg-white", className)}
      style={calloutStyle(shape)}
    >
      {shape.text}
    </div>
  );
}

export type LayerTool = MarkupTool | "pan" | "select";

/** SVG units across the page — see the note at the top. */
const UNITS = 1000;

/** A point in page fractions as SVG coordinates. */
const svgPoints = (line: Point[], aspect: number) => line.map(([x, y]) => `${x * UNITS},${(y / aspect) * UNITS}`).join(" ");

/**
 * One shape in the SVG. `thinnest` is the least stroke width, in page widths,
 * so a line stays plain to see however far out the sheet is zoomed — the PDF
 * keeps its true width.
 */
function Shape({ shape, aspect, thinnest = 0 }: { shape: MarkupShape; aspect: number; thinnest?: number }) {
  const geometry = shapeGeometry(shape, aspect);
  const colour = INK[shape.colour].hex;
  if (geometry.kind === "fill") {
    return (
      <>
        {geometry.rects.map((rect, index) => (
          <rect
            key={index}
            x={rect.left * UNITS}
            y={(rect.top / aspect) * UNITS}
            width={rect.width * UNITS}
            height={(rect.height / aspect) * UNITS}
            fill={colour}
            fillOpacity={0.4}
          />
        ))}
      </>
    );
  }
  if (geometry.kind === "callout") {
    // The arrow only — the box is HTML, over the SVG (see `CalloutBox`).
    return (
      <>
        {geometry.lines.map((line, index) => (
          <polyline
            key={index}
            points={svgPoints(line, aspect)}
            fill="none"
            stroke={colour}
            strokeWidth={Math.max(STROKE, thinnest) * UNITS}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </>
    );
  }
  if (geometry.kind === "text") {
    // `at` is the top-left of the text. The first baseline is placed most of a
    // line below it — as in the PDF — rather than with `dominant-baseline`,
    // which Safari doesn't pass down to the tspans and so drew the text a line
    // too high, above its box.
    return (
      <text
        x={geometry.at[0] * UNITS}
        y={(geometry.at[1] / aspect + geometry.size * 0.85) * UNITS}
        fill={colour}
        fontSize={geometry.size * UNITS}
        fontFamily="Helvetica, Arial, sans-serif"
      >
        {geometry.text.split("\n").map((line, index) => (
          <tspan key={index} x={geometry.at[0] * UNITS} dy={index === 0 ? 0 : geometry.size * 1.2 * UNITS}>
            {line}
          </tspan>
        ))}
      </text>
    );
  }
  return (
    <>
      {geometry.lines.map((line, index) => {
        const points = svgPoints(line, aspect);
        const common = {
          points,
          fill: "none",
          stroke: colour,
          strokeWidth: (geometry.highlighter ? HIGHLIGHTER : Math.max(STROKE, thinnest)) * UNITS,
          strokeOpacity: geometry.highlighter ? 0.4 : 1,
          strokeLinecap: "round" as const,
          strokeLinejoin: "round" as const,
        };
        return geometry.closed ? <polygon key={index} {...common} /> : <polyline key={index} {...common} />;
      })}
    </>
  );
}

/** The shapes that are typed in: text and callouts. */
type Typed = Extract<MarkupShape, { type: "text" | "callout" }>;

const typed = (shape: MarkupShape): shape is Typed => shape.type === "text" || shape.type === "callout";

/** A mark on the sheet, where it came from, and how to keep a change to it (null: remove it). */
interface Placed {
  key: string;
  shape: MarkupShape;
  faded: boolean;
  /** The only mark its saved markup has: it can be changed but not removed. */
  sole: boolean;
  commit?: (shape: MarkupShape | null) => void;
}

/** A mark's box on the sheet — for text, the box its words take. */
const boundsOf = (shape: MarkupShape, aspect: number): Rect | null =>
  shape.type === "text" ? textBox(shape, aspect) : markupBounds([shape], aspect);

export function MarkupLayer({
  aspect,
  markups,
  draft,
  tool,
  colour,
  active,
  focusId,
  dock,
  onShape,
  onDraftChange,
  onMarkupChange,
  snapText,
  onPick,
}: {
  aspect: number;
  /** Saved markups on this page. */
  markups: DrawingMarkup[];
  /** Shapes drawn so far for the markup being made. */
  draft: MarkupShape[];
  tool: LayerTool;
  colour: InkColour;
  /** Marking up: pointers draw instead of pan, and marks can be selected. */
  active: boolean;
  focusId: string | null;
  /** Where the typing and selection bar goes — off the sheet, under the tools. */
  dock?: HTMLElement | null;
  onShape: (shape: MarkupShape) => void;
  /** A shape in the markup being made changed — moved, resized or retyped — or, given null, removed. */
  onDraftChange?: (index: number, shape: MarkupShape | null) => void;
  /** A saved markup's shape moved, resized, retyped or removed: the markup as it is now, to keep. */
  onMarkupChange?: (markup: DrawingMarkup) => void;
  /** The text boxes a dragged box touches, for "highlight text". */
  snapText: (rect: Rect) => Rect[];
  onPick?: (markup: DrawingMarkup) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<MarkupShape | null>(null);
  const start = useRef<Point | null>(null);
  /**
   * The one pointer drawing or dragging, if any. Only its moves count, and
   * a second finger landing (a pinch) drops what it began.
   * Nothing else is kept per pointer, so a finger lifted off the sheet — where
   * its lift is never heard — can't leave the layer thinking one is still down.
   */
  const stroke = useRef<number | null>(null);
  /** Where the drawing pointer is, and whether it's a finger or pencil — a mouse needs no magnifier. */
  const tip = useRef<{ point: Point; magnify: boolean } | null>(null);
  const loupe = useRef<HTMLDivElement>(null);
  const loupeCanvas = useRef<HTMLCanvasElement>(null);
  /** The page's width on screen, in pixels — for keeping lines visible at any zoom. */
  const [shownWidth, setShownWidth] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setShownWidth(el.getBoundingClientRect().width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const thinnest = shownWidth > 0 ? THINNEST_PX / shownWidth : 0;
  /** The mark picked up with the select tool, by key. */
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * Text or a callout being typed in: a new one (no key) or one already on
   * the sheet. Mirrored in a ref so it's only ever kept once, whichever of
   * Done, Enter, a tap elsewhere or the box losing focus gets there first.
   */
  const [editing, setEditingState] = useState<{ key: string | null; shape: Typed } | null>(null);
  const editingNow = useRef<typeof editing>(null);
  const setEditing = (next: typeof editing) => {
    editingNow.current = next;
    setEditingState(next);
  };
  /** A mark being dragged: which, by what, where the pointer started, and the shape as it is now. */
  const [handling, setHandling] = useState<{
    key: string;
    part: "move" | "size" | "tip";
    from: Point;
    was: MarkupShape;
    bounds: Rect;
    shape: MarkupShape;
    moved: boolean;
    /** Already selected when picked up: a tap on it then edits its text. */
    again: boolean;
  } | null>(null);

  /**
   * A saved one changed, shown as it was left while the save goes through —
   * until the markup comes back changed (its shape no longer the one it was),
   * so it doesn't jump back meanwhile.
   */
  const [kept, setKept] = useState<Record<string, { was: MarkupShape; shape: MarkupShape }>>({});

  const interactive = active && tool !== "pan";
  const ink: InkColour = tool === "highlight" ? "yellow" : colour;

  const at = (event: { clientX: number; clientY: number }): Point => {
    const box = host.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    ];
  };

  /** Every mark on the page — saved, and in the markup being made — and how a change to each is kept. */
  const placed: Placed[] = [
    ...markups.flatMap((markup) =>
      markup.shapes.map(
        (shape, index): Placed => ({
          key: `${markup.id}:${index}`,
          shape,
          faded: markup.status === "fixed",
          sole: markup.shapes.length === 1,
          commit: onMarkupChange
            ? (next) => {
                // A markup is never left with nothing.
                if (!next && markup.shapes.length === 1) return;
                const key = `${markup.id}:${index}`;
                if (next) setKept((all) => ({ ...all, [key]: { was: shape, shape: next } }));
                // On top of any of its other changes still being saved, so this one doesn't undo them.
                const latest = markup.shapes.map((one, i) => {
                  const held = kept[`${markup.id}:${i}`];
                  return held && held.was === one ? held.shape : one;
                });
                const shapes = next ? latest.map((one, i) => (i === index ? next : one)) : latest.filter((_, i) => i !== index);
                onMarkupChange({ ...markup, shapes, updatedAt: new Date().toISOString() });
              }
            : undefined,
        })
      )
    ),
    ...draft.map(
      (shape, index): Placed => ({
        key: `draft:${index}`,
        shape,
        faded: false,
        sole: false,
        commit: onDraftChange ? (next) => onDraftChange(index, next) : undefined,
      })
    ),
  ];
  const commitFor = (key: string) => placed.find((one) => one.key === key)?.commit;
  /** A shape as it shows now: where it's being dragged to, if it is. */
  const current = (key: string, shape: MarkupShape): MarkupShape =>
    handling?.key === key ? handling.shape : kept[key]?.was === shape ? kept[key].shape : shape;
  /** The one being typed in, if any — drawn as it's being typed instead. */
  const editingKey = editing?.key ?? null;
  const chosen = active ? placed.find((one) => one.key === selected && one.commit) : undefined;
  const chosenShape = chosen ? current(chosen.key, chosen.shape) : null;

  /** Keep what's being typed — a new one added and selected, an old one changed (or, emptied, removed). */
  const finishEditing = () => {
    const was = editingNow.current;
    if (!was) return;
    setEditing(null);
    const { key, shape } = was;
    const kept = shape.text.trim() ? shape : null;
    if (key === null) {
      if (!kept) return;
      onShape(kept);
      setSelected(`draft:${draft.length}`);
    } else {
      commitFor(key)?.(kept);
      if (!kept) setSelected(null);
    }
  };

  const remove = (key: string) => {
    commitFor(key)?.(null);
    setSelected(null);
  };

  /** Text size up or down a step — on what's being typed, or on what's selected. */
  const resize = (by: number) => {
    const [lo, hi] = TEXT_SCALE;
    const sized = <T extends Typed>(shape: T): T => ({ ...shape, size: Math.min(hi, Math.max(lo, (shape.size ?? 1) * by)) });
    if (editing) setEditing({ ...editing, shape: sized(editing.shape) });
    else if (chosen && chosenShape && typed(chosenShape)) chosen.commit?.(sized(chosenShape));
  };

  const edit = (key: string, shape: MarkupShape) => {
    if (typed(shape)) setEditing({ key, shape });
  };

  // Delete or Backspace removes what's selected; Escape lets go of it.
  useEffect(() => {
    if (!active || !selected || editing) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "Escape") setSelected(null);
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const one = placed.find((p) => p.key === selected);
        if (one && !one.sole) remove(one.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Finished marking up, or off to another tool that draws: let go.
  useEffect(() => {
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(null);
      editingNow.current = null;
      setEditingState(null);
    }
  }, [active]);

  /** The typing box takes the keyboard at once, without scrolling the page to it. */
  const focusEditor = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  /** Pick up `key` by `part`, the pointer captured by the layer so the drag follows it anywhere. */
  const pickUp = (event: React.PointerEvent<HTMLElement>, key: string, part: "move" | "size" | "tip", shape: MarkupShape) => {
    const bounds = boundsOf(shape, aspect);
    if (!bounds) return;
    event.stopPropagation();
    event.preventDefault();
    host.current?.setPointerCapture(event.pointerId);
    stroke.current = event.pointerId;
    tip.current = { point: at(event), magnify: event.pointerType !== "mouse" && part !== "move" };
    setHandling({ key, part, from: at(event), was: shape, bounds, shape, moved: false, again: selected === key });
    setSelected(key);
  };

  /** The mark a tap at `point` picks up: what's selected first, then the newest on top. */
  const hitAt = (point: Point): Placed | undefined => {
    const reach = REACH_PX / (host.current?.getBoundingClientRect().width || 1);
    const hits = placed.filter((one) => one.commit && shapeHit(current(one.key, one.shape), point, reach, aspect));
    return hits.find((one) => one.key === selected) ?? hits[hits.length - 1];
  };

  // With the select tool a finger on empty sheet pans it, but one on a mark
  // drags the mark: the touch is kept from scrolling the sheet as it lands.
  const grabbable = useRef<(touch: Touch) => boolean>(() => false);
  useEffect(() => {
    grabbable.current = (touch) => interactive && tool === "select" && Boolean(hitAt(at(touch)));
  });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onTouch = (event: TouchEvent) => {
      if (event.touches.length === 1 && event.cancelable && grabbable.current(event.touches[0])) event.preventDefault();
    };
    el.addEventListener("touchstart", onTouch, { passive: false });
    return () => el.removeEventListener("touchstart", onTouch);
  }, []);

  /** Events from the bar come up the React tree through here too (it's portaled): they're not the sheet's. */
  const onSheet = (event: React.PointerEvent) => host.current?.contains(event.target as Node) ?? false;

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button > 0 || !onSheet(event)) return;
    // A first finger always starts afresh. Any other finger is a pinch: drop the stroke or drag the first one began.
    if (!event.isPrimary) {
      stroke.current = null;
      tip.current = null;
      start.current = null;
      setLive(null);
      setHandling(null);
      return;
    }
    // A tap elsewhere keeps what was being typed.
    finishEditing();
    const point = at(event);
    if (tool === "select") {
      const hit = hitAt(point);
      if (hit) {
        pickUp(event, hit.key, "move", current(hit.key, hit.shape));
        return;
      }
      // Empty sheet: let go, and let it pan.
      setSelected(null);
      return;
    }
    // Keep the scroller's own drag-to-pan out of it.
    event.stopPropagation();
    event.preventDefault();
    setSelected(null);
    if (tool === "text") {
      setEditing({ key: null, shape: { type: "text", colour, at: point, text: "" } });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    stroke.current = event.pointerId;
    tip.current = { point, magnify: event.pointerType !== "mouse" };
    start.current = point;
    if (tool === "pen") setLive({ type: "pen", colour: ink, points: [point] });
    else if (tool === "highlight") setLive({ type: "box", colour: "yellow", from: point, to: point });
    else if (tool === "callout") setLive({ type: "callout", colour: calloutInk(ink), rect: calloutRect(point, point, aspect), tip: point, text: "" });
    else setLive({ type: tool, colour: ink, from: point, to: point });
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSheet(event) || stroke.current !== event.pointerId) return;
    if (tip.current) tip.current = { ...tip.current, point: at(event) };
    if (handling) {
      event.stopPropagation();
      const point = at(event);
      const dx = point[0] - handling.from[0];
      const dy = point[1] - handling.from[1];
      const { was, bounds } = handling;
      let next: MarkupShape = was;
      if (handling.part === "move") {
        next = moveShape(was, dx, dy, aspect);
      } else if (handling.part === "tip" && was.type === "callout") {
        next = { ...was, tip: [Math.min(1, Math.max(0, was.tip[0] + dx)), Math.min(1, Math.max(0, was.tip[1] + dy))] };
      } else if (was.type === "callout") {
        const { rect } = was;
        const width = Math.min(1 - rect.left, Math.max(CALLOUT_MIN, rect.width + dx));
        const height = Math.min(1 - rect.top, Math.max(CALLOUT_MIN * aspect, rect.height + dy));
        next = { ...was, rect: { ...rect, width, height } };
      } else {
        // By the bottom-right corner, the top-left staying put; never shrunk to nothing.
        const width = Math.min(1 - bounds.left, Math.max(CALLOUT_MIN, bounds.width + dx));
        const height = was.type === "text" ? bounds.height : Math.min(1 - bounds.top, Math.max(CALLOUT_MIN * aspect, bounds.height + dy));
        next = scaleShape(was, bounds, { ...bounds, width: bounds.width > 0 ? width : 0, height: bounds.height > 0 ? height : 0 });
      }
      setHandling({ ...handling, shape: next, moved: handling.moved || !tooSmall(handling.from, point) });
      return;
    }
    if (!live || !start.current) return;
    event.stopPropagation();
    const point = at(event);
    if (live.type === "pen") {
      const last = live.points[live.points.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) < PEN_STEP) return;
      setLive({ ...live, points: [...live.points, point] });
    } else if (live.type === "callout") {
      setLive({ ...live, rect: calloutRect(live.tip, point, aspect) });
    } else if (live.type === "line" || live.type === "arrow") {
      // Straightened when it's nearly across or down the sheet, as on a point-to-point sheet.
      setLive({ ...live, to: snapSegment(start.current, point, aspect)[1] });
    } else if (live.type !== "text" && live.type !== "highlight") {
      setLive({ ...live, to: point });
    }
  };

  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSheet(event) || stroke.current !== event.pointerId) return;
    stroke.current = null;
    tip.current = null;
    if (handling) {
      event.stopPropagation();
      setHandling(null);
      if (event.type === "pointercancel") return;
      if (handling.moved) commitFor(handling.key)?.(handling.shape);
      // A tap on what was already selected: type in it.
      else if (handling.part === "move" && handling.again) edit(handling.key, handling.was);
      return;
    }
    if (!live || !start.current) return;
    event.stopPropagation();
    const from = start.current;
    const shape = live;
    start.current = null;
    setLive(null);
    if (event.type === "pointercancel") return;
    if (shape.type === "pen") {
      if (shape.points.length > 1) onShape(shape);
      return;
    }
    if (shape.type === "text" || shape.type === "highlight") return;
    if (shape.type === "callout") {
      // Placed: now its text.
      setEditing({ key: null, shape: { ...shape, rect: calloutRect(from, at(event), aspect) } });
      return;
    }
    if (tooSmall(from, shape.to)) return;
    if (tool === "highlight") {
      const rect: Rect = {
        left: Math.min(from[0], shape.to[0]),
        top: Math.min(from[1], shape.to[1]),
        width: Math.abs(shape.to[0] - from[0]),
        height: Math.abs(shape.to[1] - from[1]),
      };
      const rects = snapText(rect);
      // No text under it: highlight the area itself.
      onShape({ type: "highlight", colour: "yellow", rects: rects.length > 0 ? rects : [rect] });
      return;
    }
    onShape(shape);
  };

  // The magnifier: while a finger or pencil draws, or drags a grip, the sheet
  // under it at 3× beside it, up and away from the hand — as on a
  // point-to-point sheet — with what's being drawn, so the hand never hides it.
  useEffect(() => {
    const el = loupe.current;
    const canvas = loupeCanvas.current;
    const now = tip.current;
    const drawing = live ?? (handling && handling.part !== "move" ? handling.shape : null);
    if (!el || !canvas || !host.current) return;
    if (!now?.magnify || !drawing) {
      el.style.display = "none";
      return;
    }
    const sheet = host.current.parentElement?.querySelector("canvas");
    const box = host.current.getBoundingClientRect();
    const density = Math.min(window.devicePixelRatio || 1, 3);
    const size = Math.round(LOUPE * density);
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    const spanX = LOUPE / (box.width * LOUPE_ZOOM);
    const spanY = LOUPE / (box.height * LOUPE_ZOOM);
    const left = now.point[0] - spanX / 2;
    const top = now.point[1] - spanY / 2;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    if (sheet && sheet.width > 0) {
      context.drawImage(sheet, left * sheet.width, top * sheet.height, spanX * sheet.width, spanY * sheet.height, 0, 0, size, size);
    }
    const pageWidthPx = (size / spanX);
    const toPx = ([x, y]: Point): [number, number] => [((x - left) / spanX) * size, ((y - top) / spanY) * size];
    paintShapes(context, [drawing], aspect, pageWidthPx, toPx, 2 * density);
    // Crosshair on the exact point.
    const middle = size / 2;
    context.strokeStyle = "#ea580c";
    context.lineWidth = 1.5 * density;
    context.beginPath();
    context.moveTo(middle - 12 * density, middle);
    context.lineTo(middle + 12 * density, middle);
    context.moveTo(middle, middle - 12 * density);
    context.lineTo(middle, middle + 12 * density);
    context.stroke();
    // Up and to the left of the finger; the other side, or below, where there's no room. Kept inside the sheet's window.
    const scroller = host.current.closest("[data-sheet-scroller]")?.getBoundingClientRect() ?? box;
    const x = box.left + now.point[0] * box.width;
    const y = box.top + now.point[1] * box.height;
    let placeX = x - LOUPE - 36;
    if (placeX < scroller.left + 8) placeX = x + 36;
    if (placeX + LOUPE > scroller.right - 8) placeX = Math.max(scroller.left + 8, x - LOUPE - 36);
    let placeY = y - LOUPE - 56;
    if (placeY < scroller.top + 8) placeY = Math.min(y + 56, scroller.bottom - LOUPE - 8);
    el.style.transform = `translate(${placeX - box.left}px, ${placeY - box.top}px)`;
    el.style.display = "";
  }, [live, handling, aspect]);

  const viewBox = `0 0 ${UNITS} ${UNITS / aspect}`;
  const pct = (rect: Rect): React.CSSProperties => ({
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  });
  const chosenBounds = chosenShape && !editing ? boundsOf(chosenShape, aspect) : null;
  const editingBounds = editing ? boundsOf(editing.shape.text ? editing.shape : { ...editing.shape, text: "Type here" }, aspect) : null;

  const barButton =
    "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800";
  // Buttons in the bar keep the typing box's focus, so a tap on one doesn't count as finishing.
  const keepFocus = (event: React.PointerEvent) => event.preventDefault();
  const sizeButtons = (shape: Typed) => (
    <>
      <button type="button" aria-label="Smaller text" title="Smaller text" onPointerDown={keepFocus} onClick={() => resize(1 / SIZE_STEP)} disabled={(shape.size ?? 1) <= TEXT_SCALE[0] + 1e-9} className={barButton}>
        <AArrowDown size={18} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Bigger text" title="Bigger text" onPointerDown={keepFocus} onClick={() => resize(SIZE_STEP)} disabled={(shape.size ?? 1) >= TEXT_SCALE[1] - 1e-9} className={barButton}>
        <AArrowUp size={18} aria-hidden="true" />
      </button>
    </>
  );

  const bar = editing ? (
    <div onPointerDown={(event) => event.stopPropagation()} className={BAR}>
      <textarea
        ref={focusEditor}
        aria-label={editing.shape.type === "callout" ? "Callout text" : "Text on the drawing"}
        value={editing.shape.text}
        rows={1}
        enterKeyHint="done"
        onChange={(event) => setEditing({ ...editing, shape: { ...editing.shape, text: event.target.value } })}
        onBlur={finishEditing}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            finishEditing();
          }
          if (event.key === "Escape") setEditing(null);
        }}
        placeholder={editing.shape.type === "callout" ? "Callout text — shows on the sheet as you type" : "Text — shows on the sheet as you type"}
        // 16px: any smaller and iOS zooms the whole page in to it.
        className="h-10 min-w-0 flex-1 resize-none rounded-lg border-2 bg-white px-2 py-1.5 text-base leading-6 outline-none dark:bg-slate-900"
        style={{ borderColor: INK[editing.shape.colour].hex, color: INK[editing.shape.colour].hex }}
      />
      {sizeButtons(editing.shape)}
      {editing.key && (
        <button
          type="button"
          aria-label="Delete it"
          title={placed.find((one) => one.key === editing.key)?.sole ? "It's all this markup has — delete the markup from its list instead" : "Delete it"}
          disabled={placed.find((one) => one.key === editing.key)?.sole}
          onPointerDown={keepFocus}
          onClick={() => {
            const key = editing.key!;
            setEditing(null);
            remove(key);
          }}
          className={cn(barButton, "text-red-700 dark:text-red-300")}
        >
          <Trash2 size={17} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onPointerDown={keepFocus}
        onClick={finishEditing}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-orange-600 px-3 text-sm font-semibold text-white hover:bg-orange-700"
      >
        <Check size={15} aria-hidden="true" /> OK
      </button>
    </div>
  ) : chosen && chosenShape ? (
    <div onPointerDown={(event) => event.stopPropagation()} className={cn(BAR, "overflow-x-auto")}>
      <span className="shrink-0 pr-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{NAME[chosenShape.type]}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-600 max-sm:hidden dark:text-slate-300">
        Drag to move · corner to resize{chosenShape.type === "callout" ? " · dot to move the arrow" : ""}
      </span>
      {typed(chosenShape) && (
        <>
          <button type="button" onClick={() => edit(chosen.key, chosenShape)} className={barButton}>
            <Pencil size={15} aria-hidden="true" /> Edit
          </button>
          {sizeButtons(chosenShape)}
        </>
      )}
      <button
        type="button"
        onClick={() => remove(chosen.key)}
        disabled={chosen.sole}
        title={chosen.sole ? "It's all this markup has — delete the markup from its list instead" : "Delete it"}
        className={cn(barButton, "text-red-700 dark:text-red-300")}
      >
        <Trash2 size={16} aria-hidden="true" /> Delete
      </button>
      <button type="button" aria-label="Deselect" title="Deselect" onClick={() => setSelected(null)} className={barButton}>
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  ) : active ? (
    <div className={BAR}>
      <p className="truncate text-xs text-slate-600 dark:text-slate-300">
        {HINT[tool] ?? "Draw with one finger."} Two fingers move and zoom the sheet.
      </p>
    </div>
  ) : null;

  return (
    <div
      ref={host}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className={cn("absolute inset-0", !interactive ? "pointer-events-none" : tool === "select" ? "cursor-default" : "cursor-crosshair")}
      // A size container: callouts are sized in `cqw`, hundredths of the page's width.
      // With the select tool one finger on empty sheet still pans it.
      style={{ touchAction: !interactive ? undefined : tool === "select" ? "pan-x pan-y" : "none", containerType: "size" }}
    >
      <svg viewBox={viewBox} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {markups.map((markup) => (
          <g key={markup.id} opacity={markup.status === "fixed" ? 0.45 : 1}>
            {markup.shapes.map((shape, index) => {
              const key = `${markup.id}:${index}`;
              return key === editingKey ? null : <Shape key={index} shape={current(key, shape)} aspect={aspect} thinnest={thinnest} />;
            })}
          </g>
        ))}
        {draft.map((shape, index) => {
          const key = `draft:${index}`;
          return key === editingKey ? null : <Shape key={key} shape={current(key, shape)} aspect={aspect} thinnest={thinnest} />;
        })}
        {editing && <Shape shape={editing.shape} aspect={aspect} thinnest={thinnest} />}
        {live && (
          <g opacity={0.8} strokeDasharray={live.type === "box" && tool === "highlight" ? `${0.004 * UNITS} ${0.003 * UNITS}` : undefined}>
            <Shape shape={live} aspect={aspect} thinnest={thinnest * 1.6} />
          </g>
        )}
      </svg>

      {live?.type === "callout" && <CalloutBox shape={live} aria-hidden="true" className="opacity-80" />}
      {live && (live.type === "line" || live.type === "arrow") &&
        [live.from, live.to].map(([x, y], index) => (
          // The ends of a line being drawn, big enough to see on a phone.
          <span
            key={index}
            aria-hidden="true"
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, background: INK[live.colour].hex }}
          />
        ))}
      <div
        ref={loupe}
        aria-hidden="true"
        style={{ display: "none", width: LOUPE, height: LOUPE }}
        className="pointer-events-none absolute left-0 top-0 z-30 overflow-hidden rounded-full bg-white shadow-2xl ring-4 ring-white outline outline-1 outline-slate-900/40"
      >
        <canvas ref={loupeCanvas} className="block h-full w-full" />
      </div>
      {placed.map(({ key, shape, faded }) => {
        const now = current(key, shape);
        if (key === editingKey || now.type !== "callout") return null;
        // A fixed markup fades, like the rest of it.
        return <CalloutBox key={key} shape={now} aria-hidden="true" className={cn(faded && "opacity-45")} />;
      })}
      {editing?.shape.type === "callout" && <CalloutBox shape={editing.shape} aria-hidden="true" className="shadow-lg ring-2 ring-orange-400" />}
      {editing?.shape.type === "text" && editingBounds && (
        // Where the text goes, while it's typed.
        <span aria-hidden="true" className="pointer-events-none absolute animate-pulse rounded-sm outline-dashed outline-2 outline-offset-2 outline-orange-500" style={{ ...pct(editingBounds), minWidth: 12, minHeight: 12 }} />
      )}

      {chosen && chosenShape && chosenBounds && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute rounded-sm outline-dashed outline-2 outline-offset-4 outline-orange-500"
            style={{ ...pct(chosenBounds), minWidth: 8, minHeight: 8 }}
          />
          {chosenShape.type !== "highlight" && (
            <span
              role="button"
              aria-label={`Resize the ${NAME[chosenShape.type].toLowerCase()}`}
              // Out past the corner, so on a small mark it never covers what's there to drag.
              className="pointer-events-auto absolute flex h-10 w-10 cursor-nwse-resize touch-none items-start justify-start p-1"
              style={
                chosenShape.type === "callout"
                  ? { left: `${(chosenShape.rect.left + chosenShape.rect.width) * 100}%`, top: `${(chosenShape.rect.top + chosenShape.rect.height) * 100}%` }
                  : { left: `${(chosenBounds.left + chosenBounds.width) * 100}%`, top: `${(chosenBounds.top + chosenBounds.height) * 100}%` }
              }
              onPointerDown={(event) => pickUp(event, chosen.key, "size", chosenShape)}
            >
              <span className="h-4 w-4 rounded-sm border-2 border-white bg-orange-500 shadow" />
            </span>
          )}
          {chosenShape.type === "callout" && (
            <span
              role="button"
              aria-label="Move what the callout points at"
              className="pointer-events-auto absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 cursor-crosshair touch-none items-center justify-center"
              style={{ left: `${chosenShape.tip[0] * 100}%`, top: `${chosenShape.tip[1] * 100}%` }}
              onPointerDown={(event) => pickUp(event, chosen.key, "tip", chosenShape)}
            >
              <span className="h-4 w-4 rounded-full border-2 border-white bg-orange-500 shadow" />
            </span>
          )}
        </>
      )}

      {markups.map((markup) => {
        const bounds = markupBounds(markup.shapes, aspect);
        if (!bounds) return null;
        return (
          <span key={markup.id}>
            {markup.id === focusId && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute rounded-md outline outline-[3px] outline-offset-4 outline-orange-500"
                style={pct(bounds)}
              />
            )}
            <button
              type="button"
              onClick={() => onPick?.(markup)}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label={`Markup ${markup.number}: ${markup.title}`}
              className={cn(
                "pointer-events-auto absolute flex h-6 min-w-6 -translate-x-full -translate-y-full items-center justify-center rounded-full px-1.5 text-xs font-bold text-white shadow ring-2 ring-white",
                markup.status === "fixed" ? "bg-emerald-600" : markup.kind === "issue" ? "bg-red-600" : "bg-blue-600"
              )}
              style={{ left: `${bounds.left * 100}%`, top: `${bounds.top * 100}%` }}
            >
              {markup.number}
            </button>
          </span>
        );
      })}

      {bar &&
        (dock ? (
          createPortal(bar, dock)
        ) : (
          <div className="pointer-events-auto absolute inset-x-0 top-0 z-10" onPointerDown={(event) => event.stopPropagation()}>
            {bar}
          </div>
        ))}
    </div>
  );
}
