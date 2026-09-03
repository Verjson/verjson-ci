FROM node:24.19.0-alpine

WORKDIR /opt/verjson-ci
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY verjson-ci.schema.json ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
RUN ln -s /opt/verjson-ci/packages/cli/bin/verjson-ci.mjs /usr/local/bin/verjson-ci

ENTRYPOINT ["node", "/opt/verjson-ci/packages/cli/bin/verjson-ci.mjs"]
