# The Fable site for the Forge cluster: the one published Service, `app`.
# Build:  docker build --platform linux/amd64 -t ghcr.io/<owner>/fable-access-web:<tag> .
#
# The browser calls /fable-api on this site, and the site forwards it to the
# API's internal Service. Both values below are fixed at build time because the
# browser bundle and the rewrite are built from them.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_FABLE_API_URL=/fable-api
ARG FABLE_INTERNAL_API_URL=http://api
ARG NEXT_PUBLIC_FORGE_BANK_LABEL="Xtradot Bank"
ENV NEXT_PUBLIC_FABLE_API_URL=$NEXT_PUBLIC_FABLE_API_URL \
    FABLE_INTERNAL_API_URL=$FABLE_INTERNAL_API_URL \
    NEXT_PUBLIC_FORGE_BANK_LABEL=$NEXT_PUBLIC_FORGE_BANK_LABEL \
    FABLE_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    FABLE_INTERNAL_API_URL=http://api
# Unprivileged, like the API image.
RUN groupadd --system --gid 10001 fable && useradd --system --uid 10001 --gid fable --no-create-home fable
COPY --from=build --chown=fable:fable /app/.next/standalone ./
COPY --from=build --chown=fable:fable /app/.next/static ./.next/static
COPY --from=build --chown=fable:fable /app/public ./public
USER fable
EXPOSE 8080
CMD ["node", "server.js"]
