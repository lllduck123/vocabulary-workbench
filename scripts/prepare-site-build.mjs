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
await cp(resolve('scripts', 'site-worker.mjs'), resolve(server, 'index.js'));
await writeFile(resolve(server, 'wrangler.json'), JSON.stringify({ main: 'index.js', no_bundle: true, assets: { directory: '../client' } }, null, 2), 'utf8');
