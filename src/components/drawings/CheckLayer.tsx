"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  CHECK_INK,
  DEFAULT_STAMP_AT,
  ROW_WIRE_REACH,
  STAMP_RATIO,
  STAMP_WIDTH,
  pointAt,
  resultLabel,
  shapeBounds,
  snapSegment,
  type CheckPoint,
  type CheckShape,
  type CheckStatus,
  type Point,
  type Rect,
} from "@/lib/drawings/commissioning";
import { cn } from "@/lib/cn";

/**
 * Point-to-point check points over a drawing, and adding new ones.
 *
 * Laid exactly over the rendered page in page fractions, like `MarkupLayer`:
 * the SVG's units are the page's width (1) by its height (1 / aspect). The
 * points themselves are plain HTML boxes, not SVG (see `PointMarks`).
 *
 * Tools: TRACE drags a straight run along a wire (snapped square — see
 * `snapSegment`) and makes it a point; EXTEND adds another run to the point
 * picked, for a wire that turns a corner; AREA boxes a revision cloud or a row
 * of a termination table; ROW taps a terminal row and boxes it to its text,
 * or drags down a column to take every row inside; STAMP drags the sign-off
 * stamp where it goes, or a press elsewhere brings it there. Otherwise a tap
 * without a drag picks the point under it, whatever the tool — ROW too, when
 * the tap lands on a point already there. With PAN,
 * the page scrolls as usual and points can still be tapped.
 *
 * Tracing has to keep up with an Apple Pencil, so the stroke in progress is
 * drawn straight onto its own SVG elements each animation frame — every
 * sample the pencil gave (coalesced events), full highlighter width under the
 * tip, the snapped line it will become, and a chip naming the wire — with no
 * React render per move. A loupe beside the tip shows the sheet under it at
 * 3×, so the hand never hides the line being followed — the loupe and the
 * chip sit on the side away from the drawing hand (`hand`).
 *
 * Once a pencil has touched the sheet, the pencil draws (TRACE, even with PAN
 * picked) and a finger moves the sheet, so there's no tool to switch in the
 * field. A picked wire has grips on its ends to fine-tune it, a + to carry
 * on round a corner, and its result buttons by its end.
 */

export type CheckTool = "pan" | "trace" | "extend" | "area" | "row" | "stamp";

/** Highlighter width on screen, as a fraction of the page width. */
const WIDTH = 0.006;
/** A drag shorter than this, of the page's width or in screen pixels, is a tap — a pencil's brush makes no wire. */
const TAP = 0.003;
const TAP_PX = 10;
/** A hex colour at `alpha`, for a CSS background. */
function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

/** A length in page widths, as CSS — the layer is a size container, so `cqw` is a hundredth of the page's width. */
const cqw = (widths: number) => `${widths * 100}cqw`;

/**
 * One run of a wire: a bar from `a` to `b`, `thick` across (CSS), with round
 * ends. Placed with its first end at (left, top) and turned about it.
 */
function Run({ a, b, aspect, thick, style }: { a: Point; b: Point; aspect: number; thick: string; style: React.CSSProperties }) {
  const dx = b[0] - a[0];
  const dy = (b[1] - a[1]) / aspect;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const half = `(${thick}) / 2`;
  return (
    <div
      className="pointer-events-none absolute rounded-full"
      style={{
        left: `calc(${cqw(a[0])} - ${half})`,
        top: `calc(${cqw(a[1] / aspect)} - ${half})`,
        width: `calc(${cqw(Math.hypot(dx, dy))} + ${thick})`,
        height: thick,
        transformOrigin: `calc(${half}) 50%`,
        transform: `rotate(${angle}deg)`,
        ...style,
      }}
    />
  );
}

/**
 * One point's marks, as plain HTML boxes laid over the sheet — never SVG.
 * iPad Safari, once a sheet is zoomed, leaves SVG over it unpainted (whole
 * sheet-sized ones and small per-point ones alike), so a passed row showed at
 * one zoom and was gone at the next. Boxes with a background are repainted at
 * every zoom, like the search highlights. Sized in page widths (`cqw`), so
 * they scale with the sheet like ink on it.
 */
