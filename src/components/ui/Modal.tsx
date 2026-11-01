"use client";

import { useEffect, useId } from "react";
import { cn } from "@/lib/cn";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** `full` takes the whole screen — for a form that needs every pixel, on a tablet. */
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

export function Modal({ isOpen, onClose, title, children, size = "md" }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <div
            className={cn(
              "fixed inset-0 z-50 flex items-center justify-center pointer-events-none",
              size !== "full" && "p-4"
            )}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "pointer-events-auto flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900 dark:shadow-black/50",
                size === "sm" && "max-w-sm",
                size === "md" && "max-w-md",
                size === "lg" && "max-w-lg",
                // Wide enough for a page of A4 to be read, not just filled in.
                size === "xl" && "max-w-5xl",
                size === "full" && "h-full max-h-none rounded-none"
              )}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 flex-shrink-0 dark:border-slate-800">
                <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  aria-label="Close modal"
                >
                  <X size={20} />
                </button>
              </div>
              <div
                className={cn(
                  "overflow-y-auto flex-1",
                  // Full screen hands its height down, so the content can
                  // stretch to it instead of scrolling inside a scroll.
                  size === "full" ? "flex min-h-0 flex-col px-4 py-3" : "px-6 py-4"
                )}
              >
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
