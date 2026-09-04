import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTags, planSync, syncMirrors } from './sync.mjs';

test('discovers only unprefixed SemVer tags', () => {
  const accepted = ['0.0.0', '1.2.3', '1.2.3-0', '1.2.3-alpha.1', '1.2.3-0A', '1.2.3+build.01', '1.2.3-alpha+build'];
  const rejected = ['v1.2.3', '1.2', '01.2.3', '1.2.3-01', '1.2.3-alpha..1', '1.2.3-', '1.2.3+'];
  const lines = [...accepted, ...rejected].map((tag, index) => `${index}\trefs/tags/${tag}`);
  lines.push(`peeled\trefs/tags/${accepted[0]}^{}`);
  assert.deepEqual([...parseTags(`${lines.join('\n')}\n`).keys()], accepted);
});

test('refuses to rewrite an existing release tag', () => {
  assert.throws(() => planSync(new Map([['1.2.3', 'source']]), new Map([['1.2.3', 'destination']])), /immutable/);
});

test('fetches and pushes only missing immutable tags', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') {
      return args[3].includes('source') ? 'aaa\trefs/tags/1.2.3\nbbb\trefs/tags/2.0.0\nccc\trefs/tags/3.0.0\n' : 'aaa\trefs/tags/1.2.3\n';
    }
    if (args.includes('rev-parse')) return args.at(-1).endsWith('2.0.0') ? 'bbb\n' : 'ccc\n';
    return '';
  };
  const plan = await syncMirrors({ source: 'https://source.example/repo.git', destination: 'ssh://git@destination.example/group/repo.git' }, run);
  assert.deepEqual(plan, [{ tag: '2.0.0', oid: 'bbb' }, { tag: '3.0.0', oid: 'ccc' }]);
  const pushes = calls.filter((args) => args.includes('push'));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].includes('--atomic'), true);
  assert.equal(pushes[0].includes('refs/tags/2.0.0:refs/tags/2.0.0'), true);
  assert.equal(pushes[0].includes('refs/tags/3.0.0:refs/tags/3.0.0'), true);
  assert.equal(calls.some((args) => args.join(' ').includes('1.2.3:refs/tags/1.2.3')), false);
});

test('rejects hostile and credential-bearing remotes before invoking git', async () => {
  const hostileRemotes = [
    'ext::sh -c id',
    'file:///tmp/repo.git',
    '/tmp/repo.git',
    './repo.git',
    'git@example.test:group/repo.git',
    '--upload-pack=malicious',
    'https://token@example.test/repo.git',
    'https://token%40example.test@safe.example/repo.git',
    'https://example.test/repo.git\n--upload-pack=malicious',
    'https://example.test\\@attacker.test/repo.git',
    'https://example.test/repo.git\u00a0',
    'ssh://root@example.test/group/repo.git',
    'ssh://g%69t@example.test/group/repo.git',
  ];
  for (const remote of hostileRemotes) {
    let invoked = false;
    await assert.rejects(
      () => syncMirrors({ source: remote, destination: 'https://destination.example/repo.git' }, async () => {
        invoked = true;
        return '';
      }),
      /remote|credentials|protocol/,
      remote,
    );
    assert.equal(invoked, false, remote);
  }
});

test('refuses every push when a source tag moves after discovery', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return args[3].includes('source') ? 'planned\trefs/tags/2.0.0\n' : '';
    if (args.includes('rev-parse')) return 'changed\n';
    return '';
  };
  await assert.rejects(
    () => syncMirrors({ source: 'https://source.example/repo.git', destination: 'https://destination.example/repo.git' }, run),
    /changed during synchronization/,
  );
  assert.equal(calls.some((args) => args.includes('push')), false);
});
