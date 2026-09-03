import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = fileURLToPath(new URL('../dist', import.meta.url));

await rm(dist, { force: true, recursive: true });
await mkdir(`${dist}/packages`, { recursive: true });
await cp(`${root}/packages`, `${dist}/packages`, { recursive: true });
await cp(`${root}/verjson-ci.schema.json`, `${dist}/verjson-ci.schema.json`);
await chmod(`${dist}/packages/cli/bin/verjson-ci.mjs`, 0o755);
