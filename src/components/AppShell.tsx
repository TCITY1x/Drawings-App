"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, LogOut, Users, X } from "lucide-react";
import { CreateCompany, SignIn } from "@/components/CloudGate";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/fields";
import { useWorkspace } from "@/context/WorkspaceContext";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/settings", label: "Team", icon: Users },
];

/**
 * The signed-in frame: header and nav, and whatever has to come first —
 * locally, the one-time "who are you" step; in the cloud, signing in and
 * choosing or creating a company.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { mode, authState, profile, cloud, error, clearError } = useWorkspace();
  const pathname = usePathname();
  const companies = cloud?.memberships ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/projects" aria-label="SitePax projects">
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname.startsWith(href) ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
                  pathname.startsWith(href)
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                )}
              >
                <Icon size={16} aria-hidden="true" /> {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
            {mode === "local" && (
              <span
                className="hidden rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 sm:inline dark:bg-amber-500/15 dark:text-amber-300"
                title="Everything is kept in this browser until accounts are switched on."
              >
                Saved on this device
              </span>
            )}
            {cloud && companies.length > 1 && (
              <select
                aria-label="Company"
                value={cloud.membership?.organisationId ?? ""}
                onChange={(event) => cloud.chooseCompany(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {companies.map((one) => (
                  <option key={one.organisationId} value={one.organisationId}>
                    {one.organisationName}
                  </option>
                ))}
              </select>
            )}
            {profile && (
              <span className="hidden truncate md:inline">
                {profile.name}
                {cloud && companies.length <= 1 && profile.company ? ` · ${profile.company}` : ""}
              </span>
            )}
            {cloud && (
              <button
                type="button"
                onClick={() => void cloud.signOut()}
                aria-label="Sign out"
                title="Sign out"
                className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>
      {error && (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={clearError} aria-label="Dismiss" className="rounded p-1 hover:bg-red-100 dark:hover:bg-red-500/20">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <main className="flex-1 px-4 py-6">
        {authState === "loading" ? (
          <div className="mx-auto h-64 max-w-6xl animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/50" aria-busy="true" aria-label="Loading" />
        ) : authState === "ready" ? (
          children
        ) : mode === "local" ? (
          <Welcome />
        ) : authState === "signed-out" ? (
          <SignIn />
        ) : (
          <CreateCompany />
        )}
      </main>
    </div>
  );
}

function Welcome() {
  const { setProfile } = useWorkspace();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const ready = name.trim() !== "";

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-xl font-semibold">Welcome to SitePax</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Your name goes on markups and sign-offs, and your company on commissioning packages.
      </p>
      <form
        className="mt-5 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setProfile({ name: name.trim(), email: email.trim(), company: company.trim() });
        }}
      >
        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required className={inputClass} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={inputClass} />
        </Field>
        <Field label="Company">
          <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" className={inputClass} />
        </Field>
        <Button type="submit" variant="primary" disabled={!ready} className="w-full">
          Get started
        </Button>
      </form>
    </div>
  );
}
