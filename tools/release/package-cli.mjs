#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const [version, destination = 'dist/release'] = process.argv.slice(2);
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version ?? '')) {
  throw new Error('usage: package-cli.mjs UNPREFIXED_SEMVER [DESTINATION]');
}
const output = resolve(destination);
await mkdir(output, { recursive: true });
await execFileAsync('pnpm', ['build'], { env: { ...process.env, VERJSON_CI_VERSION: version } });
const { stdout } = await execFileAsync('npm', ['pack', './dist/cli', '--pack-destination', output, '--json']);
const metadata = JSON.parse(stdout);
const packed = Array.isArray(metadata) ? metadata[0] : metadata['@verjson/ci'];
const path = resolve(output, packed.filename);
const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
process.stdout.write(`${JSON.stringify({ version, path, sha256, integrity: packed.integrity })}\n`);
