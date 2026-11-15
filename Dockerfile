# Multi-stage production Dockerfile for INSA Racing Achats (SolidStart v2 + Nitro)
FROM node:24-alpine AS base
WORKDIR /app

# 1. Install all dependencies and build the SolidStart/Nitro bundle
FROM base AS builder
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# 2. Install production-only dependencies (guarantees external packages like
# exceljs, pdfkit/*.afm font data, archiver, nodemailer, and postgres are complete)
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# 3. Minimal non-root runtime image
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads

# Copy Nitro build output and complete production node_modules
# Remove Nitro's partial .output/server/node_modules so Node always resolves complete CJS/ESM packages from /app/node_modules
COPY --chown=node:node --from=builder /app/.output ./.output
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json

# Prepare persistent upload volume directory and switch to non-root user
RUN rm -rf /app/.output/server/node_modules \
    && mkdir -p /data/uploads \
    && chown node:node /app /data/uploads

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", ".output/server/index.mjs"]
