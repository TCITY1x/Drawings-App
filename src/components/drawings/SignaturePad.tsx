"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Draw a signature with a finger, a stylus or a mouse.
 *
 * Pointer events rather than separate mouse and touch handlers — this is
 * filled in on a tablet on site as often as at a desk, and one code path
 * covers all three. `touch-none` stops the browser scrolling the page while
 * somebody is signing it.
 *
 * Drawing is NOT the whole signature. The typed name, the signed-in account
 * and the timestamp are what make the record; this is the mark that goes on
 * the document. So the pad can be left empty and the parent still allows the
 * signature, which is also what keeps signing possible
 * for anyone who cannot draw with a mouse.
 */
export function SignaturePad({
  onChange,
  label = "Signature",
  hint = "Draw your signature above — optional. The typed name, your account and the time are what make the record.",
  initial,
  id,
  invalid,
  describedBy,
}: {
  /** The drawn mark, or null when the pad is empty. */
  onChange: (image: Blob | null) => void;
  label?: string;
  /** Shown under an empty pad. */
  hint?: string;
  /** A signature drawn earlier (PNG data URL), put back on the pad — e.g. from a saved draft. */
  initial?: string;
  /** For a form that moves focus to the pad when it's missing. */
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(Boolean(initial));
  // Only ever the first value: redrawing when the parent echoes the pad's own
  // output back would stack the same strokes.
  const initialRef = useRef(initial);

  // Sized to its own box in device pixels so the line isn't blurry on a
  // retina screen, then scaled back down in CSS.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    canvas.width = box.width * ratio;
    canvas.height = box.height * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#0f172a";
    if (initialRef.current) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, box.width, box.height);
      image.src = initialRef.current;
    }
  }, []);

  const emit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => onChange(blob), "image/png");
  }, [onChange]);

  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = at(event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const { x, y } = at(event);
    context.lineTo(x, y);
    context.stroke();
    if (!drawn) setDrawn(true);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    emit();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setDrawn(false);
    onChange(null);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={!drawn}
          aria-label="Clear the signature"
        >
          <span className="inline-flex items-center gap-1.5">
            <Eraser size={13} /> Clear
          </span>
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        id={id}
        tabIndex={id ? -1 : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        aria-label={`${label} — draw here`}
        className={
          invalid
            ? "h-32 w-full touch-none rounded-lg border border-dashed border-red-400 bg-white dark:border-red-500 dark:bg-slate-100"
            : "h-32 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-100"
        }
      />
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {drawn
          ? "Drawn. Clear it and start again if it isn't right."
          : hint}
      </p>
    </div>
  );
}
