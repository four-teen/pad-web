# PAD Web

Frontend for **PAD - Presidential Action Desk**, the **Electronic Document Routing, Tracking, and Executive Action System**.

Production uses two independent apps:

| App | Repository | Hosting |
| --- | --- | --- |
| PAD Web | [four-teen/pad-web](https://github.com/four-teen/pad-web) | Vercel builds and serves this Vite frontend. |
| PAD API | [four-teen/pad-api](https://github.com/four-teen/pad-api) | Apache/PHP and MySQL at https://padapi.sksu-orms.net. |

## Deploy through GitHub and Vercel

Connect the PAD Web GitHub repository to the existing Vercel project. Keep the project root at the repository root, select Vite, use `npm ci` to install, `npm run build` to build, and `dist` as the output directory. `vercel.json` provides these settings, the SPA fallback, and the Google popup header.

The committed `.env.production` contains only the public API address:

```dotenv
VITE_API_BASE_URL=https://padapi.sksu-orms.net
```

Vite loads this file for production builds, including builds on Vercel. An existing local `.env` does not replace that production value. If Vercel already has `VITE_API_BASE_URL` configured, set it to the same HTTPS address because Vercel's environment value takes precedence. Configure Preview deployments separately if they use a separate test API.

Commit source and configuration changes to GitHub; Vercel generates `dist` during deployment. `dist` and `node_modules` stay out of Git. Keep all database credentials, `APP_KEY`, and private API settings on the API host. The frontend reads the public Google client ID from the API.

Run `npm.cmd test` and `npm.cmd run build` locally before publishing. Confirm the API is deployed and ready before publishing a frontend that depends on it. The two apps retain the same API contracts, roles, document data, and private file storage.

See [Deployment steps](DEPLOYMENT.md) for the exact order, the settings to find in Vercel/cPanel, and final checks.

## Local development

Keep the local API on Apache at `http://localhost/pad-api/public`, with MySQL running. Copy `.env.example` to `.env` only if no local configuration exists. Then run:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:5174`. The dev server also proxies `/pad-api/public` to local Apache for an existing local `.env` that uses that relative path. Retain `http://localhost:5174` in the local API's allowed origins and Google's authorized origins.

The root and public `.htaccess` files support an optional local Apache preview; Vercel uses `vercel.json`. To build for that local preview, run `npx.cmd vite build --mode development` using your local `.env`, then open `http://localhost/pad-web/`. `npm run build` always prepares the hosted production API configuration and verifies its output.

## Google Cloud Console

Use the existing **Web application** OAuth client. In Vercel, open the PAD Web project and find its production address under **Settings > Domains**. Add that exact HTTPS origin to Google Cloud's **Authorized JavaScript origins** and the hosting API's `APP_ALLOWED_ORIGINS`. An origin includes the scheme and hostname, with no path or trailing slash. Add each custom frontend domain that users actually use.

Retain `http://localhost` and `http://localhost:5174` for local development if needed. Leave **Authorized redirect URIs** empty for PAD's popup and JavaScript callback flow. Store `GOOGLE_CLIENT_ID` only in the API's private `.env`; no frontend client secret is used. [Google setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

Vercel preview URLs do not automatically gain API or Google access. Use a stable preview domain and explicitly configure it when preview sign-in is required.

## Account roles

In **Administration → User accounts**, select any combination of **Administrator**, **OVP PAD**, **OVP Central Records**, and **SKSU Officials**. Each selected OVP role has its own searchable routing office selector; its saved office determines the workspace used at login. SKSU Officials has a separate searchable office selector from Office Officials records. The role chooser displays each role's exact office, including campus and office code. A single-role account opens its module directly. **Switch account role** retains the same Google login. Reloading keeps an authorized selected role, while signing out clears it.

The uniform office module lives in `src/doc_router` and opens at `#doc_router`. Office roles provide the dashboard, all seven queues, document operations, and timeline without administration navigation. API requests carry the selected role and use its saved office on the server. Run `php scripts/setup-account-roles.php` in `pad-api` to update an existing database; it preserves previous OVP office assignments. An administrator must edit the account to select a different OVP office.

## Office Document Routing

Administrator **Database management** opens from the Overview card or Administration sidebar at `#admin/database`. It lists table counts, explains blocked dependencies, and reviews all affected rows before clearing. A reason, exact typed confirmation, and acknowledgement are required. Each successful clear has a recovery backup and audit entry; restoration is a separate database operation. Login/access tables and document-number counters are protected. Run `php scripts/setup-database-maintenance.php` in `pad-api` on an existing installation. See [Database maintenance](../pad-api/docs/database-maintenance.md).

Open Overview (`#dashboard`) for the office dashboard. Use the sidebar for Incoming, Received, Outgoing, Returned, Acted, Delivered / completed, and All Timeline (`#routing/all`). Each queue shows real counts, search and status filters, pagination, and centered action button groups in the rightmost column. Open a document to see its current holder, pending receiving office, attachment, and full timeline.

Register document assigns the official number after a successful save. The form includes the document source, type, and Description / registration remarks; the description supplies the list heading when no subject is provided. Upload a signed file from the document view later, even after completion. Run `php scripts/setup-document-files.php` in `pad-api` for an existing database. Faculty / personnel involved uses a locally bundled Select2 search with multiple selection; Travel Order requires at least one traveler. Sending requires a destination; receiving explicitly confirms office receipt. Return, action taken, and delivery dialogs collect the required remarks. Ordinary accounts operate for their assigned office. Administrators and Records can choose a monitoring scope from Overview while actions remain tied to their own assigned office.

For an existing API database, run `php scripts/setup-office-routing.php` in `pad-api` before serving this build. Rebuild the frontend with `npm run build` after changing source files. `node tests/admin-preview-server.js` provides an isolated browser preview at `http://localhost:5184/#dashboard` using sample data held in memory.

Document source lists the office / agency names imported from `sam.pad.tbldivisions`. It uses one dropdown with search inside it and no separate search box or My office option. Select the document's originating office / agency; your assigned office remains responsible for registration and routing.

## Optional development and checks

`npm run dev` opens the Vite development server at `http://localhost:5174`. Use `npm run test:auth` for login, session restoration, role access, sign-out, and host/path regression checks. Use `npm run build` to verify the production files Vercel will serve. These automated checks do not sign in to a real Google account.
