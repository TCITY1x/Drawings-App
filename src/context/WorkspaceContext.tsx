"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Recipient } from "@/lib/drawings/drawingMarkups";
import type { Member } from "@/lib/members";
import type { Project } from "@/lib/projects";
import { EMPTY_WORKSPACE, loadWorkspace, storeWorkspace, type Profile, type Workspace } from "@/lib/workspaceStore";

/**
 * Who is using FieldMark and what they're working on — what the drawings
 * screens need from outside themselves: the signed-in person, their company
 * (printed on packages), their team (offered when assigning and signing),
 * their projects, and the addresses they've sent drawings to before.
 */
interface WorkspaceValue {
  /** False until this device's workspace has been read. */
  hydrated: boolean;
  profile: Profile | null;
  /** The signed-in person's email, or null before the workspace is set up. */
  userEmail: string | null;
  businessName: string;
  /** The signed-in person as a member — their team entry, or one made from their profile. */
  me: Member | null;
  members: Member[];
  projects: Project[];
  recipients: Recipient[];
  setProfile: (profile: Profile) => void;
  setMembers: (members: Member[]) => void;
  saveProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setRecipients: (recipients: Recipient[]) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspace(loadWorkspace());
    setHydrated(true);
  }, []);

  const update = useCallback((change: (current: Workspace) => Workspace) => {
    setWorkspace((current) => {
      const next = change(current);
      storeWorkspace(next);
      return next;
    });
  }, []);

  const value = useMemo<WorkspaceValue>(
    () => ({
      hydrated,
      profile: workspace.profile,
      userEmail: workspace.profile ? workspace.profile.email.trim().toLowerCase() || workspace.profile.name : null,
      businessName: workspace.profile?.company ?? "",
      me: workspace.profile
        ? workspace.members.find(
            (member) => member.email && member.email.trim().toLowerCase() === workspace.profile!.email.trim().toLowerCase()
          ) ?? { id: "me", name: workspace.profile.name, email: workspace.profile.email, active: true }
        : null,
      members: workspace.members,
      projects: workspace.projects,
      recipients: workspace.recipients,
      setProfile: (profile) => update((current) => ({ ...current, profile })),
      setMembers: (members) => update((current) => ({ ...current, members })),
      saveProject: (project) =>
        update((current) => ({
          ...current,
          projects: [...current.projects.filter((one) => one.id !== project.id), project],
        })),
      removeProject: (id) => update((current) => ({ ...current, projects: current.projects.filter((one) => one.id !== id) })),
      setRecipients: (recipients) => update((current) => ({ ...current, recipients })),
    }),
    [hydrated, workspace, update]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  return value;
}
