import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

// Validate the production files Vercel will serve, without a live API.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const html = readFileSync(path.join(output, 'index.html'), 'utf8');
const resources = new Set();

function localResource(reference, owner) {
  if (/^(?:https?:|data:|blob:|javascript:|mailto:|tel:|#|\/\/)/i.test(reference)) return;
  assert(!reference.startsWith('/'), `Use a relative deployment asset URL: ${reference}`);
  const clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  if (!clean) return;
  const resolved = path.resolve(path.dirname(owner), clean);
  assert(resolved.startsWith(output + path.sep), `Asset escapes dist: ${reference}`);
  assert(statSync(resolved, { throwIfNoEntry: false })?.isFile(), `Missing deployment asset: ${reference} (from ${path.relative(output, owner)})`);
  resources.add(resolved);
}

assert(/<script\b[^>]*\btype="module"[^>]*\bsrc="\.\/assets\//.test(html), 'Missing compiled JavaScript entry.');
assert(!/(?:src|href)="[^"\n]*\bsrc\//.test(html), 'Development source files must not appear in the deployed page.');
for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  localResource(match[1], path.join(output, 'index.html'));
}
assert([...resources].some(resource => resource.endsWith('.css')), 'Missing deployed stylesheets.');

// CSS paths are relative to the stylesheet, including the local icon fonts.
for (const resource of resources) {
  if (!resource.endsWith('.css')) continue;
  const css = readFileSync(resource, 'utf8');
  for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
    localResource(match[1], resource);
  }
}
const apiBase = (loadEnv('production', root, 'VITE_').VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const apiUrl = new URL(apiBase);
assert(apiUrl.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname), 'Production requires a hosted HTTPS API.');
assert(!apiUrl.username && !apiUrl.password && !apiUrl.search && !apiUrl.hash, 'The API address must not contain credentials, a query, or a fragment.');
const entryScript = [...resources].find(resource => /[/\\]assets[/\\]index-[^/\\]+\.js$/.test(resource));
assert(entryScript && readFileSync(entryScript, 'utf8').includes(apiBase), 'The compiled frontend must contain its configured API address.');

const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert(vercel.framework === 'vite' && vercel.outputDirectory === 'dist', 'Vercel must build Vite and serve dist.');
assert(vercel.buildCommand === 'npm run build', 'Vercel must run the production build checks.');
assert(vercel.headers.some(rule => rule.source === '/(.*)' && rule.headers.some(header => header.key === 'Cross-Origin-Opener-Policy' && header.value === 'same-origin-allow-popups')), 'Vercel must allow Google sign-in popups.');

console.log(`Verified ${resources.size} deployment assets, Vercel settings, and HTTPS API ${apiBase}.`);
