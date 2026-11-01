import Link from "next/link";
import { CheckCircle2, FileSearch, PenLine, Send, ShieldCheck, Tablet } from "lucide-react";
import { Logo } from "@/components/Logo";

const FEATURES = [
  {
    icon: FileSearch,
    title: "Every word on every sheet, searchable",
    body: "Drop a drawing set — loose PDFs or a zip — and FieldMark reads each sheet's number, revision and title block. Search a cable tag or terminal across the whole set and land on the exact spot, highlighted.",
  },
  {
    icon: PenLine,
    title: "Issues and redlines on the drawing",
    body: "Clouds, arrows, callouts, pen and highlighter, straight onto the sheet. Track each issue open → sent → fixed, and the PDF on file stays exactly as issued.",
  },
  {
    icon: CheckCircle2,
    title: "Point-to-point commissioning",
    body: "Package a panel's drawings, trace each conductor and mark it pass, fault or N/A. Revision triangles keep other projects' clouds out of scope. Sign each sheet with a witness and hand over one PDF.",
  },
  {
    icon: Send,
    title: "Send it to whoever has to fix it",
    body: "A marked-up copy with only the markups that matter, a close-up of each, and a list page, emailed to the drafter in two taps. Replies come back to you.",
  },
  {
    icon: Tablet,
    title: "Built for site",
    body: "Works in the browser on a tablet, a phone or a desk. Sheets you've opened stay on the device and open instantly next time.",
  },
  {
    icon: ShieldCheck,
    title: "Your drawings stay yours",
    body: "Stored privately for your company only. Exported copies have scripts and form fields stripped before they leave.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo className="text-lg" />
          <nav className="flex items-center gap-2 text-sm">
            <a href="#pricing" className="rounded-lg px-3 py-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
              Pricing
            </a>
            <Link href="/projects" className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
              Open FieldMark
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="bg-gradient-to-b from-brand-50 to-white px-4 py-20 dark:from-brand-950/40 dark:to-slate-950">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">For electrical and instrumentation teams</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              Find it on the drawings. Mark it up. Sign it off.
            </h1>
            <p className="mt-5 text-lg text-slate-600 dark:text-slate-300">
              FieldMark turns a project&apos;s drawing set into a searchable register, puts QA/QC issues and redlines on the
              sheet where they belong, and runs point-to-point commissioning through to a signed handover pack.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/projects" className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-brand-700">
                Try it free
              </Link>
              <a href="#features" className="rounded-xl border border-slate-300 px-6 py-3 font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900">
                See what it does
              </a>
            </div>
          </div>
        </section>

        <section id="features" className="px-4 py-16">
          <ul className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl border border-slate-200 p-6 dark:border-slate-800">
                <Icon size={24} className="text-brand-600 dark:text-brand-400" aria-hidden="true" />
                <h2 className="mt-3 font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="pricing" className="bg-slate-50 px-4 py-16 dark:bg-slate-900/50">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">Simple pricing</h2>
            <p className="mt-2 text-slate-600 dark:text-slate-400">Pricing is being finalised — early teams get in free while we&apos;re in beta.</p>
            <div className="mt-8 grid gap-6 text-left sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="font-semibold">Solo</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">One person, one device. Everything kept in your browser.</p>
                <p className="mt-4 text-3xl font-bold">Free</p>
              </div>
              <div className="rounded-2xl border-2 border-brand-500 bg-white p-6 dark:bg-slate-900">
                <h3 className="font-semibold">Team</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Shared projects, cloud storage, email sending, and every device in sync.</p>
                <p className="mt-4 text-3xl font-bold">Coming soon</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 px-4 py-8 text-sm text-slate-500 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <Logo withName className="text-slate-700 dark:text-slate-300" />
          <span>© {new Date().getFullYear()} FieldMark</span>
        </div>
      </footer>
    </div>
  );
}
