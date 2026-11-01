"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cloud from "@/lib/cloudWorkspace";
import type { Recipient } from "@/lib/drawings/drawingMarkups";
import type { Member } from "@/lib/members";
import type { Project } from "@/lib/projects";
import { getSupabase } from "@/lib/supabase/client";
import { EMPTY_WORKSPACE, loadWorkspace, storeWorkspace, type Profile, type Workspace } from "@/lib/workspaceStore";

/**
 * Who is using SitePax and what they're working on — what the drawings
 * screens need from outside themselves: the signed-in person, their company
 * (printed on packages), their team (offered when assigning and signing),
 * their projects, and the addresses they've sent drawings to before.
 *
 * Two backings, one shape:
 * - local mode (no Supabase configured): this browser's localStorage;
 * - cloud mode: the signed-in user's company in the database
 *   (`cloudWorkspace.ts`), after sign-in and choosing or creating a company.
 */

export type AuthState = "loading" | "signed-out" | "no-company" | "ready";

interface WorkspaceValue {
  mode: "local" | "cloud";
  /** "ready" once there is someone signed in (or set up, locally) with a company to work in. */
  authState: AuthState;
  /** False until the workspace has been read. */
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
  /** The last thing that failed to save or load, in plain words. */
  error: string | null;
  clearError: () => void;
  setProfile: (profile: Profile) => void;
  /** Local mode only: the team is a list kept in this browser. In cloud mode it's managed on the Team page. */
  setMembers: (members: Member[]) => void;
  saveProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setRecipients: (recipients: Recipient[]) => void;
  /** Cloud mode. */
  cloud: CloudState | null;
}

export interface CloudState {
  supabase: SupabaseClient;
  userId: string;
  membership: cloud.Membership | null;
  memberships: cloud.Membership[];
  team: cloud.TeamMember[];
  invitations: cloud.Invitation[];
  chooseCompany: (organisationId: string) => void;
  createCompany: (name: string, yourName: string) => Promise<void>;
  refreshTeam: () => Promise<void>;
  /** Re-read the companies (plan, seats) — after returning from Stripe. */
  refreshCompanies: () => Promise<void>;
  signOut: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabase();
  return supabase ? <CloudProvider supabase={supabase}>{children}</CloudProvider> : <LocalProvider>{children}</LocalProvider>;
}

function meFrom(profile: Profile | null, members: Member[]): Member | null {
  if (!profile) return null;
  const email = profile.email.trim().toLowerCase();
  return (
    members.find((member) => email && member.email.trim().toLowerCase() === email) ?? {
      id: "me",
      name: profile.name,
      email: profile.email,
      active: true,
    }
  );
}

function LocalProvider({ children }: { children: React.ReactNode }) {
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
      mode: "local",
      authState: !hydrated ? "loading" : workspace.profile ? "ready" : "signed-out",
      hydrated,
      profile: workspace.profile,
      userEmail: workspace.profile ? workspace.profile.email.trim().toLowerCase() || workspace.profile.name : null,
      businessName: workspace.profile?.company ?? "",
      me: meFrom(workspace.profile, workspace.members),
      members: workspace.members,
      projects: workspace.projects,
      recipients: workspace.recipients,
      error: null,
      clearError: () => undefined,
      setProfile: (profile) => update((current) => ({ ...current, profile })),
      setMembers: (members) => update((current) => ({ ...current, members })),
      saveProject: (project) =>
        update((current) => ({ ...current, projects: [...current.projects.filter((one) => one.id !== project.id), project] })),
      removeProject: (id) => update((current) => ({ ...current, projects: current.projects.filter((one) => one.id !== id) })),
      setRecipients: (recipients) => update((current) => ({ ...current, recipients })),
      cloud: null,
    }),
    [hydrated, workspace, update]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

const COMPANY_KEY = "sitepax:company";

