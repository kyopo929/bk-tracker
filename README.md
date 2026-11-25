# BK Tracker

Order tracking for the Burj Khalifa spares: quotes and POs, what's still owed, deliveries, delivery problems, invoices and document links. Replaces the SharePoint lists on the UAEWETCareOps site (moved 24 Nov 2026).

## How it's built
Same approach as Jino's Tally: plain HTML/CSS/JavaScript, no framework, no build tools beyond Python.
- `src/app.js` (the app), `src/app.css`, `src/shell.html`. `python3 build.py` combines them into `index.html`, the file that gets served. **Commit `index.html` after building.**
- Data lives in Supabase (Postgres). The app loads everything at start-up (a few thousand rows) and works everything out in the browser, which is why screens switch instantly. Every edit is saved straight away.
- Hosting: Netlify, from this repo's `main` branch. Every push redeploys.
- `vendor/supabase.js` is @supabase/supabase-js 2.118.0 (UMD build).

## The data model
- **parts** + **part_numbers**: one row per physical part; it can have any number of part numbers (old, new, client…). One is the *main* number. Search, orders and deliveries accept any of them, and totals combine them.
- **orders** (one per quote/PO, with shipping's WET SO number) → **order_lines** (part, qty, *ordered as*, urgent, expected date, unit price, cancelled, *shipped before tracking*).
- **deliveries** (delivery notes) → **delivery_lines** (good quantity received against an order line, *shipped as*).
- **issues**: short / wrong item / damaged, with status Open → Replacement requested → Resolved.
- **invoices**: linked to an order and a delivery note, checked against both (three-way match).
- **documents**: links to files that stay in SharePoint/OneDrive.
- **history**: every insert/edit/delete, written automatically by the database.

Worked out, never typed: shipped = shipped before tracking + delivered; outstanding = ordered − shipped (0 if the line is cancelled or the order closed); order status (Quote sent / PO received / Partially shipped / Fully shipped / Closed).

## Settings
The gear (sidebar bottom, or top right on a phone): the same 15 themes as Tally, light/dark/match Windows, which part number leads (WET or client), row density, which Outstanding view opens, a full JSON backup, sign out. Saved per browser.

## Fixes
`supabase/fixes/` holds one-off SQL changes, run in order in the SQL Editor. Each is safe to run twice.

## One-time setup
1. **Supabase → SQL Editor → New query**: paste `supabase/schema.sql`, put your sign-in email on the line marked `>>>`, **Run**.
2. New query: paste `supabase/seed.sql`, **Run** (loads the SharePoint data; refuses to run twice).
3. **Authentication → URL Configuration**: Site URL = the Netlify address; add redirect URL `<netlify address>/**`.
4. **Authentication → Sign In / Providers → Email**: you can turn off "Allow new users to sign up" after your first sign-in. Only emails in `allowed_emails` can see data either way.
5. **Netlify → Add new site → Import from GitHub → kyopo929/bk-tracker**. Leave build command empty, publish directory `.`. Deploy.

To allow another email later: SQL Editor → `insert into allowed_emails values ('name@company.com');`

## Keep-alive
Free Supabase projects pause after a quiet week. `.github/workflows/keepalive.yml` calls `keepalive()` (returns the time, reads nothing) every day at 08:23 Dubai. Run it by hand from the Actions tab to test.

## The move from SharePoint
`seed/source/*.tsv` are the exported lists; `seed/make_seed.py` turns them into `supabase/seed.sql`. Rules: old/new pairs and duplicates from the pairing sheet became one part (new number = main); where lists disagreed, Order Line Items won; shipments recorded in SharePoint became delivery lines and the rest of "Qty Shipped" became *shipped before tracking*; PO5002299 had a shipment but no line, so a line was created (noted on it). Problems written in delivery-note notes (SO32318, SO32320) became open problem records.

## Backups
Supabase free plan has no point-in-time restore. Every list has **Export to Excel (CSV)**; for a full copy, Supabase → Table Editor → each table → Export, or Database → Backups on a paid plan.
