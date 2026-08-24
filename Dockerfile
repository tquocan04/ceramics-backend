# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl


FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Install all dependencies (include devDependencies) to build
RUN npm ci

FROM deps AS build
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN rm -rf src/test-db.ts
RUN npx prisma generate && npx tsc --outDir dist --rootDir src

FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Install production dependencies only
RUN npm ci --omit=dev && npx prisma generate

FROM base AS runner
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=prod-deps /app/prisma ./prisma
COPY package.json ./

EXPOSE 5000
CMD ["node", "dist/server.js"]
