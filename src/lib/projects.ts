/**
 * A project: the drawings, markups and commissioning packages for one job of
 * work. Pure and free of relative imports so `node --test` can load it.
 */

export interface ProjectContact {
  name: string;
  email: string;
  /** "Drafter", "Client's engineer"… shown beside them when sending. */
  role: string;
}

export interface Project {
  id: string;
  /** The project or job number people quote, e.g. "P-1042". */
  number: string;
  name: string;
  client: string;
  contacts: ProjectContact[];
  createdAt: string;
  updatedAt: string;
  /** Set when archived; archived projects are hidden from the list. */
  archivedAt: string;
}

/** The label a project goes by: "P-1042 · Substation 9 upgrade". */
export function projectLabel(project: Pick<Project, "number" | "name">): string {
  return [project.number.trim(), project.name.trim()].filter(Boolean).join(" · ") || "Untitled project";
}

export function newProject(input: { number: string; name: string; client: string }, now = new Date().toISOString()): Project {
  return {
    id: crypto.randomUUID(),
    number: input.number.trim(),
    name: input.name.trim(),
    client: input.client.trim(),
    contacts: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: "",
  };
}

/** A stored row back into a project, whatever wrote it. */
export function sanitizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (!text(r.id)) return null;
  const createdAt = text(r.createdAt) || new Date(0).toISOString();
  return {
    id: text(r.id),
    number: text(r.number),
    name: text(r.name),
    client: text(r.client),
    contacts: (Array.isArray(r.contacts) ? r.contacts : [])
      .map((one) => (one ?? {}) as Record<string, unknown>)
      .map((one) => ({ name: text(one.name), email: text(one.email).trim(), role: text(one.role) }))
      .filter((one) => one.email || one.name),
    createdAt,
    updatedAt: text(r.updatedAt) || createdAt,
    archivedAt: text(r.archivedAt),
  };
}

/** Newest activity first; archived last. */
export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || b.updatedAt.localeCompare(a.updatedAt)
  );
}
