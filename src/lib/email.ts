/**
 * Rules for an outgoing email, shared by the send dialog and the route that
 * sends it. Pure and free of relative imports so `node --test` can load it.
 */

export const MAX_RECIPIENTS = 20;
/** Resend's limit is 40 MB after base64 (which adds a third); stay under it. */
export const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024;

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** What stops this email going, in plain words; empty when it can go. */
export function sendProblems(input: { to: string[]; subject: string; attachmentBytes: number }): string[] {
  const problems: string[] = [];
  if (input.to.length === 0) problems.push("Pick or type at least one recipient.");
  if (input.to.length > MAX_RECIPIENTS) problems.push(`Send to ${MAX_RECIPIENTS} people or fewer at a time.`);
  const bad = input.to.filter((one) => !isEmail(one));
  if (bad.length > 0) problems.push(`Not an email address: ${bad.join(", ")}`);
  if (!input.subject.trim()) problems.push("Give it a subject.");
  if (input.attachmentBytes > MAX_ATTACHMENT_BYTES) {
    problems.push(`The attachments come to ${(input.attachmentBytes / 1048576).toFixed(1)} MB — the limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`);
  }
  return problems;
}

/** Addresses once each, case aside, in the order first given. */
export function uniqueAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of addresses) {
    const address = raw.trim();
    const key = address.toLowerCase();
    if (!address || seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}
