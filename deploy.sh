#!/bin/bash

DEPLOY_DIR="/opt/clawmate-server"
PROXY_DIR="/opt/nginx-proxy"
YUE98_DIR="/opt/yue98/backend"
CERTBOT_DIR="/var/www/certbot"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo "=== ClawMate Server 部署脚本 ==="
echo ""

# ──────────────────────────────────────────────
# 前置检查
# ──────────────────────────────────────────────
info "前置检查..."

if ! docker network inspect yue98_app-network >/dev/null 2>&1; then
  error "yue98_app-network 网络不存在！请先启动 yue98 项目"
  exit 1
fi
info "yue98_app-network 网络已存在"

YUE98_APP=$(docker ps --filter "name=yue98-app" --filter "status=running" --format "{{.Names}}" | head -1)
if [ -z "$YUE98_APP" ]; then
  error "yue98 应用容器未运行！请先启动 yue98 项目"
  exit 1
fi
info "yue98 应用容器: $YUE98_APP"

YUE98_NGINX=$(docker ps --filter "name=yue98-nginx" --filter "status=running" --format "{{.Names}}" | head -1)
if [ -n "$YUE98_NGINX" ]; then
  warn "yue98 的 Nginx 容器仍在运行: $YUE98_NGINX"
  warn "部署时会停止它，由独立 Nginx 接管所有域名"
fi

# ──────────────────────────────────────────────
# [1] 克隆/更新项目
# ──────────────────────────────────────────────
info "[1/7] 克隆/更新项目..."
if [ ! -d "$DEPLOY_DIR" ]; then
  git clone git@github.com:1esse/ClawMate-Server.git "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
else
  cd "$DEPLOY_DIR"
  git pull origin main
fi

# ──────────────────────────────────────────────
# [2] 配置环境变量
# ──────────────────────────────────────────────
info "[2/7] 配置环境变量..."
if [ ! -f .env ]; then
  cp .env.production .env
  warn "请编辑 $DEPLOY_DIR/.env 配置以下必填项："
  echo "     - ADMIN_PASSWORD"
  echo "     - JWT_SECRET"
  echo "     - ED25519_PRIVATE_KEY / ED25519_PUBLIC_KEY"
  echo ""
  read -p "  按 Enter 编辑 .env 文件..." && vi .env
else
  info ".env 已存在，跳过"
fi

# ──────────────────────────────────────────────
# [3] 启动 ClawMate 服务
# ──────────────────────────────────────────────
info "[3/7] 启动 ClawMate 服务..."
docker compose -f docker-compose.prod.yml up -d --build api

info "等待数据库就绪..."
sleep 5

info "初始化数据库..."
docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed.ts

# ──────────────────────────────────────────────
# [4] 部署独立 Nginx 反向代理
# ──────────────────────────────────────────────
info "[4/7] 部署独立 Nginx 反向代理..."

mkdir -p "$PROXY_DIR/nginx" "$CERTBOT_DIR"

cp "$DEPLOY_DIR/nginx-proxy/docker-compose.yml" "$PROXY_DIR/docker-compose.yml"
cp "$DEPLOY_DIR/nginx-proxy/nginx/yue98.conf" "$PROXY_DIR/nginx/yue98.conf"

