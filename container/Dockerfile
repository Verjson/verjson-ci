FROM node:24.19.0-alpine
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /opt/verjson-ci
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY verjson-ci.schema.json ./
COPY LICENSE LICENSING.md ./
COPY release/artifact-licenses.json ./release/artifact-licenses.json
COPY tools/release/artifact-licenses.mjs ./tools/release/artifact-licenses.mjs
RUN node tools/release/artifact-licenses.mjs oci
RUN corepack enable && pnpm install --frozen-lockfile --prod
RUN chmod 755 /opt/verjson-ci/packages/cli/bin/verjson-ci.mjs \
    && ln -s /opt/verjson-ci/packages/cli/bin/verjson-ci.mjs /usr/local/bin/verjson-ci

ENTRYPOINT ["node", "/opt/verjson-ci/packages/cli/bin/verjson-ci.mjs"]
