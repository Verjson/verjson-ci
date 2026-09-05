#!/usr/bin/env bash
set -euo pipefail
node tools/release/snapshot.mjs dispatch
corepack enable
pnpm install --frozen-lockfile
pnpm check
scripts/changelog-contract.test.sh
