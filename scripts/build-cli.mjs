import { chmod, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const version = process.env.VERJSON_CI_VERSION ?? '0.0.0-dev';
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  throw new Error('VERJSON_CI_VERSION must be unprefixed SemVer');
}
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = fileURLToPath(new URL('../dist/cli', import.meta.url));
await rm(dist, { force: true, recursive: true });
await mkdir(`${dist}/bin`, { recursive: true });
await build({
  entryPoints: [`${root}/packages/cli/bin/verjson-ci.mjs`],
  outfile: `${dist}/bin/verjson-ci.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  define: { 'process.env.VERJSON_CI_VERSION': JSON.stringify(version) },
});
await chmod(`${dist}/bin/verjson-ci.mjs`, 0o755);
await cp(`${root}/packages/compliance/packs`, `${dist}/packs`, { recursive: true });
await writeFile(`${dist}/package.json`, `${JSON.stringify({
  name: '@verjson/ci',
  version,
  type: 'module',
  bin: { 'verjson-ci': 'bin/verjson-ci.mjs' },
  engines: { node: '>=24' },
}, null, 2)}\n`);
