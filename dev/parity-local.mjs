import { spawnSync } from 'node:child_process';

const prerequisites = [
  { name: 'docker', command: 'docker', required: true },
  { name: 'act', command: 'act', required: false },
  { name: 'gitlab-runner', command: 'gitlab-runner', required: false },
];
const status = prerequisites.map((prerequisite) => ({
  ...prerequisite,
  available: spawnSync(prerequisite.command, ['--version'], { stdio: 'ignore' }).status === 0,
}));

if (!status.find(({ name }) => name === 'docker').available) {
  process.stderr.write('local parity unavailable: Docker is required\n');
  process.exitCode = 2;
} else {
  const unavailable = status.filter(({ available }) => !available).map(({ name }) => name);
  if (unavailable.length > 0) {
    process.stderr.write(`local parity prerequisites unavailable: ${unavailable.join(', ')}\n`);
    process.stderr.write('install them before using the full local adapter harness\n');
    process.exitCode = 2;
  } else {
    process.stdout.write('local parity prerequisites are available\n');
  }
}
