# ─────────────────────────────────────────────────────────────
# Corporate TLS trust, needed in BOTH stages.
#
# This network runs a TLS-intercepting proxy: outbound TLS to hosts like
# prod-litellm.nationalbank.kz (which carries LLM_API_KEY) arrives re-signed by
# "InfoWatch Transparent Proxy Root" instead of the real issuer. Trusting that
# one root is what makes verification succeed. The alternative that used to be
# here, ENV NODE_TLS_REJECT_UNAUTHORIZED=0, turned verification off for every
# outbound call — any MITM on the path could read the API key.
#
# The runtime stage needs this as much as the builder: the builder only talks to
# npm (which verifies unaided), while the *running service* is what calls
# LiteLLM. Dropping it from the runtime stage brings back
# UNABLE_TO_VERIFY_LEAF_SIGNATURE on every LLM call — the reason this block is
# duplicated rather than inherited.
#
# node:22-alpine ships ca-certificates-bundle (the store) but not
# update-ca-certificates (the tool), so the root is appended to the bundle
# directly. Node also carries its own CA list and ignores the system store,
# hence NODE_EXTRA_CA_CERTS as well — it is additive, so verification stays ON.
# ─────────────────────────────────────────────────────────────

# ─── Builder ─────────────────────────────────────────────────
FROM node:22-alpine AS builder

COPY certs/infowatch-proxy-root.crt /usr/local/share/ca-certificates/infowatch-proxy-root.crt
RUN cat /usr/local/share/ca-certificates/infowatch-proxy-root.crt >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/infowatch-proxy-root.crt

# Prisma's schema engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

# Full install here, dev dependencies included — tsc and the Prisma CLI live in
# this stage, not in the image that ships.
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Type-checks all of src/ tests included (tsconfig.json, no output), then
# compiles src/ without the tests and without declarations to dist/
# (tsconfig.build.json) and, separately, prisma/seed.ts to dist/seed.js — the
# seed has to be runnable in an image with no TypeScript.
RUN npm run build

# ─── Runtime ─────────────────────────────────────────────────
FROM node:22-alpine AS runtime

COPY certs/infowatch-proxy-root.crt /usr/local/share/ca-certificates/infowatch-proxy-root.crt
RUN cat /usr/local/share/ca-certificates/infowatch-proxy-root.crt >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/infowatch-proxy-root.crt

RUN apk add --no-cache openssl

ENV NODE_ENV=production

WORKDIR /app

# Production dependencies only. `prisma` is a runtime dependency rather than a
# dev one precisely because of this line: the entrypoint runs
# `prisma migrate deploy` at start, and --omit=dev would otherwise leave the CLI
# out of the image.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The client is generated against this schema, and `migrate deploy` reads the
# migrations directory from here at every start.
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./

# The upload directory is a mounted volume in compose, but it must exist and be
# writable even when the image runs without one — multer creates files here, and
# the process is no longer root.
RUN mkdir -p /app/uploads && chown -R node:node /app

# Dropping root is the point of this stage. Everything above runs as root
# because it installs packages; nothing below needs to.
USER node

EXPOSE 3001

ENTRYPOINT ["/bin/sh", "docker-entrypoint.sh"]
