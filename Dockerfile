# Server image (indexer + API). Built from the repo root so the sdk workspace is available.
FROM node:22-bookworm
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY sdk/package.json sdk/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --filter @peoplepad/server... --frozen-lockfile=false
COPY sdk sdk
COPY server server
ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@peoplepad/server", "start"]
