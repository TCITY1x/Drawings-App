"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProjectForm } from "@/components/ProjectForm";
import { useWorkspace } from "@/context/WorkspaceContext";
import { formatDate } from "@/lib/format";
import { newProject, sortProjects } from "@/lib/projects";

export default function ProjectsPage() {
  const { projects, saveProject } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const list = sortProjects(projects).filter((project) => !project.archivedAt);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Each project has its own drawing register, markups and commissioning packages.</p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={15} aria-hidden="true" /> New project
          </span>
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center dark:border-slate-800">
          <FolderKanban size={32} className="text-brand-500" aria-hidden="true" />
          <p className="font-semibold">No projects yet</p>
          <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
            Make one, then drop its drawing set in — PDFs or a .zip — and every sheet becomes searchable.
          </p>
          <Button variant="primary" onClick={() => setAdding(true)}>
            Make your first project
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}/drawings`}
                className="block h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/50"
              >
                <p className="font-mono text-sm text-brand-700 dark:text-brand-300">{project.number || "—"}</p>
                <p className="mt-0.5 font-semibold">{project.name || "Untitled project"}</p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {[project.client, `Updated ${formatDate(project.updatedAt)}`].filter(Boolean).join(" · ")}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <ProjectForm
          title="New project"
          initial={{ number: "", name: "", client: "", contacts: [] }}
          onCancel={() => setAdding(false)}
          onSave={(details) => {
            const project = { ...newProject(details), contacts: details.contacts };
            saveProject(project);
            setAdding(false);
            router.push(`/projects/${project.id}/drawings`);
          }}
        />
      )}
    </div>
  );
}
