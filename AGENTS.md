<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FieldMark

FieldMark is a standalone product: a project's drawing register (searchable
text of every sheet), QA/QC markups and redlines, and point-to-point
commissioning packages. It began as the Drawings tab of an internal ops app;
the code under `src/lib/drawings` and `src/components/drawings` came from
there, with jobs renamed to projects.

- **Local mode** (no Supabase env vars): everything is kept in this browser —
  the workspace in localStorage (`src/lib/workspaceStore.ts`), drawings,
  markups and packages in IndexedDB (`src/lib/drawings/drawingStore.ts`), PDFs
  in IndexedDB (`src/lib/drawings/fileStore.ts`).
- **Cloud mode**: the same stores write to Supabase tables and the private
  `drawings` storage bucket. Schema and row-level security are in
  `supabase/migrations`. Sign-in (email link or code), companies, roles and
  invitations are in `src/lib/cloudWorkspace.ts`, `src/context/WorkspaceContext.tsx`
  (one interface over both modes), `src/components/CloudGate.tsx` and
  `src/components/team/`. Billing is not built yet.
- Access rules live in the database. When adding a table, give it row-level
  security keyed on the organisation, and test the policies as two different
  users before relying on them.
- Pure modules (`*.ts` with no relative imports) are tested with `node --test`;
  keep them free of React and browser APIs.
- Verify with `npm test`, `npx tsc --noEmit`, `npx eslint` and `npm run build`.
