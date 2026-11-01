"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/fields";
import { SignaturePad } from "@/components/drawings/SignaturePad";
import { useWorkspace } from "@/context/WorkspaceContext";
import { personLabel } from "@/lib/members";
import {
  pointProgress,
  scopedPoints,
  signBlockers,
  type CommissioningPackage,
  type PackageSheet,
  type SheetSignoff as Signoff,
} from "@/lib/drawings/commissioning";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the signature."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Sign one sheet off: who tested it (and their licence), the client's witness
 * if there is one, the instrument used, and a declaration — each with a drawn
 * signature that goes on the sheet's stamp. Only possible once every point on
 * the sheet is tested and no fault is left open.
 *
 * The details are filled from the last sheet signed in the package, so a run
 * of sheets on the same day is a signature each, not a form each.
 */
export function SheetSignoff({
  pkg,
  sheet,
  current,
  onCancel,
  onSign,
}: {
  pkg: CommissioningPackage;
  sheet: PackageSheet;
  current: { revision: string } | null;
  onCancel: () => void;
  onSign: (signoff: Signoff) => void;
}) {
  const { me, businessName, userEmail } = useWorkspace();
  const last = pkg.sheets
    .map((one) => one.signoff)
    .filter((one): one is Signoff => one !== null)
    .sort((a, b) => b.signedAt.localeCompare(a.signedAt))[0];

  const [tester, setTester] = useState({
    name: last?.tester.name ?? (me ? personLabel(me) : ""),
    company: last?.tester.company ?? businessName,
    detail: last?.tester.detail ?? "",
  });
  const [testerSignature, setTesterSignature] = useState<Blob | null>(null);
  const [witnessed, setWitnessed] = useState(Boolean(last?.witness));
  const [witness, setWitness] = useState({
    name: last?.witness?.name ?? "",
    company: last?.witness?.company ?? "",
    detail: last?.witness?.detail ?? "",
  });
  const [witnessSignature, setWitnessSignature] = useState<Blob | null>(null);
  const [instrument, setInstrument] = useState(last?.instrument ?? { model: "", serial: "", calibrationDue: "" });
  const [declared, setDeclared] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const blockers = signBlockers(sheet, current);
  const progress = pointProgress(scopedPoints(sheet));
  const missing = [
    !tester.name.trim() && "the tester's name",
    witnessed && !witness.name.trim() && "the witness's name",
    !declared && "the declaration",
  ].filter(Boolean);

  const sign = async () => {
    if (blockers.length > 0 || missing.length > 0) return;
    setSaving(true);
    setProblem(null);
    try {
      const now = new Date().toISOString();
      onSign({
        tester: { ...tester, signature: testerSignature ? await blobToDataUrl(testerSignature) : "", at: now },
        witness: witnessed ? { ...witness, signature: witnessSignature ? await blobToDataUrl(witnessSignature) : "", at: now } : null,
        instrument,
        signedBy: userEmail ?? "",
        signedAt: now,
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't sign the sheet.");
      setSaving(false);
    }
  };

  const facts: [string, string][] = [
    ["Points", `${progress.total}`],
    ["Pass", `${progress.pass}`],
    ["N/A", `${progress.na}`],
    ["Rectified", `${progress.rectified}`],
  ];

  return (
    <Modal isOpen onClose={onCancel} title={`Sign off ${sheet.drawingNumber}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {sheet.drawingNumber}
          {sheet.drawingRevision && ` rev ${sheet.drawingRevision}`}
          {sheet.drawingTitle && ` · ${sheet.drawingTitle}`}
        </p>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-600 dark:text-slate-400">{label}</dt>
              <dd className="text-lg font-semibold text-slate-900 dark:text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>

        {blockers.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        )}

        <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Tested by</legend>
          <div className="flex flex-wrap gap-3">
            <Field label="Name" className="flex-[1_1_180px]">
              <input value={tester.name} onChange={(event) => setTester({ ...tester, name: event.target.value })} className={inputClass} />
            </Field>
            <Field label="Company" className="flex-[1_1_180px]">
              <input value={tester.company} onChange={(event) => setTester({ ...tester, company: event.target.value })} className={inputClass} />
            </Field>
            <Field label="Electrical licence no." className="flex-[1_1_140px]">
              <input value={tester.detail} onChange={(event) => setTester({ ...tester, detail: event.target.value })} className={inputClass} />
            </Field>
          </div>
          <SignaturePad
            onChange={setTesterSignature}
            label="Tester's signature"
            hint="Goes on the sheet's sign-off stamp and its title block. The typed name, your account and the time make the record."
          />
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Witnessed by</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
            <input type="checkbox" checked={witnessed} onChange={(event) => setWitnessed(event.target.checked)} className="h-5 w-5 accent-indigo-600" />
            The client witnessed this sheet
          </label>
          {witnessed && (
            <>
              <div className="flex flex-wrap gap-3">
                <Field label="Name" className="flex-[1_1_180px]">
                  <input value={witness.name} onChange={(event) => setWitness({ ...witness, name: event.target.value })} className={inputClass} />
                </Field>
                <Field label="Company" className="flex-[1_1_180px]">
                  <input value={witness.company} onChange={(event) => setWitness({ ...witness, company: event.target.value })} className={inputClass} />
                </Field>
                <Field label="Role" className="flex-[1_1_140px]">
                  <input
                    value={witness.detail}
                    onChange={(event) => setWitness({ ...witness, detail: event.target.value })}
                    placeholder="e.g. Commissioning engineer"
                    className={inputClass}
                  />
                </Field>
              </div>
              <SignaturePad onChange={setWitnessSignature} label="Witness's signature" hint="Hand them the tablet to sign." />
            </>
          )}
        </fieldset>

        <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Test instrument</legend>
          <div className="flex flex-wrap gap-3">
            <Field label="Make / model" className="flex-[2_1_200px]">
              <input value={instrument.model} onChange={(event) => setInstrument({ ...instrument, model: event.target.value })} className={inputClass} />
            </Field>
            <Field label="Serial no." className="flex-[1_1_140px]">
              <input value={instrument.serial} onChange={(event) => setInstrument({ ...instrument, serial: event.target.value })} className={inputClass} />
            </Field>
            <Field label="Calibration due" className="flex-[1_1_140px]">
              <input
                type="date"
                value={instrument.calibrationDue}
                onChange={(event) => setInstrument({ ...instrument, calibrationDue: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </fieldset>

        <label className="flex items-start gap-3 text-sm text-slate-800 dark:text-slate-200">
          <input type="checkbox" checked={declared} onChange={(event) => setDeclared(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
          <span>
            Every highlighted conductor and component on this sheet was verified point to point against the drawing, and any faults found
            were rectified and re-tested.
          </span>
        </label>

        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {blockers.length === 0 && missing.length > 0 && (
            <span className="mr-auto text-xs text-slate-600 dark:text-slate-400">Still needed: {missing.join(", ")}.</span>
          )}
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void sign()} disabled={saving || blockers.length > 0 || missing.length > 0}>
            Sign off sheet
          </Button>
        </div>
      </div>
    </Modal>
  );
}
