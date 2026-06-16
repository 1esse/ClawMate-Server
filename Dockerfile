ARG REGISTRY=docker.io/library

FROM ${REGISTRY}/node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

FROM ${REGISTRY}/node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm install --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist
COPY certs ./certs

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
