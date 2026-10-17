# PAD deployment: GitHub + Vercel frontend, hosted API

The production frontend is built from `four-teen/pad-web` on Vercel. The backend remains on your PHP/MySQL hosting at `https://padapi.sksu-orms.net`.

## 1. Find the two hosting settings

Open the existing PAD Web project in Vercel. Under **Settings → Domains**, copy the production domain assigned to this project. Add `https://` to obtain its origin. Do not assume the repository name is its domain: `pad-web.vercel.app` belongs to another website. Record the actual address and use it for the API CORS allow-list and Google sign-in.

In cPanel, open **Domains → Manage** for `padapi.sksu-orms.net` and find **Document Root**. This is the server folder served by that domain. The prepared API deployment folder is `/home/tnrmssks25/padapi.sksu-orms.net`; confirm it before using cPanel's Deploy action. Prefer its `public` subfolder as the document root. The API also supports a document root at the application folder, with private folders blocked by `.htaccess`.

## 2. Prepare the API hosting first

Follow [the API hosting guide](../pad-api/docs/hosting-deployment.md) in your sibling API checkout, or open that guide in the [API repository](https://github.com/four-teen/pad-api).

- Back up the existing hosting database and uploaded files before applying setup scripts.
- Deploy the API files; retain the host's private `.env`, documents, and recovery backups.
- Set `APP_ENV=production`, `APP_DEBUG=false`, and `APP_URL=https://padapi.sksu-orms.net`.
- Set `APP_ALLOWED_ORIGINS` to the actual frontend origin found in Vercel. Separate additional verified frontend origins with commas, without paths or trailing slashes.
- Supply the hosting database credentials, Google web-client ID, and application signing key on the API host.
- Run the API's production and HTTPS/CORS checks. Its `/api/health` must return HTTP 200 and JSON with `status: "ok"`.

## 3. Configure Google sign-in

In Google Cloud, open the existing Web application OAuth client. Add the actual frontend HTTPS origin to **Authorized JavaScript origins**. Keep the localhost origins used for local development. PAD uses a popup and JavaScript callback; no redirect URI or frontend client secret is required.

Use the same Google client ID in the hosting API's private `.env`. Vercel sends the popup header configured in `vercel.json`. [Google setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## 4. Prepare GitHub and Vercel

The existing GitHub main commit already has a successful Vercel deployment status. This alone does not establish the current project's production domain or its API settings.

Keep these Vercel project settings:

| Setting | Value |
| --- | --- |
| Git repository | `four-teen/pad-web` |
| Root directory | Repository root |
| Framework | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Production branch | `main`, unless you deliberately configure another branch |
| `VITE_API_BASE_URL` | `https://padapi.sksu-orms.net` |

The committed `.env.production` provides the public API address even when no Vercel environment override exists. Remove or correct any old override pointing to localhost, `/pad-api/public`, or the Isulan host. Redeploy after changing build-time environment values. Preview deployments need their own explicitly allowed origins if they require Google login. [Vite environment precedence](https://vite.dev/guide/env-and-mode), [Vercel Git deployments](https://vercel.com/docs/git).

Run locally before publishing:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
git diff --cached --stat
git status --short
```

Review the prepared application and hosting changes together. Include `vercel.json`, `.env.production`, the updated build checker, and all application source/modules. `dist`, dependencies, private environment files, test captures, and backups must stay out of Git. Publish the reviewed frontend to the production branch only after the API checks pass.

## 5. Verify the deployed application

Open the production frontend in a browser and sign in with an approved Google account. Confirm role selection, office queues, a document's timeline, an authorized file download, and an authorized upload using a suitable test record. In browser Network tools, API requests must go to `https://padapi.sksu-orms.net/api/...` and return JSON rather than the frontend HTML. Confirm users without the required role cannot open administration.

Changing the API token issuer requires a fresh sign-in. Preserve the existing database records, allow-list, and uploaded files when moving hosting.
