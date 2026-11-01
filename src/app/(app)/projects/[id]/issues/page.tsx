"use client";

import { use } from "react";
import { ProjectFrame } from "@/components/ProjectFrame";
import { ProjectIssues } from "@/components/drawings/ProjectIssues";

/** Every issue and redline on a project's drawings, in one list. */
export default function ProjectIssuesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ProjectFrame id={id} tab="issues">
      {(project) => <ProjectIssues project={project} />}
    </ProjectFrame>
  );
}
