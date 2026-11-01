import { cn } from "@/lib/cn";

/** The SitePax mark: a sheet with a revision cloud's tick. */
export function Logo({ className, withName = true }: { className?: string; withName?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7 shrink-0">
        <rect x="4" y="3" width="24" height="26" rx="4" className="fill-brand-600" />
        <path d="M9 10h14M9 15h9" stroke="white" strokeWidth="2" strokeLinecap="round" opacity=".55" />
        <path d="M10.5 21.5l3.5 3.5 8-9" stroke="#facc15" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withName && <span>SitePax</span>}
    </span>
  );
}
