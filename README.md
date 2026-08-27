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

Copy `.env.example` to `.env`, set the API URL, then run `npm install` and `npm run dev`.

## Google Cloud Console

Create a **Web application** OAuth client and add the PAD Web production URL (and eventual custom domain) under **Authorized JavaScript origins**. Put the resulting client ID only in `pad-api/.env` as `GOOGLE_CLIENT_ID`.
