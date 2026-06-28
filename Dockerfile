# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

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

EXPOSE 3000
CMD ["node", "dist/main"]
