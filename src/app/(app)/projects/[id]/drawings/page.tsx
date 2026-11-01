"use client";

import { use } from "react";
import { ProjectFrame } from "@/components/ProjectFrame";
import { ProjectDrawings } from "@/components/drawings/ProjectDrawings";

/** A project's drawing register, viewer and markups, and its commissioning packages. */
export default function ProjectDrawingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ProjectFrame id={id} tab="drawings">
      {(project) => <ProjectDrawings project={project} />}
    </ProjectFrame>
  );
}