cat > "$PROXY_DIR/nginx/clawmate.conf" << 'CERTBOT_CONF'
server {
    listen 80;
    server_name clawmate.site api.clawmate.site admin.clawmate.site;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
CERTBOT_CONF

if [ -n "$YUE98_NGINX" ]; then
  info "停止 yue98 的 Nginx 容器（80/443 端口需要释放）..."
  docker stop "$YUE98_NGINX" || true
fi

info "启动独立 Nginx 反向代理..."
cd "$PROXY_DIR"
docker compose up -d

info "等待 Nginx 启动..."
sleep 2

info "验证 yue98 服务..."
if curl -sf -o /dev/null --max-time 5 https://yiqiyue98.online; then
  info "✅ yue98 服务正常"
else
  warn "yue98 HTTPS 不可达，尝试 HTTP..."
  if curl -sf -o /dev/null --max-time 5 http://yiqiyue98.online; then
    warn "yue98 HTTP 可达但 HTTPS 不可达，可能是 DNS 问题"
  else
    error "yue98 服务不可达！回滚..."
    cd "$PROXY_DIR" && docker compose down
    if [ -n "$YUE98_NGINX" ]; then
      docker start "$YUE98_NGINX"
      info "已恢复 yue98 原始 Nginx"
    fi
    error "请检查问题后重试"
    exit 1
  fi
fi

cd "$DEPLOY_DIR"

# ──────────────────────────────────────────────
# [5] 申请 SSL 证书
# ──────────────────────────────────────────────
info "[5/7] 申请 SSL 证书..."
if [ -d "/etc/letsencrypt/live/clawmate.site" ]; then
  info "SSL 证书已存在，跳过"
else
  if certbot certonly --webroot -w "$CERTBOT_DIR" -d clawmate.site -d api.clawmate.site -d admin.clawmate.site; then
    info "✅ SSL 证书申请成功"
  else
    error "SSL 证书申请失败！"
    warn "ClawMate 服务已启动，但 HTTPS 暂不可用"
    warn "请确认 DNS 已解析后重新运行脚本"
    exit 1
  fi
fi

# ──────────────────────────────────────────────
# [6] 启用 ClawMate HTTPS
# ──────────────────────────────────────────────
info "[6/7] 启用 ClawMate HTTPS..."

cp "$DEPLOY_DIR/nginx-proxy/nginx/clawmate.conf" "$PROXY_DIR/nginx/clawmate.conf"

cd "$PROXY_DIR"
if docker compose exec nginx nginx -t 2>/dev/null; then
  docker compose exec nginx nginx -s reload
  info "✅ ClawMate HTTPS 已启用"
else
  error "Nginx 配置验证失败！回滚 clawmate.conf..."
  rm -f "$PROXY_DIR/nginx/clawmate.conf"
  docker compose exec nginx nginx -s reload 2>/dev/null || true
  error "已移除 clawmate.conf，yue98 不受影响"
  exit 1
fi

cd "$DEPLOY_DIR"

# ──────────────────────────────────────────────
# [7] 配置证书自动续期
# ──────────────────────────────────────────────
info "[7/7] 配置证书自动续期..."

CRON_CMD="0 3 * * * certbot renew --quiet && docker exec nginx-proxy-nginx-1 nginx -s reload"
(crontab -l 2>/dev/null | grep -v "clawmate.site" | grep -v "nginx-proxy-nginx-1" || true) | { cat; echo "$CRON_CMD"; } | crontab -

info "✅ 证书自动续期已配置"

# ──────────────────────────────────────────────
# 完成
# ──────────────────────────────────────────────
echo ""
echo "========================================="
echo "  ✅ 部署完成！"
echo "========================================="
echo ""
echo "  yue98:         https://yiqiyue98.online"
echo "  ClawMate API:  https://clawmate.site"
echo "  健康检查:      https://clawmate.site/health"
echo ""
echo "⚠️  注意事项:"
echo "  1. yue98 的 docker-compose.yml 中仍有 nginx 服务定义"
echo "     如果执行 docker compose --profile production up -d 会尝试重启旧 nginx"
echo "     建议注释掉 yue98 的 nginx 服务（不影响运行）"
echo ""
echo "  2. Nginx 配置文件位置: $PROXY_DIR/nginx/"
echo "     修改后执行: cd $PROXY_DIR && docker compose exec nginx nginx -s reload"
echo ""
echo "=== 回滚方法 ==="
echo "  完全卸载 ClawMate + 恢复 yue98 原始 Nginx:"
echo "    cd $DEPLOY_DIR"
echo "    docker compose -f docker-compose.prod.yml down -v"
echo "    cd $PROXY_DIR && docker compose down"
echo "    docker start yue98-nginx-1"
