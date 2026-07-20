# GitHub Pages + Supabase Deployment

This project publishes only static frontend files to GitHub Pages. Private notes and media stay in Supabase behind Auth, RLS, and a private Storage bucket.

## Cost Guardrails

- GitHub Pages on a public repository is free.
- Start with Supabase Free. The app treats 1GB as a hard media budget and rejects uploads expected to exceed it.
- A warning appears at 80% usage. The app never upgrades a plan or enables paid usage automatically.
- Each media file is limited to 100MB by the browser, database, and Storage bucket.

## 1. Create Supabase

1. Create a Supabase project and stay on the Free plan.
2. Open SQL Editor and run `supabase/schema.sql`.
3. In Authentication, create or invite your administrator email.
4. Run the final administrator `insert into public.invites...` statement shown at the bottom of `schema.sql` after replacing the email.
5. Disable public sign-ups. Visitors must be invited by the administrator.
6. Deploy `supabase/functions/invite-manager` and set its `SITE_URL` secret to the final GitHub Pages URL. Supabase automatically supplies its own URL and keys to deployed functions.

## 2. Create the GitHub Repository

1. Create a public repository. Do not upload `config.js`, `.dev.vars`, private notes, images, videos, PDFs, or any `service_role` key.
2. Push this project with `main` as the default branch.
3. In Repository Settings > Secrets and variables > Actions > Variables, add:
   - `SUPABASE_URL` = project URL
   - `SUPABASE_ANON_KEY` = public anon key
4. In Repository Settings > Pages, choose GitHub Actions as the source.
5. Run the `Deploy GitHub Pages` workflow. It produces `https://USERNAME.github.io/REPOSITORY/`.

The URL and anon key are designed to be public. RLS is the security boundary. Never add the service-role key to GitHub variables or source files.

## 3. Configure Auth Redirects

In Supabase Authentication URL Configuration:

- Site URL: exact GitHub Pages URL, including the repository path and trailing slash.
- Redirect URL: the same URL.
- Update the `SITE_URL` Edge Function secret to the same address, then redeploy the function.

## 4. First Use

1. Open the Pages URL and sign in as administrator.
2. Open Security Settings and invite viewer emails.
3. Run the local IndexedDB migration. Successful items are not duplicated on retry, and the local copy is retained.

## Security Boundaries

- GitHub source is public; private content is never committed.
- Supabase RLS enforces admin-write/viewer-read permissions even if someone bypasses the UI.
- Storage is private and media is shown through five-minute signed URLs.
- Revoked users lose database and Storage access after their existing short-lived URL expires.
- Screenshots, screen recording, and advanced extraction cannot be completely prevented in a browser.
