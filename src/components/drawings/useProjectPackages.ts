"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deletePackage, listPackages, savePackage } from "@/lib/drawings/drawingStore";
import type { CommissioningPackage } from "@/lib/drawings/commissioning";

/** A project's commissioning packages, loaded once and kept in step as they change here. */
export function useProjectPackages(projectId: string) {
  const [packages, setPackages] = useState<CommissioningPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The list as the latest change left it — state lags a render behind. */
  const latest = useRef<CommissioningPackage[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    try {
      const list = await listPackages(projectId);
      latest.current = list;
      setPackages(list);
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn't load the commissioning packages.");
      setPackages([]);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  /**
   * Save a package. The list updates at once, so ticking points off on site
   * never waits on the network; a failed save is reported and the list is
   * reloaded from what was stored.
   */
  const save = useCallback(
    (pkg: CommissioningPackage) => {
      const stamped = { ...pkg, updatedAt: new Date().toISOString() };
      latest.current = [...latest.current.filter((one) => one.id !== pkg.id), stamped];
      setPackages(latest.current);
      // One write at a time, in order: points are ticked off faster than a
      // round trip, and an older copy must never land after a newer one.
      const write = queue.current.then(async () => {
        try {
          await savePackage(stamped);
          setError(null);
        } catch (problem) {
          setError(problem instanceof Error ? problem.message : "Couldn't save the package.");
          await reload();
        }
      });
      queue.current = write;
      return write;
    },
    [reload]
  );

  const remove = useCallback(async (pkg: CommissioningPackage) => {
    try {
      await deletePackage(pkg);
      latest.current = latest.current.filter((one) => one.id !== pkg.id);
      setPackages(latest.current);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Couldn't delete the package.");
    }
  }, []);

  return { packages, error, save, remove, reload, latest };
}