function rememberedCompany(): string | null {
  try {
    return window.localStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
}

function CloudProvider({ supabase, children }: { supabase: SupabaseClient; children: React.ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<cloud.Membership[] | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [team, setTeam] = useState<cloud.TeamMember[]>([]);
  const [invitations, setInvitations] = useState<cloud.Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [companyLoaded, setCompanyLoaded] = useState(false);
  const report = useCallback((problem: unknown) => setError(problem instanceof Error ? problem.message : String(problem)), []);

  // Who is signed in, now and as it changes.
  useEffect(() => {
    let live = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (live) setUser(data.user ? { id: data.user.id, email: data.user.email ?? "" } : null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? "" } : null);
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const loadCompanies = useCallback(
    async (userId: string, prefer?: string) => {
      const list = await cloud.loadMemberships(supabase, userId);
      setMemberships(list);
      const wanted = prefer ?? rememberedCompany();
      setCompanyId(list.find((one) => one.organisationId === wanted)?.organisationId ?? list[0]?.organisationId ?? null);
    },
    [supabase]
  );

  const userId = user?.id;
  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMemberships(null);
      setCompanyId(null);
      return;
    }
    loadCompanies(userId).catch(report);
  }, [userId, loadCompanies, report]);

  const refreshTeam = useCallback(async () => {
    if (!companyId) return;
    const next = await cloud.loadTeam(supabase, companyId);
    setTeam(next.members);
    setInvitations(next.invitations);
  }, [supabase, companyId]);

  // The chosen company's projects and team.
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompanyLoaded(false);
    try {
      window.localStorage.setItem(COMPANY_KEY, companyId);
    } catch {
      // Remembering the choice is a convenience.
    }
    Promise.all([cloud.listProjects(supabase, companyId), cloud.loadTeam(supabase, companyId)])
      .then(([list, next]) => {
        if (!live) return;
        setProjects(list);
        setTeam(next.members);
        setInvitations(next.invitations);
        setCompanyLoaded(true);
      })
      .catch(report);
    return () => {
      live = false;
    };
  }, [supabase, companyId, report]);

  const membership = memberships?.find((one) => one.organisationId === companyId) ?? null;
  // Read by the save callbacks without re-creating them on every change.
  const latest = useRef({ membership, projects });
  useEffect(() => {
    latest.current = { membership, projects };
  });

  const authState: AuthState =
    user === undefined || (user && memberships === null)
      ? "loading"
      : !user
        ? "signed-out"
        : !membership
          ? "no-company"
          : companyLoaded
            ? "ready"
            : "loading";

  const value = useMemo<WorkspaceValue>(() => {
    const profile: Profile | null =
      user && membership ? { name: membership.name || user.email, email: user.email, company: membership.organisationName } : null;
    const members: Member[] = team.map(({ id, name, email, active }) => ({ id, name, email, active }));
    const patchMembership = (change: Partial<cloud.Membership>) =>
      setMemberships((current) =>
        (current ?? []).map((one) => (one.organisationId === membership?.organisationId ? { ...one, ...change } : one))
      );
    return {
      mode: "cloud",
      authState,
      hydrated: authState !== "loading",
      profile,
      userEmail: user?.email.toLowerCase() ?? null,
      businessName: membership?.organisationName ?? "",
      me: user ? (members.find((member) => member.id === user.id) ?? meFrom(profile, [])) : null,
      members,
      projects,
      recipients: membership?.recipients ?? [],
      error,
      clearError: () => setError(null),
      setProfile: (next) => {
        const current = latest.current.membership;
        if (!current) return;
        patchMembership({ name: next.name });
        cloud.updateMyMembership(supabase, current.organisationId, next.name, { recipients: current.recipients }).catch(report);
        if (next.company.trim() && next.company !== current.organisationName && current.role !== "member") {
          patchMembership({ organisationName: next.company });
          cloud.renameOrganisation(supabase, current.organisationId, next.company).catch(report);
        }
      },
      setMembers: () => undefined,
      saveProject: (project) => {
        const current = latest.current.membership;
        if (!current) return;
        setProjects((list) => [...list.filter((one) => one.id !== project.id), project]);
        cloud.saveProject(supabase, current.organisationId, project).catch(report);
      },
      removeProject: (id) => {
        setProjects((list) => list.filter((one) => one.id !== id));
        cloud.deleteProject(supabase, id).catch(report);
      },
      setRecipients: (recipients) => {
        const current = latest.current.membership;
        if (!current) return;
        patchMembership({ recipients });
        cloud.updateMyMembership(supabase, current.organisationId, current.name, { recipients }).catch(report);
      },
      cloud: user
        ? {
            supabase,
            userId: user.id,
            membership,
            memberships: memberships ?? [],
            team,
            invitations,
            chooseCompany: setCompanyId,
            createCompany: async (name, yourName) => {
              const id = await cloud.createOrganisation(supabase, name, yourName);
              await loadCompanies(user.id, id);
            },
            refreshTeam,
            refreshCompanies: () => loadCompanies(user.id, membership?.organisationId),
            signOut: async () => {
              await supabase.auth.signOut();
              setProjects([]);
              setTeam([]);
              setInvitations([]);
            },
          }
        : null,
    };
  }, [authState, user, membership, memberships, team, invitations, projects, error, supabase, report, refreshTeam, loadCompanies]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  return value;
}