function PointMarks({
  shape,
  status,
  selected,
  removal = false,
  aspect,
  opacity = 1,
}: {
  shape: CheckShape;
  status: CheckStatus;
  selected: boolean;
  /** A hatched cloud — drawn hatched, as on the sheet. */
  removal?: boolean;
  aspect: number;
  opacity?: number;
}) {
  const ink = CHECK_INK[status];
  const pending = status === "pending";
  if (shape.type === "area") {
    const { left, top, width, height } = shape.rect;
    const box: React.CSSProperties = {
      left: `${left * 100}%`,
      top: `${top * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`,
      opacity,
    };
    if (removal) {
      const hatch = tint(pending ? CHECK_INK.pending.hex : status === "pass" ? "#a16207" : ink.hex, pending ? 0.5 : 0.85);
      // 45° lines, rising to the right, a page-width fraction apart — as `hatchLines` draws them in the PDF.
      return (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            ...box,
            backgroundColor: pending ? undefined : tint(ink.hex, ink.opacity * 0.5),
            backgroundImage: `repeating-linear-gradient(135deg, ${hatch} 0 ${cqw(0.0009)}, transparent ${cqw(0.0009)} ${cqw(0.006 / Math.SQRT2)})`,
            outline: selected ? `${cqw(0.0016)} dashed #ea580c` : pending ? `${cqw(0.001)} dashed ${ink.hex}` : undefined,
          }}
        />
      );
    }
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          ...box,
          backgroundColor: pending ? undefined : tint(ink.hex, ink.opacity),
          outline: selected ? "3px dashed #ea580c" : pending ? `2px dashed ${ink.hex}` : undefined,
        }}
      />
    );
  }
  return (
    <>
      {selected &&
        shape.segments.map(([a, b], index) => (
          <Run key={`s${index}`} a={a} b={b} aspect={aspect} thick="16px" style={{ backgroundColor: tint("#ea580c", 0.45), opacity }} />
        ))}
      {shape.segments.map(([a, b], index) =>
        pending ? (
          // Untested: an outline that reads at any zoom.
          <Run
            key={index}
            a={a}
            b={b}
            aspect={aspect}
            thick="3px"
            style={{ borderRadius: 0, backgroundImage: `repeating-linear-gradient(90deg, ${tint(ink.hex, 0.9)} 0 8px, transparent 8px 13px)`, opacity }}
          />
        ) : (
          // Tested: highlighter that scales like ink on the sheet.
          <Run key={index} a={a} b={b} aspect={aspect} thick={cqw(WIDTH)} style={{ backgroundColor: tint(ink.hex, ink.opacity + 0.15), opacity }} />
        )
      )}
    </>
  );
}

/**
 * Kept once a pencil has touched a sheet on this device, for the session:
 * from then on the pencil draws and a finger moves the sheet.
 */
const PENCIL_KEY = "p2p-pencil";

