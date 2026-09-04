import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyArtifactLicenses } from './artifact-licenses.mjs';

const cliPackages = ['cli', 'compliance', 'engine', 'result-contract', 'schema', 'shadscan'];

test('CLI and OCI assemblies accept the reviewed Apache-2.0 inventory', async () => {
  assert.equal((await verifyArtifactLicenses({ target: 'cli', sourcePackages: cliPackages })).distributionLicense, 'Apache-2.0');
  assert.equal((await verifyArtifactLicenses({ target: 'oci' })).distributionLicense, 'Apache-2.0');
});

test('artifact assembly fails closed for a non-Apache workspace package', async () => {
  const root = await createFixture();
  try {
    const inventoryPath = path.join(root, 'release/artifact-licenses.json');
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
    inventory.packages.engine = 'LicenseRef-Verjson-Premium';
    await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
    await writeFile(path.join(root, 'packages/engine/package.json'), '{"license":"LicenseRef-Verjson-Premium"}\n');

    await assert.rejects(() => verifyArtifactLicenses({ root, target: 'oci' }), /unsupported package or license/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI assembly rejects workspace sources omitted from its license inventory', async () => {
  await assert.rejects(
    () => verifyArtifactLicenses({ target: 'cli', sourcePackages: [...cliPackages, 'coordinator'] }),
    /sources differ from artifact license inventory/,
  );
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'verjson-license-inventory-'));
  const license = await readFile('LICENSE');
  const inventory = JSON.parse(await readFile('release/artifact-licenses.json', 'utf8'));
  inventory.licenseSha256 = createHash('sha256').update(license).digest('hex');
  await mkdir(path.join(root, 'release'), { recursive: true });
  await writeFile(path.join(root, 'LICENSE'), license);
  await writeFile(path.join(root, 'release/artifact-licenses.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  for (const [packageName, packageLicense] of Object.entries(inventory.packages)) {
    const directory = path.join(root, 'packages', packageName);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({ license: packageLicense })}\n`);
  }
  return root;
}
