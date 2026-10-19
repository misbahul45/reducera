# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS tools
WORKDIR /repo/apps/web

ENV COREPACK_HOME=/opt/corepack \
    CI=true

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate \
    && chmod -R a+rX /opt/corepack

RUN apk add --no-cache libc6-compat

RUN mkdir -p /repo/apps/web/node_modules /home/node/.local/share/pnpm \
    && chown -R node:node /repo /home/node/.local

USER node

CMD ["sh"]


FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    PORT=3000

RUN apk add --no-cache wget dumb-init \
 && addgroup -S reducera && adduser -S reducera -G reducera

COPY --chown=reducera:reducera .output ./.output
COPY --chown=reducera:reducera package.json ./package.json

USER reducera

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", ".output/server/index.mjs"]
