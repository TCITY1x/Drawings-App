"use client";

import { Suspense } from "react";
import { CloudTeam } from "@/components/team/CloudTeam";
import { LocalTeam } from "@/components/team/LocalTeam";
import { useWorkspace } from "@/context/WorkspaceContext";

/** You, your company, and the team offered when assigning packages and signing sheets. */
export default function SettingsPage() {
  const { mode } = useWorkspace();
  // CloudTeam's billing card reads ?billing=… on the way back from Stripe.
  return mode === "cloud" ? (
    <Suspense>
      <CloudTeam />
    </Suspense>
  ) : (
    <LocalTeam />
  );
}