function pencilKnown(): boolean {
  try {
    return sessionStorage.getItem(PENCIL_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberPencil() {
  try {
    sessionStorage.setItem(PENCIL_KEY, "1");
  } catch {
    // Private mode: it's remembered for this sheet only.
  }
}

/** The loupe's size in CSS pixels, and how much it magnifies. */
const LOUPE = 168;
const LOUPE_ZOOM = 3;

/** Keep a dragged end on its run's line: across stays across, down stays down. */
function along(moved: Point, fixed: Point, was: Point): Point {
  if (was[1] === fixed[1]) return [moved[0], fixed[1]];
  if (was[0] === fixed[0]) return [fixed[0], moved[1]];
  return moved;
}

export function CheckLayer({
  aspect,
  page,
  points,
  dimmed = [],
  selectedId,
  tool,
  canDraw = true,
  hand = "right",
  stampAt,
  showStamp,
  onAdd,
  onExtend,
  onPick,
  onStamp,
  onRow,
  onRows,
  labelFor,
  onReshape,
  onMark,
  onDelete,
  onExtendStart,
}: {
  aspect: number;
  page: number;
  /** Every point on the sheet; only this page's are drawn. */
  points: CheckPoint[];
  /** Points that are another project's — drawn faded, and not picked by a tap. */
  dimmed?: string[];
  selectedId: string | null;
  tool: CheckTool;
  /** False once the sheet is signed: points can be picked, not drawn or changed. */
  canDraw?: boolean;
  /** The drawing hand: the loupe and chip go on the other side of the tip, where the hand isn't. */
  hand?: "left" | "right";
  stampAt: Point | null;
  /** Outline where the sign-off stamp will go. */
  showStamp: boolean;
  onAdd: (shape: CheckShape) => void;
  onExtend: (segment: [Point, Point]) => void;
  onPick: (point: CheckPoint | null) => void;
  onStamp: (at: Point) => void;
  /** ROW: a tap on a terminal row. False when there's no row of text there to add. */
  onRow?: (at: Point) => boolean;
  /** ROW: a box dragged over several rows. */
  onRows?: (rect: Rect) => void;
  /** The wire a run being traced is on, read off the sheet — shown on the chip by the tip. */
  labelFor?: (segment: [Point, Point]) => string;
  /** A picked wire's ends dragged by their grips. */
  onReshape?: (point: CheckPoint, shape: CheckShape) => void;
  /** The result bar by a picked point. */
  onMark?: (status: CheckStatus) => void;
  onDelete?: (point: CheckPoint) => void;
  /** The + by a picked wire's end: carry on round a corner. */
  onExtendStart?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const start = useRef<Point | null>(null);
  /** The tool this stroke is using — a pencil traces even with PAN picked. */
  const stroke = useRef<CheckTool>(tool);
  const fromPencil = useRef(false);
  /** The finger drawing the stroke in progress, if a finger is. */
  const strokeFinger = useRef<number | null>(null);
  const raw = useRef<Point[]>([]);
  const frame = useRef(0);
  const ink = useRef<SVGPolylineElement>(null);
  const guide = useRef<SVGLineElement>(null);
  const axis = useRef<SVGLineElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const loupe = useRef<HTMLDivElement>(null);
  const loupeCanvas = useRef<HTMLCanvasElement>(null);
  const hover = useRef<HTMLSpanElement>(null);
  const label = useRef({ at: 0, text: "" });
  const pan = useRef<{ x: number; y: number; left: number; top: number; el: HTMLElement; moved: boolean; point: Point } | null>(null);
  const [pencil, setPencil] = useState(false);
  // Read after mounting, so the server's render and the first client one agree;
  // and a pencil used anywhere on the page — even on a button — counts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pencilKnown()) setPencil(true);
    const notice = (event: PointerEvent) => {
      if (event.pointerType !== "pen") return;
      rememberPencil();
      setPencil(true);
    };
    document.addEventListener("pointerdown", notice, true);
    return () => document.removeEventListener("pointerdown", notice, true);
  }, []);
  const [live, setLive] = useState<{ from: Point; to: Point } | null>(null);
  const [grip, setGrip] = useState<{ which: "start" | "end"; shape: CheckShape } | null>(null);
  /** The stamp being dragged: where it is now, and where on it it was picked up. */
  const [movingStamp, setMovingStamp] = useState<Point | null>(null);
  const stampGrab = useRef<Point>([0, 0]);

  // Listening for pointers: any tool but PAN, or always once a pencil is about.
  const listening = (tool !== "pan" && canDraw) || pencil;

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const fraction = (clientX: number, clientY: number): Point => {
    const box = host.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (clientX - box.left) / box.width)), Math.min(1, Math.max(0, (clientY - box.top) / box.height))];
  };
  const at = (event: React.PointerEvent): Point => fraction(event.clientX, event.clientY);

  const show = (el: Element | null, on: boolean) => {
    if (el) (el as HTMLElement | SVGElement).style.display = on ? "" : "none";
  };

  /** The 3× view of the sheet under the tip, beside it — up and to the left, or wherever there's room. */
  const paintLoupe = (tip: Point, segment: [Point, Point]) => {
    const el = loupe.current;
    const canvas = loupeCanvas.current;
    const sheet = host.current?.parentElement?.querySelector("canvas");
    if (!el || !canvas || !host.current) return;
    const box = host.current.getBoundingClientRect();
    const density = Math.min(window.devicePixelRatio || 1, 3);
    const size = Math.round(LOUPE * density);
    if (canvas.width !== size) canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    const spanX = LOUPE / (box.width * LOUPE_ZOOM);
    const spanY = LOUPE / (box.height * LOUPE_ZOOM);
    const left = tip[0] - spanX / 2;
    const top = tip[1] - spanY / 2;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    if (sheet && sheet.width > 0) {
      context.drawImage(sheet, left * sheet.width, top * sheet.height, spanX * sheet.width, spanY * sheet.height, 0, 0, size, size);
    }
    const toLoupe = ([x, y]: Point): [number, number] => [((x - left) / spanX) * size, ((y - top) / spanY) * size];
    context.lineCap = context.lineJoin = "round";
    context.strokeStyle = "rgba(250, 204, 21, 0.55)";
    context.lineWidth = WIDTH * box.width * LOUPE_ZOOM * density;
    context.beginPath();
    raw.current.forEach((point, index) => {
      const [x, y] = toLoupe(point);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    context.setLineDash([6 * density, 4 * density]);
    context.strokeStyle = "#1d4ed8";
    context.lineWidth = 1.5 * density;
    context.beginPath();
    context.moveTo(...toLoupe(segment[0]));
    context.lineTo(...toLoupe(segment[1]));
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = "#ea580c";
    context.lineWidth = 2 * density;
    const middle = size / 2;
    context.beginPath();
    context.moveTo(middle - 12 * density, middle);
    context.lineTo(middle + 12 * density, middle);
    context.moveTo(middle, middle - 12 * density);
    context.lineTo(middle, middle + 12 * density);
    context.stroke();
    const x = box.left + tip[0] * box.width;
    const y = box.top + tip[1] * box.height;
    // Up and away from the hand: to the left of the tip for a right hand, the right for a left.
    const before = x - LOUPE - 36;
    const after = x + 36;
    let placeX = hand === "left" ? after : before;
    if (placeX < 8) placeX = after;
    if (placeX + LOUPE > window.innerWidth - 8) placeX = before;
    let placeY = y - LOUPE - 56;
    if (placeY < 8) placeY = y + 56;
    el.style.transform = `translate(${placeX}px, ${placeY}px)`;
    show(el, true);
  };

  /** One frame of the stroke in progress: ink, snapped line, axis guide, chip, loupe. */
  const paint = (now: number) => {
    frame.current = 0;
    const samples = raw.current;
    if (samples.length === 0) return;
    const from = samples[0];
    const tip = samples[samples.length - 1];
    const segment = snapSegment(from, tip, aspect);
    ink.current?.setAttribute("points", samples.map(([x, y]) => `${x},${y / aspect}`).join(" "));
    // Never thinner than a highlighter looks under a pencil nib, however far out the sheet is zoomed.
    const width = host.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) ink.current?.setAttribute("stroke-width", `${Math.max(WIDTH, 12 / width)}`);
    show(ink.current, true);
    const line = guide.current;
    if (line) {
      line.setAttribute("x1", `${segment[0][0]}`);
      line.setAttribute("y1", `${segment[0][1] / aspect}`);
      line.setAttribute("x2", `${segment[1][0]}`);
      line.setAttribute("y2", `${segment[1][1] / aspect}`);
      show(line, true);
    }
    const across = segment[0][1] === segment[1][1];
    const down = segment[0][0] === segment[1][0];
    const guideLine = axis.current;
    if (guideLine && (across || down)) {
      guideLine.setAttribute("x1", across ? "0" : `${segment[0][0]}`);
      guideLine.setAttribute("x2", across ? "1" : `${segment[0][0]}`);
      guideLine.setAttribute("y1", across ? `${segment[0][1] / aspect}` : "0");
      guideLine.setAttribute("y2", across ? `${segment[0][1] / aspect}` : `${1 / aspect}`);
      show(guideLine, true);
    } else show(guideLine, false);
    const tag = chip.current;
    if (tag) {
      // Reading the sheet's text is cheap, but not every frame.
      if (labelFor && now - label.current.at > 120) label.current = { at: now, text: labelFor(segment) };
      tag.textContent = `${label.current.text || "Wire"} · ${across || down ? "snapped" : "angled"}`;
      tag.style.left = `${segment[1][0] * 100}%`;
      tag.style.top = `${segment[1][1] * 100}%`;
      show(tag, true);
    }
    if (fromPencil.current) paintLoupe(tip, segment);
  };

  const schedule = () => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };

  const clearStroke = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    raw.current = [];
    label.current = { at: 0, text: "" };
    for (const el of [ink.current, guide.current, axis.current, chip.current, loupe.current]) show(el, false);
  };

  const tapAt = (point: Point, using: CheckTool) => {
    const pickable = points.filter((one) => !dimmed.includes(one.id));
    if (using === "row" && canDraw && onRow) {
      // Rows sit closer together than a fingertip's reach, so near a row already added isn't on it:
      // only a tap inside a row's box, or right on a wire, picks. Anywhere else adds the row under it —
      // the row between two done ones was being taken for its neighbour, and never added.
      const on = pointAt(pickable, page, point, aspect, ROW_WIRE_REACH, true);
      if (on) onPick(on);
      else if (!onRow(point)) onPick(pointAt(pickable, page, point, aspect));
      return;
    }
    onPick(pointAt(pickable, page, point, aspect));
  };

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;
    // A second finger: it's a pinch, which the viewer zooms with — drop the pan or stroke the first began.
    if (event.pointerType === "touch" && (pan.current || (start.current && strokeFinger.current !== null && strokeFinger.current !== event.pointerId))) {
      pan.current = null;
      start.current = null;
      strokeFinger.current = null;
      clearStroke();
      setLive(null);
      return;
    }
    const isPencil = event.pointerType === "pen";
    if (isPencil && !pencil) {
      rememberPencil();
      setPencil(true);
    }
    // With a pencil about, a finger moves the sheet.
    if ((pencil || isPencil) && event.pointerType === "touch") {
      const el = host.current?.closest<HTMLElement>("[data-sheet-scroller]");
      if (!el) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop, el, moved: false, point: at(event) };
      return;
    }
    const using: CheckTool = !canDraw ? "pan" : tool === "pan" && isPencil ? "trace" : tool;
    // A mouse or finger with PAN goes through to the scroller, which pans; the points' own buttons pick.
    if (using === "pan" && !isPencil) return;
    // The stamp only goes on page 1.
    if (using === "stamp" && page !== 1) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = at(event);
    start.current = point;
    stroke.current = using;
    fromPencil.current = event.pointerType !== "mouse";
    strokeFinger.current = event.pointerType === "touch" ? event.pointerId : null;
    show(hover.current, false);
    if (using === "trace" || using === "extend") {
      raw.current = [point];
      schedule();
    } else if (using === "stamp") {
      // Picked up where it was pressed; pressed elsewhere, it jumps there by its middle.
      const inside = point[0] >= stamp[0] && point[0] <= stamp[0] + STAMP_WIDTH && point[1] >= stamp[1] && point[1] <= stamp[1] + stampHeight;
      stampGrab.current = inside ? [point[0] - stamp[0], point[1] - stamp[1]] : [STAMP_WIDTH / 2, stampHeight / 2];
      setMovingStamp(stampTo(point));
    } else if (using !== "pan") setLive({ from: point, to: point });
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const panning = pan.current;
    if (panning) {
      const dx = event.clientX - panning.x;
      const dy = event.clientY - panning.y;
      if (Math.hypot(dx, dy) > 6) panning.moved = true;
      panning.el.scrollLeft = panning.left - dx;
      panning.el.scrollTop = panning.top - dy;
      return;
    }
    if (!start.current) {
      // A pencil hovering (iPad Pro): where it will land.
      const dot = hover.current;
      if (dot && event.pointerType === "pen" && canDraw) {
        const [x, y] = at(event);
        dot.style.left = `${x * 100}%`;
        dot.style.top = `${y * 100}%`;
        show(dot, true);
      }
      return;
    }
    event.stopPropagation();
    const using = stroke.current;
    if (using === "trace" || using === "extend") {
      // Every sample since the last event, not just the last one — a pencil gives up to 240 a second.
      const native = event.nativeEvent;
      const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
      for (const sample of samples.length > 0 ? samples : [native]) {
        const point = fraction(sample.clientX, sample.clientY);
        const last = raw.current[raw.current.length - 1];
        if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= 0.0006) raw.current.push(point);
      }
      schedule();
    } else if (using === "stamp") setMovingStamp(stampTo(at(event)));
    else if (using !== "pan") setLive({ from: start.current, to: at(event) });
  };

  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    const panning = pan.current;
    if (panning) {
      pan.current = null;
      if (!panning.moved) tapAt(panning.point, "pan");
      return;
    }
    const from = start.current;
    if (!from) return;
    event.stopPropagation();
    const using = stroke.current;
    const to = at(event);
    start.current = null;
    clearStroke();
    setLive(null);
    if (using === "stamp") {
      setMovingStamp(null);
      onStamp(stampTo(to));
      return;
    }
    const box = host.current?.getBoundingClientRect();
    const onScreen = box ? Math.hypot((to[0] - from[0]) * box.width, (to[1] - from[1]) * box.height) : Infinity;
    if (Math.hypot(to[0] - from[0], (to[1] - from[1]) / aspect) < TAP || onScreen < TAP_PX) {
      // A pencil tap on the result bar or the + presses it: the pencil went through them to the sheet
      // (so a stroke can start on a wire they cover), and only a tap is meant for them.
      const button = fromPencil.current
        ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pencil-through]")
        : null;
      if (button) button.click();
      else tapAt(from, using);
      return;
    }
    if (using === "trace") onAdd({ type: "trace", segments: [snapSegment(from, to, aspect)] });
    else if (using === "extend") onExtend(snapSegment(from, to, aspect));
    else if (using === "row") {
      onRows?.({
        left: Math.min(from[0], to[0]),
        top: Math.min(from[1], to[1]),
        width: Math.abs(to[0] - from[0]),
        height: Math.abs(to[1] - from[1]),
      });
    } else if (using === "area") {
      onAdd({
        type: "area",
        rect: {
          left: Math.min(from[0], to[0]),
          top: Math.min(from[1], to[1]),
          width: Math.abs(to[0] - from[0]),
          height: Math.abs(to[1] - from[1]),
        },
      });
    }
  };

  const onPage = points.filter((point) => point.page === page);
  const selected = onPage.find((point) => point.id === selectedId && !dimmed.includes(point.id)) ?? null;
  const shown = (point: CheckPoint): CheckShape => (grip && point.id === selected?.id ? grip.shape : point.shape);
  const selectedShape = selected ? shown(selected) : null;
  const selectedBox: Rect | null = selectedShape ? shapeBounds(selectedShape) : null;
  const stamp = movingStamp ?? stampAt ?? DEFAULT_STAMP_AT;
  const stampHeight = STAMP_WIDTH * STAMP_RATIO * aspect;
  /** The stamp's top-left with the pointer at `point`, kept on the sheet. */
  const stampTo = (point: Point): Point => [
    Math.min(1 - STAMP_WIDTH, Math.max(0, point[0] - stampGrab.current[0])),
    Math.min(1 - stampHeight, Math.max(0, point[1] - stampGrab.current[1])),
  ];
  const preview: CheckShape | null = live
    ? {
        type: "area",
        rect: {
          left: Math.min(live.from[0], live.to[0]),
          top: Math.min(live.from[1], live.to[1]),
          width: Math.abs(live.to[0] - live.from[0]),
          height: Math.abs(live.to[1] - live.from[1]),
        },
      }
    : null;

  // Where a picked point's grips, + and result bar go.
  const ends: { start: Point; end: Point } | null =
    selectedShape?.type === "trace"
      ? { start: selectedShape.segments[0][0], end: selectedShape.segments[selectedShape.segments.length - 1][1] }
      : null;
  // Centred under the point, where it stays on the sheet whichever end it was drawn from.
  const barAt: Point | null = selectedBox ? [selectedBox.left + selectedBox.width / 2, selectedBox.top + selectedBox.height] : null;

  const dragGrip = (which: "start" | "end") => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!selected || selected.shape.type !== "trace") return;
      // With a pencil about, a finger only ever moves the sheet — even when it lands on a grip.
      if (pencil && event.pointerType === "touch") return;
      // Only the grip itself, not the finger-sized space round it: where wires run close together
      // a new stroke often starts there, and it must draw, not drag the last wire's end.
      const box = event.currentTarget.getBoundingClientRect();
      const reach = event.pointerType === "touch" ? 22 : 15;
      if (Math.hypot(event.clientX - (box.left + box.width / 2), event.clientY - (box.top + box.height / 2)) > reach) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setGrip({ which, shape: selected.shape });
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!grip || grip.which !== which || grip.shape.type !== "trace") return;
      event.stopPropagation();
      const point = at(event);
      const segments = grip.shape.segments.map(([a, b]) => [a, b] as [Point, Point]);
      if (which === "start") {
        const [a, b] = segments[0];
        segments[0] = [along(point, b, a), b];
      } else {
        const last = segments.length - 1;
        const [a, b] = segments[last];
        segments[last] = [a, along(point, a, b)];
      }
      setGrip({ which, shape: { type: "trace", segments } });
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!grip || grip.which !== which || !selected) return;
      event.stopPropagation();
      // A run dragged down to nothing would leave a wire you can't see: keep it as it was.
      const collapsed = grip.shape.type === "trace" && grip.shape.segments.some(([a, b]) => Math.hypot(b[0] - a[0], (b[1] - a[1]) / aspect) < 0.004);
      if (!collapsed) onReshape?.(selected, grip.shape);
      setGrip(null);
    },
  });

  return (
    <div
      ref={host}
      data-check-layer
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => show(hover.current, false)}
      // Always there for a pencil — it draws even with PAN picked — while a mouse or
      // finger with PAN falls through to the scroller (`down` lets it go).
      className={cn("absolute inset-0", tool === "stamp" ? "cursor-move" : tool !== "pan" && canDraw ? "cursor-crosshair" : "")}
      // A size container: the points are sized in `cqw`, hundredths of the page's width.
      style={{ touchAction: listening ? "none" : undefined, containerType: "size" }}
    >
      {page === 1 && (showStamp || tool === "stamp") && (
        <div
          data-stamp
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute border-2 border-dashed border-red-700 bg-red-700/5",
            tool === "stamp" && canDraw && "bg-red-700/10 shadow-lg",
            movingStamp && "border-solid"
          )}
          style={{ left: `${stamp[0] * 100}%`, top: `${stamp[1] * 100}%`, width: `${STAMP_WIDTH * 100}%`, height: `${stampHeight * 100}%` }}
        >
          <span className="absolute left-1 top-0.5 whitespace-nowrap text-xs font-medium text-red-700">
            {tool === "stamp" && canDraw ? "Sign-off stamp — drag to move" : "Sign-off stamp"}
          </span>
        </div>
      )}
      {onPage.map((point) => {
        const shape = shown(point);
        const picked = point.id === selectedId;
        return (
          <PointMarks
            key={`${point.id}:${point.status}:${point.removal}:${picked}:${JSON.stringify(shape)}`}
            shape={shape}
            status={point.status}
            selected={picked}
            removal={point.removal}
            aspect={aspect}
            opacity={dimmed.includes(point.id) ? 0.3 : 1}
          />
        );
      })}
      {preview && <PointMarks shape={preview} status="pending" selected={false} aspect={aspect} opacity={0.8} />}
      <svg viewBox={`0 0 1 ${1 / aspect}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {/* The stroke in progress — drawn by `paint`, not by React. */}
        <line
          ref={axis}
          style={{ display: "none" }}
          stroke="#1d4ed8"
          strokeOpacity={0.4}
          strokeWidth={1}
          strokeDasharray="10 6"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          ref={ink}
          style={{ display: "none" }}
          fill="none"
          stroke={CHECK_INK.pass.hex}
          strokeOpacity={0.6}
          strokeWidth={WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          ref={guide}
          style={{ display: "none" }}
          stroke="#1d4ed8"
          strokeWidth={2.5}
          strokeDasharray="9 5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <span
        ref={chip}
        aria-hidden="true"
        style={{ display: "none" }}
        className={cn(
          "pointer-events-none absolute -translate-y-[160%] whitespace-nowrap rounded-full bg-blue-900 px-3 py-1 font-mono text-sm font-semibold text-white shadow-lg",
          hand === "left" ? "translate-x-3" : "-translate-x-[calc(100%+12px)]"
        )}
      />
      <span
        ref={hover}
        aria-hidden="true"
        style={{ display: "none" }}
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-yellow-500 bg-yellow-300/40"
      />
      <div
        ref={loupe}
        aria-hidden="true"
        style={{ display: "none", width: LOUPE, height: LOUPE }}
        className="pointer-events-none fixed left-0 top-0 z-[60] overflow-hidden rounded-full bg-white shadow-2xl ring-4 ring-white outline outline-1 outline-slate-900/40"
      >
        <canvas ref={loupeCanvas} className="block h-full w-full" />
      </div>

      {/* Tap targets while panning: one per point, over its shape — areas first, so a wire inside one sits on top. */}
      {!listening &&
        onPage
          .filter((point) => !dimmed.includes(point.id))
          .sort((a, b) => Number(a.shape.type !== "area") - Number(b.shape.type !== "area"))
          .map((point) => {
          const box = shapeBounds(point.shape);
          const pad = 0.004;
          return (
            <button
              key={point.id}
              type="button"
              aria-label={`Check point ${point.label}`}
              aria-pressed={point.id === selectedId}
              onClick={() => onPick(point)}
              className="pointer-events-auto absolute rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
              style={{
                left: `${(box.left - pad) * 100}%`,
                top: `${(box.top - pad * aspect) * 100}%`,
                width: `${(box.width + pad * 2) * 100}%`,
                height: `${(box.height + pad * 2 * aspect) * 100}%`,
              }}
            />
          );
        })}

      {selected && selectedBox && (
        <span
          className="pointer-events-none absolute -translate-y-full whitespace-nowrap rounded bg-orange-600 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow"
          style={{ left: `${selectedBox.left * 100}%`, top: `calc(${selectedBox.top * 100}% - 4px)` }}
        >
          {selected.label}
        </span>
      )}

      {selected && canDraw && ends && onReshape && (
        <>
          {(["start", "end"] as const).map((which) => (
            <button
              key={which}
              type="button"
              aria-label={`Drag the ${which} of ${selected.label}`}
              {...dragGrip(which)}
              className="pointer-events-auto absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center"
              style={{ left: `${ends[which][0] * 100}%`, top: `${ends[which][1] * 100}%` }}
            >
              <span className="block h-6 w-6 rounded-full border-4 border-orange-600 bg-white shadow" />
            </button>
          ))}
          {onExtendStart && (
            <button
              type="button"
              aria-label={`Carry ${selected.label} on round a corner`}
              title="Carry on round a corner"
              data-pencil-through
              onPointerDown={(event) => {
                if (event.pointerType !== "pen") event.stopPropagation();
              }}
              onClick={onExtendStart}
              // Above the end, clear of the result bar below the wire.
              className="pointer-events-auto absolute flex h-11 w-11 translate-x-1 -translate-y-14 items-center justify-center"
              style={{ left: `${ends.end[0] * 100}%`, top: `${ends.end[1] * 100}%` }}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-white shadow">
                <Plus size={18} aria-hidden="true" />
              </span>
            </button>
          )}
        </>
      )}

      {selected && canDraw && barAt && onMark && !grip && (
        <div
          role="group"
          aria-label={`Result for ${selected.label}`}
          // Where wires run close, the bar sits over the next ones down: a pencil goes through it,
          // so a stroke can start there — a pencil tap still presses a button (see `up`).
          onPointerDown={(event) => {
            if (event.pointerType !== "pen") event.stopPropagation();
          }}
          className={cn(
            "pointer-events-auto absolute z-10 flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900",
            "-translate-x-1/2 translate-y-7"
          )}
          style={{ left: `${barAt[0] * 100}%`, top: `${barAt[1] * 100}%` }}
        >
          <button
            type="button"
            data-pencil-through
            onClick={() => onMark("pass")}
            aria-pressed={selected.status === "pass"}
            className="h-14 min-w-24 rounded-xl bg-emerald-700 px-4 text-base font-bold text-white hover:bg-emerald-800"
          >
            {selected.removal ? "Removed" : "Pass"}
          </button>
          <button
            type="button"
            data-pencil-through
            onClick={() => onMark("fault")}
            aria-pressed={selected.status === "fault"}
            className="h-14 min-w-20 rounded-xl border-2 border-red-300 bg-red-50 px-3 text-base font-bold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
          >
            Fault
          </button>
          <button
            type="button"
            data-pencil-through
            onClick={() => onMark("na")}
            aria-pressed={selected.status === "na"}
            className="h-14 min-w-16 rounded-xl border-2 border-slate-300 px-3 text-base font-bold text-slate-700 dark:border-slate-600 dark:text-slate-200"
          >
            N/A
          </button>
          {onDelete && (
            <button
              type="button"
              data-pencil-through
              aria-label={`Delete ${selected.label}`}
              onClick={() => onDelete(selected)}
              className="flex h-14 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          )}
          <span className="sr-only">{resultLabel(selected)}</span>
        </div>
      )}
    </div>
  );
}
