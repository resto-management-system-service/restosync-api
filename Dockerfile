# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
# build the app, then compile the demo seed to dist/prisma/seed.js so it can
# be run in the runtime image (which has no ts-node): `npm run seed:prod`
RUN npx prisma generate && npm run build && npm run build:seed

# --- Runtime stage ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist
RUN test -f dist/main.js || (echo "dist/main.js missing — nest build produced no output" && exit 1)
RUN test -f dist/prisma/seed.js || (echo "dist/prisma/seed.js missing — build:seed produced no output" && exit 1)

EXPOSE 3000
CMD ["node", "dist/main"]
