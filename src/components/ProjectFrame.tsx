"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { ChevronLeft, FolderKanban, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProjectForm } from "@/components/ProjectForm";
import { useWorkspace } from "@/context/WorkspaceContext";
import { cn } from "@/lib/cn";
import type { Project } from "@/lib/projects";

const TABS = [
  { key: "drawings", label: "Drawings" },
  { key: "issues", label: "Issues" },
] as const;

/** A project's header and tabs around one of its screens. */
export function ProjectFrame({
  id,
  tab,
  children,
}: {
  id: string;
  tab: (typeof TABS)[number]["key"];
  children: (project: Project) => React.ReactNode;
}) {
  const { projects, saveProject } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const project = projects.find((one) => one.id === id);

  if (!project) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <FolderKanban size={32} className="text-slate-400" aria-hidden="true" />
        <p className="font-semibold">Project not found</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">It may have been deleted, or it was made in another browser.</p>
        <Link href="/projects" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <ChevronLeft size={14} aria-hidden="true" /> Projects
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">
            {project.number && <span className="mr-2 font-mono text-brand-700 dark:text-brand-300">{project.number}</span>}
            {project.name || "Untitled project"}
          </h1>
          {project.client && <p className="text-sm text-slate-600 dark:text-slate-400">{project.client}</p>}
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Pencil size={14} aria-hidden="true" /> Details &amp; contacts
          </span>
        </Button>
      </div>
      <nav aria-label="Project" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map(({ key, label }) => (
          <Link
            key={key}
            href={`/projects/${project.id}/${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px min-h-10 border-b-2 px-4 py-2 text-sm font-medium",
              tab === key
                ? "border-brand-600 text-brand-800 dark:border-brand-400 dark:text-brand-200"
                : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/50" aria-busy="true" />}>
        {children(project)}
      </Suspense>
      {editing && (
        <ProjectForm
          title="Project details"
          initial={project}
          onCancel={() => setEditing(false)}
          onSave={(details) => {
            saveProject({ ...project, ...details, updatedAt: new Date().toISOString() });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
