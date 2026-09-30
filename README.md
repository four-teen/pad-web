# PAD Web

Vercel-ready frontend for **PAD — Presidential Action Desk**, the **Electronic Document Routing, Tracking, and Executive Action System**.

## Configure Vercel

Set this environment variable in the Vercel project before deployment:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | The full HTTPS cPanel API subdomain, for example `https://pad-api.example.edu.ph` |

The Google client ID is supplied by the API's public configuration endpoint; Google client secrets are never stored in the browser or Vercel project.

Deploy this folder as its own GitHub repository connected to Vercel. The included `vercel.json` uses `npm run build` and serves the Vite `dist` output.

## Local development

Copy `.env.example` to `.env`, set `VITE_API_BASE_URL=http://localhost/pad-api/public`, then run `npm install` and `npm run dev`. Open `http://localhost:5174`. Development and preview use this fixed port so Google origins and API CORS settings stay consistent. On PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

## Google Cloud Console

Create a **Web application** OAuth client. Under **Authorized JavaScript origins**, add:

- `http://localhost`
- `http://localhost:5174`
- Your actual PAD Web production origin, such as `https://pad-web.vercel.app`, and any custom frontend domain you use.

Leave **Authorized redirect URIs** empty. PAD uses Google's popup with a JavaScript callback, which posts the credential to the API itself. Remove any empty redirect row in the Google form. Put the resulting client ID only in `pad-api/.env` as `GOOGLE_CLIENT_ID`; no client secret is needed. [Google setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

The API admits only verified Google emails present in `pad_db.tblaccount.acc_email`. Google account domains are not restricted in PAD. Existing PAD profiles must also remain active.

After login or session restoration, PAD opens `#admin` for the API-verified `admin` role and `#dashboard` for other roles. The existing Administration module manages PAD roles, office assignments, account status, and offices. Administrator API endpoints also enforce the role on the server.

## Checks

Run `npm run test:auth` for login, denied access, expired sessions, and sign-out regression checks. Run `npm run build` to verify the production bundle. These checks do not sign in to a real Google account.
