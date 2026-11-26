# ARMAN GAANE — Full-stack starter (Stages 1–6)

## Project credits

- **Developed & Designed by:** Anshuman Jha
- **Domain Provided by:** MOMENT_GONE_EDITS

A responsive React/Vite web app, Express API, Supabase authentication/database integration, public music discovery search, authorized preview playback, and server-verified admin catalogue management.

## What is included

1. **Frontend:** responsive global music discovery UI, search, track cards, player, favorites-in-session, playlist creation-in-session, admin dashboard.
2. **Backend + database:** Express API, Supabase schema, RLS policies, audit log table, health endpoint.
3. **Authentication:** Supabase email/password signup/login/logout and server-verified session endpoint. Signup creates a normal user profile.
4. **Music catalogue search:** iTunes public search endpoint. Results include short preview URLs only when supplied by the provider.
5. **Playback:** HTML audio player plays only a provider-supplied preview URL. No full-song scraping or unauthorized streaming.
6. **Admin:** server verifies Supabase JWT and reads the role from database. Music/content managers and Super Admin can add tracks (pending rights review), approve rights and publish, or delete (Super Admin/Music Manager). Audit events are recorded.

## Important limitations — read before launch

This is a functional development starter, **not a hosted commercial music service**. The public catalogue is iTunes search and preview availability/territory/provider terms apply. Some tracks have no preview URL. This does not grant rights to upload or distribute full songs.

The favorites and playlist UI are currently session-only. Persistent account library, private audio upload/storage, MFA enforcement, user suspension/role management, site settings editor, analytics dashboard, password recovery UI, automated tests, and production deployment are not included in this version. Admin tabs that describe these workflows are explanatory, not falsely presented as completed features. A real production release needs a rights-cleared provider agreement, storage policies, security review, privacy/terms pages, backups, monitoring and testing.

## Requirements

- Node.js 20+
- Supabase project

## Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run the complete `supabase/schema.sql`.
3. In Supabase Authentication settings, enable email/password and email verification.
4. Copy `client/.env.example` to `client/.env` and fill in:
   - `VITE_API_URL=http://localhost:4000`
   - `VITE_SUPABASE_URL=...`
   - `VITE_SUPABASE_ANON_KEY=...`
5. Copy `server/.env.example` to `server/.env` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only; NEVER put this in client env or share it)
   - `CLIENT_ORIGIN=http://localhost:5173`
6. Install and run:
   ```bash
   npm install
   npm install --prefix client
   npm install --prefix server
   npm run dev
   ```
7. Open `http://localhost:5173`. API health is at `http://localhost:4000/api/health`.

## First Super Admin

1. Create your account through the app and verify the email.
2. In Supabase Authentication → Users, find the verified user's UUID.
3. In SQL Editor run, replacing the UUID:
   ```sql
   update public.profiles set role='super_admin' where id='YOUR-USER-UUID';
   ```
4. Sign out and sign in again. Admin access is determined by the server-side profile role.
5. Never make a public signup form accept an admin role.

## Deployment

### Netlify frontend

The repository includes `netlify.toml`. Connect the project repository to Netlify (do not use Netlify Drop to upload the ZIP as a static folder), and Netlify will build the `client` app using `npm run build` and publish `client/dist`. Set `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in Netlify environment variables. The Express API must be deployed separately and `VITE_API_URL` must point to that deployed API.

Deploy the Vite client and Express API separately or behind one domain. Set all environment variables in the hosting provider's secret manager, configure exact CORS origins, enforce HTTPS, enable MFA for privileged accounts, restrict service-role access, and test all RLS policies with separate normal/admin accounts. Do not deploy with sample credentials.

## Folder structure

- `client/` React application
- `server/` Express API and server-side Supabase integration
- `supabase/schema.sql` database schema, signup trigger, RLS policies
