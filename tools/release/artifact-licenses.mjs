#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const INVENTORY_PATH = 'release/artifact-licenses.json';

const ALLOWED_DISTRIBUTION_LICENSES = new Set(['Apache-2.0']);
const TARGETS = new Set(['cli', 'oci']);

export async function loadLicenseInventory(root = '.') {
  const bytes = await readFile(path.join(root, INVENTORY_PATH));
  const inventory = JSON.parse(bytes);
  validateInventoryShape(inventory);
  return {
    inventory,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

export async function verifyArtifactLicenses({ root = '.', target, sourcePackages } = {}) {
  if (!TARGETS.has(target)) throw new Error(`unknown artifact license target: ${target}`);
  const { inventory, digest } = await loadLicenseInventory(root);
  const licenseBytes = await readFile(path.join(root, 'LICENSE'));
  const licenseDigest = createHash('sha256').update(licenseBytes).digest('hex');
  if (licenseDigest !== inventory.licenseSha256) throw new Error('root LICENSE digest differs from artifact license inventory');

  const workspacePackages = (await readdir(path.join(root, 'packages'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== 'compliance-packs')
    .map((entry) => entry.name)
    .sort();
  const inventoriedPackages = Object.keys(inventory.packages).sort();
  if (workspacePackages.join('\0') !== inventoriedPackages.join('\0')) {
    throw new Error('workspace packages differ from artifact license inventory');
  }

  for (const packageName of inventoriedPackages) {
    const manifest = JSON.parse(await readFile(path.join(root, 'packages', packageName, 'package.json'), 'utf8'));
    if (manifest.license !== inventory.packages[packageName]) {
      throw new Error(`${packageName} package license differs from artifact license inventory`);
    }
  }

  const expectedPackages = [...inventory.targets[target]].sort();
  if (target === 'oci' && expectedPackages.join('\0') !== workspacePackages.join('\0')) {
    throw new Error('OCI artifact must inventory every workspace package copied into the image');
  }
  if (sourcePackages) {
    const actualPackages = [...new Set(sourcePackages)].sort();
    if (actualPackages.join('\0') !== expectedPackages.join('\0')) {
      throw new Error(`${target} artifact sources differ from artifact license inventory: expected ${expectedPackages.join(',')}; received ${actualPackages.join(',')}`);
    }
  }
  for (const packageName of expectedPackages) {
    if (inventory.packages[packageName] !== inventory.distributionLicense) {
      throw new Error(`${target} artifact cannot include ${packageName} under ${inventory.distributionLicense}`);
    }
  }
  return { ...inventory, digest };
}

function validateInventoryShape(inventory) {
  if (!inventory || inventory.schemaVersion !== 1 || !ALLOWED_DISTRIBUTION_LICENSES.has(inventory.distributionLicense)) {
    throw new Error('unsupported artifact license inventory');
  }
  if (!/^[0-9a-f]{64}$/.test(inventory.licenseSha256)) throw new Error('invalid root LICENSE digest');
  if (!inventory.packages || Array.isArray(inventory.packages) || !inventory.targets || Array.isArray(inventory.targets)) {
    throw new Error('invalid artifact license inventory structure');
  }
  if (Object.keys(inventory.targets).sort().join('\0') !== [...TARGETS].sort().join('\0')) {
    throw new Error('artifact license inventory must declare exactly cli and oci targets');
  }
  for (const [packageName, license] of Object.entries(inventory.packages)) {
    if (!/^[a-z0-9-]+$/.test(packageName) || !ALLOWED_DISTRIBUTION_LICENSES.has(license)) {
      throw new Error('artifact license inventory contains an unsupported package or license');
    }
  }
  for (const packages of Object.values(inventory.targets)) {
    if (!Array.isArray(packages) || new Set(packages).size !== packages.length || packages.some((name) => !(name in inventory.packages))) {
      throw new Error('artifact license target contains invalid packages');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyArtifactLicenses({ target: process.argv[2] }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
