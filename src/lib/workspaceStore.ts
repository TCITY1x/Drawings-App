import { sanitizeProject, type Project } from "@/lib/projects";
import type { Member } from "@/lib/members";
import type { Recipient } from "@/lib/drawings/drawingMarkups";

/**
 * The workspace kept on this device: who you are, your team, your projects
 * and the addresses you've sent to. localStorage, read once at start-up — it
 * is small; the heavy drawing data lives in IndexedDB (`drawingStore.ts`).
 *
 * When accounts are switched on this moves to the organisation's rows in the
 * database; the shape stays the same.
 */

export interface Profile {
  name: string;
  email: string;
  company: string;
}

export interface Workspace {
  profile: Profile | null;
  members: Member[];
  projects: Project[];
  recipients: Recipient[];
}

const KEY = "sitepax:workspace:v1";

export const EMPTY_WORKSPACE: Workspace = { profile: null, members: [], projects: [], recipients: [] };

export function loadWorkspace(): Workspace {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<Workspace> | null;
    if (!raw || typeof raw !== "object") return EMPTY_WORKSPACE;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const profile = raw.profile && typeof raw.profile === "object" && text(raw.profile.name).trim()
      ? { name: text(raw.profile.name), email: text(raw.profile.email), company: text(raw.profile.company) }
      : null;
    return {
      profile,
      members: (Array.isArray(raw.members) ? raw.members : [])
        .filter((m): m is Member => Boolean(m) && typeof m === "object" && typeof m.id === "string")
        .map((m) => ({ id: m.id, name: text(m.name), email: text(m.email), active: m.active !== false })),
      projects: (Array.isArray(raw.projects) ? raw.projects : [])
        .map(sanitizeProject)
        .filter((p): p is Project => p !== null),
      recipients: (Array.isArray(raw.recipients) ? raw.recipients : [])
        .filter((r): r is Recipient => Boolean(r) && typeof r === "object" && typeof r.email === "string")
        .map((r) => ({ email: r.email, name: text(r.name) })),
    };
  } catch {
    return EMPTY_WORKSPACE;
  }
}

export function storeWorkspace(workspace: Workspace): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(workspace));
  } catch {
    // Full or blocked storage: the change holds for this visit only.
  }
}
