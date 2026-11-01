import { createClient } from "@supabase/supabase-js";
import { MAX_ATTACHMENT_BYTES, sendProblems, uniqueAddresses, isEmail } from "@/lib/email";

/**
 * Send marked-up drawings or a package by email, through Resend.
 *
 * Only a signed-in FieldMark user may send — checked against Supabase with
 * the bearer token the dialog sends. Before accounts exist (local mode) the
 * route refuses unless FIELDMARK_ALLOW_UNAUTHENTICATED_SEND=1, which is for
 * a developer's own machine only: on a public deployment it would let anyone
 * send mail as you.
 */

function refuse(status: number, error: string, code?: string) {
  return Response.json({ error, code }, { status });
}

async function signedIn(request: Request): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return process.env.FIELDMARK_ALLOW_UNAUTHENTICATED_SEND === "1";
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data, error } = await createClient(url, key).auth.getUser(token);
  return !error && Boolean(data.user);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FIELDMARK_FROM_EMAIL;
  if (!apiKey || !from) return refuse(503, "Email isn't set up on this FieldMark yet.", "email-not-configured");
  if (!(await signedIn(request))) return refuse(401, "Sign in to send email from FieldMark.", "sign-in-required");

  const form = await request.formData().catch(() => null);
  if (!form) return refuse(400, "That wasn't a send request.");
  let to: string[] = [];
  try {
    const parsed = JSON.parse(String(form.get("to") ?? "[]"));
    to = uniqueAddresses(Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === "string") : []);
  } catch {
    return refuse(400, "The recipients couldn't be read.");
  }
  const subject = String(form.get("subject") ?? "").slice(0, 300);
  const note = String(form.get("note") ?? "").slice(0, 20000);
  const senderName = String(form.get("senderName") ?? "").replace(/[\r\n<>"]/g, "").slice(0, 100);
  const replyTo = String(form.get("replyTo") ?? "").trim();
  const files = form.getAll("files").filter((one): one is File => one instanceof File);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const problems = sendProblems({ to, subject, attachmentBytes: bytes });
  if (problems.length > 0) return refuse(400, problems.join(" "));
  if (bytes > MAX_ATTACHMENT_BYTES) return refuse(413, "The attachments are too big to email.");

  const attachments = await Promise.all(
    files.map(async (file) => ({ filename: file.name, content: Buffer.from(await file.arrayBuffer()).toString("base64") }))
  );
  // "Taylor via FieldMark <noreply@…>", so the inbox shows who it's from.
  const [, fromName = "FieldMark", fromAddress = from] = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from) ?? [];
  const display = fromName || "FieldMark";
  const fromHeader = `${senderName ? `${senderName} via ${display}` : display} <${fromAddress.trim()}>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromHeader,
      to,
      subject,
      text: note,
      html: `<div style="font-family:system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(note)}</div>`,
      ...(isEmail(replyTo) ? { reply_to: replyTo } : {}),
      attachments,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return refuse(502, `The email service refused it (${response.status}). ${detail.slice(0, 200)}`.trim());
  }
  return Response.json({ ok: true, to });
}
