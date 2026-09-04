import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dist = resolve('dist');
const client = resolve(dist, 'client');
const server = resolve(dist, 'server');
const excluded = new Set(['client', 'server', '.openai']);

await rm(client, { recursive: true, force: true });
await mkdir(client, { recursive: true });
for (const entry of await readdir(dist)) {
  if (!excluded.has(entry)) await cp(resolve(dist, entry), resolve(client, entry), { recursive: true });
}
await writeFile(resolve(client, '.assetsignore'), '.vite\nwrangler.json\n.dev.vars\n', 'utf8');
await mkdir(server, { recursive: true });
const workerSource = resolve('scripts', 'site-worker.mjs');
await cp(workerSource, resolve(server, 'index.js'));

// Cloudflare Pages direct uploads support an advanced-mode `_worker.js` at the
// root of the uploaded directory. Keep the same Worker beside the static
// assets so `/api/translate` also works when `dist/client` is uploaded
// directly, instead of only when the separate Workers config is used.
await cp(workerSource, resolve(client, '_worker.js'));

const translationCacheDirectory = resolve(client, 'translation-cache');
await mkdir(translationCacheDirectory, { recursive: true });
const translationCacheFiles = (await readdir(translationCacheDirectory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /\.csv$/i.test(entry.name))
  .map(entry => `/translation-cache/${encodeURIComponent(entry.name)}`)
  .sort((left, right) => left.localeCompare(right));
await writeFile(resolve(translationCacheDirectory, 'manifest.json'), JSON.stringify(translationCacheFiles), 'utf8');

await writeFile(resolve(server, 'wrangler.json'), JSON.stringify({ main: 'index.js', no_bundle: true, assets: { directory: '../client' } }, null, 2), 'utf8');
