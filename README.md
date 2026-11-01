# FieldMark

Find it on the drawings. Mark it up. Sign it off.

FieldMark turns a project's drawing set into a searchable register, puts QA/QC
issues and redlines on the sheet where they belong, and runs point-to-point
commissioning through to a signed handover pack.

## What's in it

- **Drawing register** — drop PDFs or a .zip; each sheet's number, revision and
  title block are read in the browser, and every word becomes searchable. A
  newer revision replaces the older one in the register.
- **Search** — find a tag, cable or terminal across the whole set and open the
  sheet at the highlighted match.
- **Markups** — pen, highlighter, line, arrow, box, revision cloud, text and
  callouts on the sheet. Issues go open → sent → fixed; redlines open → sent.
- **Commissioning (P2P)** — package a panel's drawings, trace conductors and box
  areas, mark each pass / fault / N/A, honour revision triangles, sign each sheet
  with a witness, and export one handover PDF.
- **Send** — marked-up copies, close-ups and packages emailed through Resend,
  with replies going to the sender. Without email configured the files can be
  downloaded and the send recorded by hand.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests
npm run build
```

With no environment variables FieldMark runs in **local mode**: everything is
saved in the browser. Copy `.env.example` to `.env.local` to connect Supabase
and email.

## Setting up the cloud (not done yet)

1. Create a Supabase project and apply `supabase/migrations` (tables, row-level
   security, and the private `drawings` storage bucket).
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Set `RESEND_API_KEY` and `FIELDMARK_FROM_EMAIL` (a verified sending domain).

Still to build: sign-in, organisations and invites, moving the workspace
(profile, team, projects) from localStorage to the database, and Stripe billing.

## Licences

PDF reading uses [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) and
PDF writing [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT); both allow
commercial use. `public/pdfjs/pdf.worker.min.mjs` is pdf.js's own worker, copied
from `pdfjs-dist` at the version pinned in `package.json` — update both together.
