FROM node:20-alpine

  WORKDIR /app

  # Install pnpm
  RUN corepack enable && corepack prepare pnpm@latest --activate

  # Copy workspace manifests first (layer caching)
  COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
  COPY tsconfig.base.json tsconfig.json ./
  COPY artifacts/api-server/package.json ./artifacts/api-server/

  # Install dependencies
  RUN pnpm install --frozen-lockfile --filter @workspace/api-server...

  # Copy source
  COPY artifacts/api-server/ ./artifacts/api-server/
  COPY knowledge.txt ./

  # Build
  WORKDIR /app/artifacts/api-server
  RUN pnpm run build

  # Runtime
  ENV NODE_ENV=production
  ENV PORT=5001
  EXPOSE 5001

  CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
  