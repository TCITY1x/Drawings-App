# SitePax

Find it on the drawings. Mark it up. Sign it off.

SitePax turns a project's drawing set into a searchable register, puts QA/QC
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

With no environment variables SitePax runs in **local mode**: everything is
saved in the browser. Copy `.env.example` to `.env.local` to connect Supabase
and email.

## Accounts (cloud mode)

With Supabase configured, SitePax asks people to sign in with an emailed
link or code — no passwords. Someone who isn't in a company yet starts one (a
14-day trial, 5 seats) and becomes its owner. Admins invite people by email on
the Team page; an invited person joins as soon as they sign in with that
address. Owners, admins and members are enforced by the database's row-level
security, not just the screens.

## Setting up the cloud

1. Create a Supabase project (Sydney, `ap-southeast-2`) in the SitePax
   organisation, and apply every file in `supabase/migrations`, in order.
2. **Authentication → URL configuration**: set the Site URL to where SitePax
   is served, and add `<site>/auth/callback` (and
   `http://localhost:3000/auth/callback` for development) to the redirect URLs.
3. **Authentication → Email templates**: add the code to the *Magic link* and
   *Confirm signup* templates, e.g. `Or enter this code: {{ .Token }}`, so people
   whose link opens in another browser (common on tablets) can still sign in.
4. **Authentication → SMTP**: Supabase's built-in email is limited to a few
   messages an hour — fine for testing, not for customers. Point it at Resend
   (`smtp.resend.com`, port 465, user `resend`, password = API key) before launch.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the
   publishable key) wherever SitePax is deployed.
6. For sending markups: `RESEND_API_KEY` and `SITEPAX_FROM_EMAIL`, from a
   verified sending domain.

## Setting up billing

SitePax is one subscription per company, priced per user (seat) per month.
The owner subscribes on the Team page, choosing at least as many seats as there
are members and invitations; Stripe Checkout takes the card, and the billing
portal handles seat changes, card updates, invoices and cancelling. A webhook
keeps `organisations.plan`, `plan_status` and `seats` in step — the database
lets only the service role change them.

1. **Stripe → Product catalogue**: add a product "SitePax" with a recurring
   price per unit, monthly, in your currency (e.g. AUD, tax-inclusive or
   exclusive as you decide). Copy the price's id (`price_…`).
2. **Stripe → Settings → Billing → Customer portal**: turn on updating
   quantities for that product, payment methods, invoice history and
   cancellation (at the period's end).
3. **Stripe → Developers → Webhooks**: add an endpoint at
   `<site>/api/stripe/webhook` for `checkout.session.completed` and
   `customer.subscription.created`, `.updated`, `.deleted`, `.paused` and
   `.resumed`. Copy its signing secret (`whsec_…`).
4. Set, wherever SitePax is deployed: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
   `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project
   settings → API keys, the secret key — server-only, never `NEXT_PUBLIC_`),
   and optionally `SITEPAX_SITE_URL` and `NEXT_PUBLIC_SITEPAX_PRICE_LABEL`
   (e.g. `A$25 per user per month`).
5. Test with Stripe's test keys and card `4242 4242 4242 4242` first; for local
   development, `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   prints a webhook secret to use.

Still to build: enforcing the trial's end (and a cancelled plan), and moving a
local-mode workspace into an account.

## Licences

PDF reading uses [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) and
PDF writing [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT); both allow
commercial use. `public/pdfjs/pdf.worker.min.mjs` is pdf.js's own worker, copied
from `pdfjs-dist` at the version pinned in `package.json` — update both together.
