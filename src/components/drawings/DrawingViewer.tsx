"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  Expand,
  Eye,
  EyeOff,
  Hand,
  Highlighter,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minus,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Pencil,
  Shrink,
  Square,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { MarkupLayer, type LayerTool } from "@/components/drawings/MarkupLayer";
import { drawingBytes } from "@/lib/drawings/drawingStore";
import { markedUpPdf } from "@/lib/drawings/drawingMarkupExport";
import { matchBoxes, openPdf, pageRuns, runBox, type MatchBox, type PdfPage, type TextRun } from "@/lib/drawings/drawingPdf";
import {
  INK,
  markupBounds,
  markupFileName,
  type DrawingMarkup,
  type InkColour,
  type MarkupShape,
  type Rect,
} from "@/lib/drawings/drawingMarkups";
import { normaliseQuery, type ProjectDrawing } from "@/lib/drawings/drawings";
import { cn } from "@/lib/cn";

/**
 * One drawing, drawn by pdf.js, with every match of the search boxed on it.
 *
 * Drawings are A1 and A0 sheets of 7 pt text, unreadable when the whole sheet
 * fits the screen — so stepping to a match zooms in and centres it, and a
 * small map of the whole sheet beside it shows where every match is and which
 * part is in view. Drag (or scroll) to pan, and pinch (or ctrl-scroll, or a
 * trackpad pinch) to zoom about the fingers; the map can be clicked to jump.
 *
 * The page is redrawn for each zoom at the screen's density, capped so the
 * canvas stays inside what a phone can hold; beyond the cap the drawing is
 * shown a little soft rather than not at all.
 *
 * "Mark up" draws a QA/QC issue or a redline over the sheet (see
 * `MarkupLayer`); Done hands the shapes up to be described and saved. Saved
 * markups are drawn over the sheet with their numbers, can be hidden, and
 * can be downloaded burned into a copy of the PDF — the same copy that's sent.
 *
 * A caller can lay its own `overlay` over the sheet, with a `toolbar` of its
 * own under the header — point-to-point commissioning does, to trace and
 * check off wires — and ask for any box to be zoomed to with `focusBox`.
 * In full screen its `sidebar` takes the whole-sheet map's place, so what
 * the work needs (test criteria, the point in hand) stays beside the sheet —
 * or is put away, kept on this device, to give the sheet the whole width.
 * Marking up takes the sheet over: the caller's toolbar goes and its overlay
 * stops taking pointers until Done or Cancel, so a stroke is never also a
 * trace.
 *
 * Full screen fills the window with the sheet, and asks the browser for real
 * full screen where it allows one (desktop, iPad, Android) to hide its own
 * bars too. iPhone Safari has no full screen for a page, so there it is the
 * window alone.
 */

const TOOLS: { tool: LayerTool; label: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Select — tap a mark to move, resize, edit or delete it", icon: <MousePointer2 size={17} aria-hidden="true" /> },
  { tool: "pan", label: "Pan", icon: <Hand size={17} aria-hidden="true" /> },
  { tool: "highlight", label: "Highlight text", icon: <span aria-hidden="true" className="rounded-sm bg-yellow-300 px-0.5 text-[11px] font-bold leading-4 text-slate-900">Ab</span> },
  { tool: "pen", label: "Pen", icon: <PenLine size={17} aria-hidden="true" /> },
  { tool: "line", label: "Line", icon: <Minus size={17} aria-hidden="true" className="-rotate-45" /> },
  { tool: "arrow", label: "Arrow", icon: <ArrowUpRight size={17} aria-hidden="true" /> },
  { tool: "box", label: "Box", icon: <Square size={16} aria-hidden="true" /> },
  { tool: "cloud", label: "Revision cloud", icon: <Cloud size={17} aria-hidden="true" /> },
  { tool: "text", label: "Text", icon: <Type size={17} aria-hidden="true" /> },
  { tool: "callout", label: "Callout — a note in a box, with an arrow", icon: <MessageSquareText size={17} aria-hidden="true" /> },
];

const COLOURS: InkColour[] = ["red", "blue", "yellow"];

const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];

/** What an overlay drawn over the sheet is told about it. */
export interface OverlayView {
  aspect: number;
  page: number;
  /** The text runs a box on this page touches, in reading order. */
  textIn: (rect: Rect) => string[];
  /** The same runs with where each sits — for finding the rows of a table. */
  runsIn: (rect: Rect) => { box: Rect; str: string }[];
}
/** How far stepping to a match zooms in, at least. */
const MATCH_ZOOM = 4;
/** Canvas pixels — iOS refuses a canvas much past 16.7 million. */
const MAX_PIXELS = 16_000_000;
const MAP_WIDTH = 220;
/** Where this device keeps the full-screen sidebar put away. */
const SIDEBAR_KEY = "drawing-sidebar-hidden";

type Pdf = Awaited<ReturnType<typeof openPdf>>;

