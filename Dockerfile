ARG REGISTRY=docker.io/library

FROM ${REGISTRY}/node:24-alpine AS builder

WORKDIR /app

# Prisma 引擎二进制改用国内镜像源下载，避免 binaries.prisma.sh 无法访问导致构建失败
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm install

COPY . .
RUN npx prisma generate
RUN npm run build

FROM ${REGISTRY}/node:24-alpine

WORKDIR /app

# 运行时 prisma migrate deploy 同样需要引擎二进制，使用国内镜像源
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm install --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist
COPY certs ./certs

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
