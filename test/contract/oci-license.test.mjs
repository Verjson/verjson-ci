import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('OCI build fails closed on license inventory and carries policy files', async () => {
  const dockerfile = await readFile('container/Dockerfile', 'utf8');

  assert.match(dockerfile, /LABEL org\.opencontainers\.image\.licenses="Apache-2\.0"/);
  assert.match(dockerfile, /COPY LICENSE LICENSING\.md \.\//);
  assert.match(dockerfile, /COPY release\/artifact-licenses\.json \.\/release\/artifact-licenses\.json/);
  assert.match(dockerfile, /RUN node tools\/release\/artifact-licenses\.mjs oci/);
});
