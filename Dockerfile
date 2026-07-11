FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS production-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runner

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

RUN addgroup --system --gid 1001 microlinear \
  && adduser --system --uid 1001 --ingroup microlinear microlinear \
  && mkdir -p /app/.data \
  && chown -R microlinear:microlinear /app \
  && chmod 700 /app/.data

COPY --from=production-dependencies --chown=microlinear:microlinear /app/node_modules ./node_modules
COPY --from=build --chown=microlinear:microlinear /app/.next ./.next
COPY --from=build --chown=microlinear:microlinear /app/public ./public
COPY --from=build --chown=microlinear:microlinear /app/scripts ./scripts
COPY --from=build --chown=microlinear:microlinear /app/src ./src
COPY --from=build --chown=microlinear:microlinear /app/package.json /app/package-lock.json ./
COPY --from=build --chown=microlinear:microlinear /app/next.config.ts ./next.config.ts
COPY --from=build --chown=microlinear:microlinear /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=microlinear:microlinear --chmod=755 /app/deploy/docker-entrypoint.sh ./deploy/docker-entrypoint.sh

USER microlinear
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/deploy/docker-entrypoint.sh"]
