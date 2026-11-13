FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contratos/package.json packages/contratos/
RUN pnpm install --frozen-lockfile --filter api...
COPY . .
RUN pnpm --filter api build && pnpm --filter api deploy --prod /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
