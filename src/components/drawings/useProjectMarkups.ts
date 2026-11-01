"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteMarkup, listMarkups, saveMarkup } from "@/lib/drawings/drawingStore";
import type { DrawingMarkup } from "@/lib/drawings/drawingMarkups";

/**
 * A project's drawing markups, loaded once and kept in step as they change here.
 * Shared by the Drawings tab and the QA/QC Issues tab.
 */
export function useProjectMarkups(projectId: string) {
  const [markups, setMarkups] = useState<DrawingMarkup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The list as the latest change left it — state lags a render behind. */
  const latest = useRef<DrawingMarkup[]>([]);

  const reload = useCallback(async () => {
    try {
      const list = await listMarkups(projectId);
      latest.current = list;
      setMarkups(list);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn't load the markups.");
      setMarkups([]);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  /** Save one or more markups; the list updates once they're stored. */
  const save = useCallback(async (...changed: DrawingMarkup[]) => {
    for (const markup of changed) await saveMarkup(markup);
    const ids = new Set(changed.map((markup) => markup.id));
    latest.current = [...latest.current.filter((markup) => !ids.has(markup.id)), ...changed];
    setMarkups(latest.current);
  }, []);

  const remove = useCallback(async (markup: DrawingMarkup) => {
    await deleteMarkup(markup);
    latest.current = latest.current.filter((one) => one.id !== markup.id);
    setMarkups(latest.current);
  }, []);

  return { markups, error, save, remove, reload, latest };
}
