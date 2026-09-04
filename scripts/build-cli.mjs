import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { verifyArtifactLicenses } from '../tools/release/artifact-licenses.mjs';

const version = process.env.VERJSON_CI_VERSION ?? '0.0.0-dev';
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  throw new Error('VERJSON_CI_VERSION must be unprefixed SemVer');
}
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = fileURLToPath(new URL('../dist/cli', import.meta.url));
await rm(dist, { force: true, recursive: true });
await mkdir(`${dist}/bin`, { recursive: true });
const buildResult = await build({
  entryPoints: [`${root}/packages/cli/bin/verjson-ci.mjs`],
  outfile: `${dist}/bin/verjson-ci.mjs`,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  define: { 'process.env.VERJSON_CI_VERSION': JSON.stringify(version) },
  metafile: true,
});
const sourcePackages = Object.keys(buildResult.metafile.inputs)
  .map((input) => path.relative(root, path.resolve(process.cwd(), input)).match(/^packages\/([^/]+)\//)?.[1])
  .filter(Boolean);
const licenseInventory = await verifyArtifactLicenses({ root, target: 'cli', sourcePackages });
const rootManifest = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
const externalPackages = [...new Set(Object.values(buildResult.metafile.outputs)
  .flatMap((output) => output.imports)
  .filter((dependency) => dependency.external && !dependency.path.startsWith('node:'))
  .map((dependency) => dependency.path.startsWith('@') ? dependency.path.split('/').slice(0, 2).join('/') : dependency.path.split('/')[0]))].sort();
const dependencies = Object.fromEntries(externalPackages.map((name) => {
  const dependencyVersion = rootManifest.dependencies?.[name];
  if (!dependencyVersion) throw new Error(`bundled CLI external dependency ${name} is not pinned in the root manifest`);
  return [name, dependencyVersion];
}));
await chmod(`${dist}/bin/verjson-ci.mjs`, 0o755);
await cp(`${root}/packages/compliance/packs`, `${dist}/packs`, { recursive: true });
await cp(`${root}/LICENSE`, `${dist}/LICENSE`);
await cp(`${root}/LICENSING.md`, `${dist}/LICENSING.md`);
await cp(`${root}/release/artifact-licenses.json`, `${dist}/artifact-licenses.json`);
await writeFile(`${dist}/package.json`, `${JSON.stringify({
  name: '@verjson/ci',
  version,
  license: licenseInventory.distributionLicense,
  type: 'module',
  bin: { 'verjson-ci': 'bin/verjson-ci.mjs' },
  engines: { node: '>=24' },
  dependencies,
  files: ['bin', 'packs', 'LICENSE', 'LICENSING.md', 'artifact-licenses.json'],
  verjsonLicenseInventory: 'artifact-licenses.json',
}, null, 2)}\n`);