/** The caller's overlay, as a component of its own so its text lookup is only ever read in its handlers. */
function Overlay({ render, ...view }: OverlayView & { render: (view: OverlayView) => React.ReactNode }) {
  return <>{render(view)}</>;
}

interface Hit {
  page: number;
  box: MatchBox;
}

export function DrawingViewer({
  drawing,
  title,
  query,
  wholeTag,
  onClose,
  markups = [],
  onMarkupDone,
  focusMarkup = null,
  onPickMarkup,
  onMarkupChange,
  overlay,
  toolbar,
  focusBox = null,
  sidebar,
  markupInk = "red",
}: {
  drawing: ProjectDrawing;
  title: string;
  query: string;
  wholeTag: boolean;
  onClose?: () => void;
  /** Saved markups on this drawing. */
  markups?: DrawingMarkup[];
  /** Turns on "Mark up"; given the shapes drawn when Done is pressed. */
  onMarkupDone?: (input: { page: number; shapes: MarkupShape[] }) => void;
  /** A markup to zoom to; `n` changes to ask again for the same one. */
  focusMarkup?: { id: string; n: number } | null;
  onPickMarkup?: (markup: DrawingMarkup) => void;
  /** A saved markup's mark moved, resized, retyped or removed while marking up: keep it. */
  onMarkupChange?: (markup: DrawingMarkup) => void;
  /** Drawn over the page, scaled with it like ink on the sheet. */
  overlay?: (view: OverlayView) => React.ReactNode;
  /** A row of the caller's own tools, under the header. */
  toolbar?: React.ReactNode;
  /** A box to zoom to; `n` changes to ask again for the same one. */
  focusBox?: { page: number; box: Rect; n: number } | null;
  /** Beside the sheet in full screen, instead of the whole-sheet map. */
  sidebar?: React.ReactNode;
  /** The ink marking up starts in — blue for commissioning, red otherwise. */
  markupInk?: InkColour;
}) {
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [hits, setHits] = useState<Hit[]>([]);
  const [current, setCurrent] = useState(0);
  const [fitWidth, setFitWidth] = useState(0);
  const [aspect, setAspect] = useState(1 / Math.SQRT2);
  const [view, setView] = useState({ left: 0, top: 0, width: 1, height: 1 });
  /** A point to bring into view once the page and zoom it needs are laid out. */
  const [focus, setFocus] = useState<{ hit: Hit; n: number } | null>(null);
  const [full, setFull] = useState(false);
  /** The full-screen sidebar put away, kept on this device. */
  const [sidebarHidden, setSidebarHidden] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(SIDEBAR_KEY) === "1") setSidebarHidden(true);
    } catch {
      // Storage blocked: shown, as it starts.
    }
  }, []);

  const root = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  /**
   * A pinch under way: where the fingers started, the point of the sheet
   * between them (in page fractions) and how far they've spread. The sheet is
   * only scaled with CSS while it lasts — redrawn at the new zoom once it ends.
   */
  const pinch = useRef<{
    dist: number;
    x: number;
    y: number;
    fx: number;
    fy: number;
    zoom: number;
    scale: number;
    scrollLeft: number;
    scrollTop: number;
    mx: number;
    my: number;
  } | null>(null);
  /** After a pinch: the point of the sheet to keep under the fingers once the new zoom is laid out. */
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  // Keyed on the document and page objects themselves: a lookup still in
  // flight for the last drawing can't then hand its page to the next one.
  const pagesOf = useRef(new WeakMap<Pdf, Map<number, PdfPage>>());
  const runsOf = useRef(new WeakMap<PdfPage, TextRun[]>());
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [marking, setMarking] = useState(false);
  const [tool, setTool] = useState<LayerTool>("cloud");
  const [colour, setColour] = useState<InkColour>(markupInk);
  const [draft, setDraft] = useState<MarkupShape[]>([]);
  const [showMarkups, setShowMarkups] = useState(true);
  /** Under the markup tools: where the typing and selection bar goes, off the sheet. */
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  /** This page's text, for snapping "highlight text" to words and labelling an overlay's shapes. */
  const textRuns = useRef<{ box: Rect; str: string }[]>([]);
  const wantsText = marking || Boolean(overlay);

  const enterFull = () => {
    setFull(true);
    const el = root.current;
    if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  };
  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  /** Put the sidebar away or bring it back, keeping what's at the top left of the view where it is as the sheet refits. */
  const toggleSidebar = () => {
    const el = scroller.current;
    if (el) {
      const { cssWidth: width, cssHeight: height } = laidOut.current;
      const box = el.getBoundingClientRect();
      if (width > 0 && height > 0) anchor.current = { fx: (el.scrollLeft - 16) / width, fy: (el.scrollTop - 16) / height, x: box.left, y: box.top };
    }
    const next = !sidebarHidden;
    setSidebarHidden(next);
    try {
      if (next) localStorage.setItem(SIDEBAR_KEY, "1");
      else localStorage.removeItem(SIDEBAR_KEY);
    } catch {
      // Kept for this visit only.
    }
  };

  // While full screen: the page behind can't scroll, Escape leaves, and so
  // does leaving the browser's own full screen (its Escape, or a swipe).
  useEffect(() => {
    if (!full) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") exitFull();
    };
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [full, exitFull]);

  const lookAt = useCallback((hit: Hit) => setFocus((last) => ({ hit, n: (last?.n ?? 0) + 1 })), []);

  // Load the PDF: this device's copy, else the file store's. Keyed on the file, not the
  // record, so editing a title doesn't reopen it.
  const { id: drawingId, fileKey } = drawing;
  useEffect(() => {
    let cancelled = false;
    let loaded: Pdf | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPdf(null);
    setFailure(null);
    setHits([]);
    setFocus(null);
    setPageNumber(1);
    setZoom(1);
    (async () => {
      try {
        const bytes = await drawingBytes({ id: drawingId, fileKey });
        loaded = await openPdf(bytes);
        if (cancelled) return void loaded.loadingTask.destroy();
        setPdf(loaded);
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : "The drawing couldn't be opened.");
      }
    })().catch(() => undefined); // A drawing closed mid-read.
    return () => {
      cancelled = true;
      void loaded?.loadingTask.destroy();
    };
  }, [drawingId, fileKey]);

  const getPage = useCallback(
    async (number: number): Promise<PdfPage | null> => {
      if (!pdf) return null;
      let pages = pagesOf.current.get(pdf);
      if (!pages) {
        pages = new Map();
        pagesOf.current.set(pdf, pages);
      }
      const known = pages.get(number);
      if (known) return known;
      const page = await pdf.getPage(number);
      pages.set(number, page);
      return page;
    },
    [pdf]
  );

  // The text of the page in view, once marking up starts or an overlay wants it.
  useEffect(() => {
    if (!pdf || !wantsText) return;
    let cancelled = false;
    (async () => {
      const page = await getPage(pageNumber);
      if (!page || cancelled) return;
      let runs = runsOf.current.get(page);
      if (!runs) {
        runs = await pageRuns(page);
        runsOf.current.set(page, runs);
      }
      const viewport = page.getViewport({ scale: 1 });
      if (!cancelled) textRuns.current = runs.map((run) => ({ box: runBox(run, viewport), str: run.str }));
    })().catch(() => undefined); // A drawing closed mid-read.
    return () => {
      cancelled = true;
    };
  }, [pdf, wantsText, pageNumber, getPage]);

  const touching = useCallback((rect: Rect) => {
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    return textRuns.current.filter(
      ({ box }) => box.left < right && box.left + box.width > rect.left && box.top < bottom && box.top + box.height > rect.top
    );
  }, []);
  const snapText = useCallback((rect: Rect) => touching(rect).map(({ box }) => box), [touching]);
  const textIn = useCallback(
    (rect: Rect) =>
      touching(rect)
        .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
        .map(({ str }) => str),
    [touching]
  );

  // Zoom to a markup asked for from a list.
  useEffect(() => {
    if (!pdf || !focusMarkup) return;
    const markup = markups.find((one) => one.id === focusMarkup.id);
    if (!markup) return;
    const bounds = markupBounds(markup.shapes, aspect);
    if (!bounds) return;
    // Fill about half the view with it, within the zooms on offer.
    const wanted = 0.5 / Math.max(bounds.width, bounds.height * aspect, 0.02);
    const nextZoom = [...ZOOMS].reverse().find((z) => z <= wanted) ?? 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowMarkups(true);
    setPageNumber(markup.page);
    setZoom(nextZoom);
    lookAt({ page: markup.page, box: bounds });
    // Only when asked: not every time the list of markups changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, focusMarkup]);

  // Zoom to a box the caller asked for — a check point picked from a list.
  useEffect(() => {
    if (!pdf || !focusBox) return;
    const { box } = focusBox;
    const wanted = 0.5 / Math.max(box.width, box.height * aspect, 0.02);
    const nextZoom = [...ZOOMS].reverse().find((z) => z <= wanted) ?? 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPageNumber(focusBox.page);
    setZoom((z) => Math.max(z, nextZoom));
    lookAt({ page: focusBox.page, box });
    // Only when asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, focusBox]);

  // Find the matches on every page.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const found: Hit[] = [];
      if (normaliseQuery(query)) {
        for (let number = 1; number <= pdf.numPages; number += 1) {
          const page = await getPage(number);
          if (!page || cancelled) return;
          let runs = runsOf.current.get(page);
          if (!runs) {
            runs = await pageRuns(page);
            runsOf.current.set(page, runs);
          }
          for (const box of matchBoxes(runs, page.getViewport({ scale: 1 }), query, wholeTag)) found.push({ page: number, box });
        }
      }
      if (cancelled) return;
      setHits(found);
      setCurrent(0);
      if (found[0]) {
        setPageNumber(found[0].page);
        setZoom((z) => Math.max(z, MATCH_ZOOM));
        lookAt(found[0]);
      }
    })().catch(() => undefined); // A drawing closed mid-read.
    return () => {
      cancelled = true;
    };
  }, [pdf, query, wholeTag, getPage, lookAt]);

  // The width a zoom of 1 fills.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFitWidth(Math.max(el.clientWidth - 32, 200));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pdf]);

  const cssWidth = fitWidth * zoom;
  const cssHeight = cssWidth / aspect;
  /** The zoom and size as last laid out, for the pinch and wheel listeners. */
  const laidOut = useRef({ zoom, cssWidth, cssHeight });
  useLayoutEffect(() => {
    laidOut.current = { zoom, cssWidth, cssHeight };
  }, [zoom, cssWidth, cssHeight]);

  // Draw the page at this zoom.
  useEffect(() => {
    if (!pdf || fitWidth === 0) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await getPage(pageNumber);
      const target = canvas.current;
      if (!page || !target || cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      setAspect(natural.width / natural.height);
      const density = Math.min(window.devicePixelRatio || 1, 3);
      const wanted = fitWidth * zoom * density;
      const cap = Math.sqrt(MAX_PIXELS * (natural.width / natural.height));
      const viewport = page.getViewport({ scale: Math.min(wanted, cap) / natural.width });
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.floor(viewport.width);
      offscreen.height = Math.floor(viewport.height);
      const context = offscreen.getContext("2d");
      if (!context) return;
      task = page.render({ canvas: offscreen, canvasContext: context, viewport });
      try {
        await task.promise;
      } catch {
        return; // Cancelled by a newer zoom.
      }
      if (cancelled) return;
      // Swapped in whole, so a zoom never shows a half-drawn sheet.
      target.width = offscreen.width;
      target.height = offscreen.height;
      target.getContext("2d")?.drawImage(offscreen, 0, 0);
    })().catch(() => undefined); // A drawing closed mid-read.
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, zoom, fitWidth, getPage]);

  // The whole-sheet map.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      const page = await getPage(pageNumber);
      const target = mapCanvas.current;
      if (!page || !target || cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (MAP_WIDTH * 2) / natural.width });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      const context = target.getContext("2d");
      if (!context) return;
      await page.render({ canvas: target, canvasContext: context, viewport }).promise.catch(() => undefined);
    })().catch(() => undefined); // A drawing closed mid-read.
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, getPage]);

  const trackView = useCallback(() => {
    const el = scroller.current;
    if (!el || cssWidth === 0) return;
    const pad = 16;
    setView({
      left: Math.max(0, (el.scrollLeft - pad) / cssWidth),
      top: Math.max(0, (el.scrollTop - pad) / cssHeight),
      width: Math.min(1, el.clientWidth / cssWidth),
      height: Math.min(1, el.clientHeight / cssHeight),
    });
  }, [cssWidth, cssHeight]);

  const centreOn = useCallback(
    (x: number, y: number) => {
      const el = scroller.current;
      if (!el) return;
      el.scrollTo({ left: 16 + x * cssWidth - el.clientWidth / 2, top: 16 + y * cssHeight - el.clientHeight / 2 });
      trackView();
    },
    [cssWidth, cssHeight, trackView]
  );

  // Once the page and zoom a step asked for are laid out, bring it into view.
  useLayoutEffect(() => {
    if (!focus || focus.hit.page !== pageNumber || cssWidth === 0) {
      trackView();
      return;
    }
    const { box } = focus.hit;
    centreOn(box.left + box.width / 2, box.top + box.height / 2);
  }, [focus, pageNumber, cssWidth, centreOn, trackView]);

  /** Scroll so the anchored point of the sheet sits under the fingers (or the pointer), and drop the pinch's CSS scale. */
  const settleAnchor = useCallback(() => {
    const el = scroller.current;
    const held = anchor.current;
    if (!el || !held) return;
    anchor.current = null;
    if (sheet.current) sheet.current.style.transform = "";
    const { cssWidth: width, cssHeight: height } = laidOut.current;
    const box = el.getBoundingClientRect();
    el.scrollLeft = 16 + held.fx * width - (held.x - box.left);
    el.scrollTop = 16 + held.fy * height - (held.y - box.top);
  }, []);

  // Once a pinch's zoom is laid out, put what was under the fingers back under them.
  useLayoutEffect(() => {
    settleAnchor();
    trackView();
  }, [cssWidth, cssHeight, settleAnchor, trackView]);

  /** Zoom to `next`, keeping the point of the sheet at fractions (fx, fy) at screen point (x, y). */
  const zoomAbout = useCallback(
    (next: number, fx: number, fy: number, x: number, y: number) => {
      const clamped = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], next));
      anchor.current = { fx, fy, x, y };
      setFocus(null);
      // No change in size, so no layout to wait for.
      if (Math.abs(clamped - laidOut.current.zoom) < 0.001) settleAnchor();
      else setZoom(clamped);
    },
    [settleAnchor]
  );

  // Pinch to zoom with two fingers; ctrl-scroll or a trackpad pinch with a mouse.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const between = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
      dist: Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY),
    });
    const onStart = (event: TouchEvent) => {
      const page = sheet.current;
      const { zoom: from, cssWidth: width, cssHeight: height } = laidOut.current;
      if (event.touches.length !== 2 || !page || width === 0) return;
      const mid = between(event.touches);
      const box = page.getBoundingClientRect();
      pinch.current = {
        dist: Math.max(mid.dist, 1),
        x: mid.x,
        y: mid.y,
        fx: (mid.x - box.left) / width,
        fy: (mid.y - box.top) / height,
        zoom: from,
        scale: 1,
        scrollLeft: el.scrollLeft,
        scrollTop: el.scrollTop,
        mx: mid.x,
        my: mid.y,
      };
      page.style.transformOrigin = `${mid.x - box.left}px ${mid.y - box.top}px`;
    };
    const onMove = (event: TouchEvent) => {
      const held = pinch.current;
      const page = sheet.current;
      if (!held || !page || event.touches.length < 2) return;
      if (event.cancelable) event.preventDefault();
      const mid = between(event.touches);
      held.scale = Math.min(ZOOMS[ZOOMS.length - 1] / held.zoom, Math.max(ZOOMS[0] / held.zoom, mid.dist / held.dist));
      held.mx = mid.x;
      held.my = mid.y;
      // Follow the fingers as they move, and any scrolling since they landed.
      const dx = mid.x - held.x + (el.scrollLeft - held.scrollLeft);
      const dy = mid.y - held.y + (el.scrollTop - held.scrollTop);
      page.style.transform = `translate(${dx}px, ${dy}px) scale(${held.scale})`;
    };
    const onEnd = (event: TouchEvent) => {
      const held = pinch.current;
      if (!held || event.touches.length >= 2) return;
      pinch.current = null;
      zoomAbout(held.zoom * held.scale, held.fx, held.fy, held.mx, held.my);
    };
    // Safari's own page zoom.
    const onGesture = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      const page = sheet.current;
      const { zoom: from, cssWidth: width, cssHeight: height } = laidOut.current;
      if (!event.ctrlKey || !page || width === 0) return;
      event.preventDefault();
      const box = page.getBoundingClientRect();
      const fx = (event.clientX - box.left) / width;
      const fy = (event.clientY - box.top) / height;
      zoomAbout(from * Math.exp(-event.deltaY / 100), fx, fy, event.clientX, event.clientY);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("gesturestart", onGesture);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("wheel", onWheel);
    };
  }, [zoomAbout, failure]);

  const step = (by: number) => {
    if (hits.length === 0) return;
    const next = (current + by + hits.length) % hits.length;
    const hit = hits[next];
    setCurrent(next);
    setPageNumber(hit.page);
    setZoom((z) => Math.max(z, MATCH_ZOOM));
    lookAt(hit);
  };

  const turnPage = (number: number) => {
    setPageNumber(number);
    setFocus(null);
  };

  /** Zoom about the middle of what is in view. */
  const zoomTo = (next: number) => {
    const el = scroller.current;
    if (!el || next === zoom) return;
    const mid = {
      left: (el.scrollLeft + el.clientWidth / 2 - 16) / cssWidth,
      top: (el.scrollTop + el.clientHeight / 2 - 16) / cssHeight,
    };
    lookAt({ page: pageNumber, box: { ...mid, width: 0, height: 0 } });
    setZoom(next);
  };
  const zoomIn = () => zoomTo(ZOOMS.find((z) => z > zoom) ?? zoom);
  const zoomOut = () => zoomTo([...ZOOMS].reverse().find((z) => z < zoom) ?? zoom);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Touch already pans the scroller natively; a mouse needs dragging.
    if (event.pointerType !== "mouse" || event.button !== 0 || !scroller.current) return;
    drag.current = { x: event.clientX, y: event.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const el = scroller.current;
    if (!start || !el) return;
    el.scrollLeft = start.left - (event.clientX - start.x);
    el.scrollTop = start.top - (event.clientY - start.y);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const pageHits = hits.map((hit, index) => ({ ...hit, index })).filter((hit) => hit.page === pageNumber);
  const pageMarkups = showMarkups ? markups.filter((markup) => markup.page === pageNumber) : [];

  const finishMarking = () => {
    if (draft.length > 0) {
      // Describing it happens in a dialog outside the viewer, which full
      // screen would cover.
      exitFull();
      onMarkupDone?.({ page: pageNumber, shapes: draft });
    }
    setDraft([]);
    setMarking(false);
  };
  const cancelMarking = () => {
    setDraft([]);
    setMarking(false);
  };
  /** The drawing with its markups burned in and listed on a last page, as a file to keep. */
  const downloadPdf = async () => {
    setExporting(true);
    setExportProblem(null);
    try {
      const bytes = await drawingBytes({ id: drawing.id, fileKey: drawing.fileKey });
      const blob = await markedUpPdf({
        bytes: bytes.slice(),
        markups,
        projectNumber: "",
        drawingLabel: `${drawing.number}${drawing.revision ? ` rev ${drawing.revision}` : ""}`,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = markupFileName(drawing.fileName || `${drawing.number}.pdf`, markups.map((markup) => markup.number));
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        link.remove();
      }, 1500);
    } catch (error) {
      setExportProblem(error instanceof Error ? error.message : "The marked-up PDF couldn't be made.");
    } finally {
      setExporting(false);
    }
  };
  const searching = Boolean(normaliseQuery(query));
  // The toolbar shrinks on a phone, and in full screen keeps to one slim row
  // so a phone on its side still has most of its height for the sheet.
  const box = full ? "h-9 w-9" : "h-10 w-10 max-sm:h-9 max-sm:w-9";
  const tall = full ? "h-9" : "h-10 max-sm:h-9";
  const divider = "mx-1 h-6 w-px bg-slate-200 max-sm:hidden dark:bg-slate-700";

  return (
    <section
      ref={root}
      aria-label={`Drawing ${drawing.number}`}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden bg-white dark:bg-slate-900",
        full ? "fixed inset-0 z-50 !m-0" : "rounded-2xl border border-slate-200 dark:border-slate-800"
      )}
      style={
        full
          ? {
              paddingTop: "env(safe-area-inset-top)",
              paddingRight: "env(safe-area-inset-right)",
              paddingBottom: "env(safe-area-inset-bottom)",
              paddingLeft: "env(safe-area-inset-left)",
            }
          : undefined
      }
    >
      <div
        className={cn(
          "flex items-center border-b border-slate-200 dark:border-slate-800",
          full ? "gap-2 px-3 py-1" : "flex-wrap justify-between gap-3 px-4 py-3 max-sm:gap-2 max-sm:px-3 max-sm:py-2"
        )}
      >
        <div className={cn("min-w-0", full && "flex-1", full && searching && "max-sm:hidden")}>
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            <span className="font-mono">{drawing.number}</span>
            {title && <span className="font-normal text-slate-600 dark:text-slate-300"> · {title}</span>}
          </p>
          <p className={cn("text-xs text-slate-600 dark:text-slate-400", full && "max-sm:hidden [@media(max-height:500px)]:hidden")}>
            {drawing.revision ? `Rev ${drawing.revision}` : "No revision"}
            {pdf && pdf.numPages > 1 ? ` · page ${pageNumber} of ${pdf.numPages}` : ""}
          </p>
        </div>
        <div className={cn("flex items-center", full ? "ml-auto min-w-0 gap-1 overflow-x-auto" : "flex-wrap gap-1.5 max-sm:gap-1")}>
          {searching && (
            <>
              <button
                type="button"
                aria-label="Previous match"
                onClick={() => step(-1)}
                disabled={hits.length === 0}
                className={cn(box, "flex shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800")}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <span role="status" className="min-w-24 shrink-0 text-center text-sm tabular-nums text-slate-700 max-sm:min-w-10 dark:text-slate-200">
                {hits.length === 0 ? (
                  "No matches"
                ) : (
                  <>
                    <span className="max-sm:hidden">Match </span>
                    {current + 1}
                    <span className="max-sm:hidden"> of </span>
                    <span className="sm:hidden">/</span>
                    {hits.length}
                  </>
                )}
              </span>
              <button
                type="button"
                aria-label="Next match"
                onClick={() => step(1)}
                disabled={hits.length === 0}
                className={cn(box, "flex shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800")}
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
              <span aria-hidden="true" className={divider} />
            </>
          )}
          {pdf && pdf.numPages > 1 && (
            <>
              <button
                type="button"
                onClick={() => turnPage(Math.max(1, pageNumber - 1))}
                disabled={pageNumber <= 1}
                className={cn(tall, "shrink-0 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800")}
              >
                Prev<span className="max-sm:hidden"> page</span>
              </button>
              <button
                type="button"
                onClick={() => turnPage(Math.min(pdf.numPages, pageNumber + 1))}
                disabled={pageNumber >= pdf.numPages}
                className={cn(tall, "shrink-0 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800")}
              >
                Next<span className="max-sm:hidden"> page</span>
              </button>
              <span aria-hidden="true" className={divider} />
            </>
          )}
          <button
            type="button"
            aria-label="Zoom out"
            onClick={zoomOut}
            disabled={zoom <= ZOOMS[0]}
            className={cn(box, "flex shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800")}
          >
            <ZoomOut size={18} aria-hidden="true" />
          </button>
          <span className="w-12 shrink-0 text-center text-xs tabular-nums max-sm:hidden text-slate-600 dark:text-slate-400">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={zoomIn}
            disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
            className={cn(box, "flex shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800")}
          >
            <ZoomIn size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Fit the whole sheet"
            onClick={() => {
              setZoom(1);
              setFocus(null);
            }}
            className={cn(box, "flex shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")}
          >
            <Maximize2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={full ? "Exit full screen" : "Full screen"}
            aria-pressed={full}
            onClick={full ? exitFull : enterFull}
            className={cn(
              tall,
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 max-sm:w-9 max-sm:px-0 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
            )}
          >
            {full ? <Shrink size={15} aria-hidden="true" /> : <Expand size={15} aria-hidden="true" />}
            <span className="hidden sm:inline">{full ? "Exit full screen" : "Full screen"}</span>
          </button>
          {full && sidebar && (
            <button
              type="button"
              aria-pressed={!sidebarHidden}
              aria-label={sidebarHidden ? "Show panel" : "Hide panel"}
              title={sidebarHidden ? "Show panel" : "Hide panel"}
              onClick={toggleSidebar}
              className={cn(
                tall,
                "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 max-sm:w-9 max-sm:px-0 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              )}
            >
              {sidebarHidden ? <PanelRightOpen size={15} aria-hidden="true" /> : <PanelRightClose size={15} aria-hidden="true" />}
              <span className="hidden sm:inline">{sidebarHidden ? "Show panel" : "Hide panel"}</span>
            </button>
          )}
          {markups.length > 0 && (
            <button
              type="button"
              aria-pressed={showMarkups}
              aria-label={showMarkups ? "Hide markups" : "Show markups"}
              title={showMarkups ? "Hide markups" : "Show markups"}
              onClick={() => setShowMarkups((on) => !on)}
              className={cn(box, "flex shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")}
            >
              {showMarkups ? <Eye size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
            </button>
          )}
          {markups.length > 0 && !marking && (
            <button
              type="button"
              aria-label="Download the PDF with its markups"
              title="Download the PDF with its markups"
              onClick={downloadPdf}
              disabled={!pdf || exporting}
              className={cn(box, "flex shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800")}
            >
              {exporting ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
            </button>
          )}
          {onMarkupDone && !marking && (
            <button
              type="button"
              onClick={() => {
                setMarking(true);
                setShowMarkups(true);
              }}
              disabled={!pdf}
              className={cn(
                tall,
                "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 max-sm:w-9 max-sm:px-0"
              )}
            >
              <Pencil size={14} aria-hidden="true" /> <span className="max-sm:sr-only">Mark up</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="Close the drawing"
              onClick={() => {
                exitFull();
                onClose();
              }}
              className={cn(box, "flex shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {marking && (
        <div
          role="toolbar"
          aria-label="Markup tools"
          // One row that scrolls on a phone, so the sheet keeps its height; Cancel and Done stay in reach at the end.
          className="flex items-center gap-1 border-b border-red-200 bg-red-50 px-3 py-2 max-sm:overflow-x-auto max-sm:py-1 sm:flex-wrap dark:border-red-500/30 dark:bg-red-500/10"
        >
          {TOOLS.map((entry) => (
            <button
              key={entry.tool}
              type="button"
              aria-pressed={tool === entry.tool}
              aria-label={entry.label}
              title={entry.label}
              onClick={() => setTool(entry.tool)}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                tool === entry.tool
                  ? "bg-white text-red-700 shadow ring-1 ring-red-300 dark:bg-slate-900 dark:text-red-300"
                  : "text-slate-700 hover:bg-white/70 dark:text-slate-200 dark:hover:bg-slate-800"
              )}
            >
              {entry.icon}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-red-200 dark:bg-red-500/30" />
          {COLOURS.map((ink) => (
            <button
              key={ink}
              type="button"
              aria-pressed={colour === ink}
              aria-label={`${INK[ink].label} ink`}
              title={ink === "yellow" ? "Yellow (highlighter)" : `${INK[ink].label} ink`}
              onClick={() => setColour(ink)}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                colour === ink ? "bg-white shadow ring-1 ring-red-300 dark:bg-slate-900" : "hover:bg-white/70 dark:hover:bg-slate-800"
              )}
            >
              <span className="block h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: INK[ink].hex }}>
                {ink === "yellow" && <Highlighter size={12} className="m-1 text-slate-800" aria-hidden="true" />}
              </span>
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-red-200 dark:bg-red-500/30" />
          <button
            type="button"
            aria-label="Undo"
            title="Undo"
            onClick={() => setDraft((shapes) => shapes.slice(0, -1))}
            disabled={draft.length === 0}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-white/70 disabled:opacity-40 dark:text-slate-200"
          >
            <Undo2 size={17} aria-hidden="true" />
          </button>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 max-sm:sticky max-sm:right-0 max-sm:-mr-3 max-sm:bg-red-50 max-sm:pl-1 max-sm:pr-3 max-sm:dark:bg-slate-900">
            <span className="hidden text-xs text-slate-600 sm:inline dark:text-slate-300">
              {draft.length === 0 ? "Draw on the sheet" : `${draft.length} mark${draft.length === 1 ? "" : "s"}`}
            </span>
            <button
              type="button"
              onClick={cancelMarking}
              className="h-10 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-white/70 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={finishMarking}
              disabled={draft.length === 0}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
            >
              <Check size={15} aria-hidden="true" /> Done
            </button>
          </span>
        </div>
      )}

      {marking && <div ref={setDock} />}
      {exportProblem && (
        <p role="alert" className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {exportProblem}
          <button type="button" aria-label="Dismiss" onClick={() => setExportProblem(null)} className="rounded p-1 hover:bg-red-100 dark:hover:bg-red-500/20">
            <X size={15} aria-hidden="true" />
          </button>
        </p>
      )}

      {!marking && toolbar}

      {failure ? (
        <div className="p-6 text-center text-sm text-slate-600 dark:text-slate-300">
          <p>{failure}</p>
        </div>
      ) : (
        <div className={cn("flex min-h-0", full && "flex-1")}>
          <div
            ref={scroller}
            data-sheet-scroller
            onScroll={trackView}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            // Two fingers zoom the sheet, not the page.
            style={{ touchAction: "pan-x pan-y" }}
            className={cn(
              "relative min-w-0 flex-1 overflow-auto bg-slate-200 p-4 dark:bg-slate-800",
              !full && "h-[60vh] min-h-[360px]",
              zoom > 1 && "cursor-grab active:cursor-grabbing"
            )}
          >
            {!pdf && (
              <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-600 dark:text-slate-300">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Opening the drawing…
              </p>
            )}
            <div
              ref={sheet}
              className={cn("relative bg-white shadow-sm", !pdf && "hidden")}
              style={{ width: cssWidth || undefined, height: cssHeight || undefined }}
            >
              <canvas
                ref={canvas}
                role="img"
                aria-label={`${drawing.number}${searching ? `, ${hits.length} matches for ${normaliseQuery(query)} highlighted` : ""}`}
                className="block h-full w-full select-none"
              />
              {pageHits.map((hit) => (
                <span
                  key={hit.index}
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute rounded-sm bg-yellow-300/50 mix-blend-multiply",
                    hit.index === current && "outline outline-[3px] outline-offset-2 outline-orange-600"
                  )}
                  style={{
                    left: `${hit.box.left * 100}%`,
                    top: `${hit.box.top * 100}%`,
                    width: `${hit.box.width * 100}%`,
                    height: `${hit.box.height * 100}%`,
                    // Never smaller than a fingertip can find at fit-to-screen.
                    minWidth: 6,
                    minHeight: 6,
                  }}
                />
              ))}
              {/* Under the markups, so their number tags stay tappable over it. */}
              {pdf && overlay && (
                <div inert={marking} className={cn("absolute inset-0", marking && "pointer-events-none")}>
                  <Overlay render={overlay} aspect={aspect} page={pageNumber} textIn={textIn} runsIn={touching} />
                </div>
              )}
              {pdf && (pageMarkups.length > 0 || marking) && (
                <MarkupLayer
                  aspect={aspect}
                  markups={pageMarkups}
                  draft={draft}
                  tool={tool}
                  colour={colour}
                  active={marking}
                  focusId={focusMarkup?.id ?? null}
                  dock={dock}
                  onShape={(shape) => setDraft((shapes) => [...shapes, shape])}
                  onDraftChange={(index, shape) =>
                    setDraft((shapes) => (shape ? shapes.map((one, i) => (i === index ? shape : one)) : shapes.filter((_, i) => i !== index)))
                  }
                  snapText={snapText}
                  onPick={onPickMarkup}
                  onMarkupChange={onMarkupChange}
                />
              )}
            </div>
          </div>

          {full && sidebar ? (
            !sidebarHidden && (
              <aside className="flex w-[min(380px,42vw)] shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {sidebar}
              </aside>
            )
          ) : (
          <aside className="hidden w-[252px] shrink-0 flex-col gap-2 border-l border-slate-200 p-4 lg:flex dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Whole sheet{searching ? ` · ${pageHits.length} match${pageHits.length === 1 ? "" : "es"}` : ""}
            </p>
            <button
              type="button"
              aria-label="Jump to a point on the sheet"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                centreOn((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
              }}
              className="relative block w-full overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-600"
              style={{ aspectRatio: aspect }}
            >
              <canvas ref={mapCanvas} className="block h-full w-full" aria-hidden="true" />
              {pageHits.map((hit) => (
                <span
                  key={hit.index}
                  aria-hidden="true"
                  className={cn(
                    "absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1",
                    hit.index === current ? "bg-orange-600 ring-orange-900" : "bg-yellow-400 ring-yellow-800"
                  )}
                  style={{ left: `${(hit.box.left + hit.box.width / 2) * 100}%`, top: `${(hit.box.top + hit.box.height / 2) * 100}%` }}
                />
              ))}
              {zoom > 1 && (
                <span
                  aria-hidden="true"
                  className="absolute border-2 border-indigo-600 bg-indigo-500/10"
                  style={{
                    left: `${view.left * 100}%`,
                    top: `${view.top * 100}%`,
                    width: `${view.width * 100}%`,
                    height: `${view.height * 100}%`,
                  }}
                />
              )}
            </button>
            <p className="text-xs text-slate-600 dark:text-slate-400">The box is what&apos;s in view. Click the sheet to jump there.</p>
          </aside>
          )}
        </div>
      )}
    </section>
  );
}
