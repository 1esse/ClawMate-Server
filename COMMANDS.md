# ClawMate Server 运维命令手册

---

# 🖥️ 生产环境（服务器）

## 项目结构

| 项目 | 目录 | 配置文件 | 启动命令 |
|------|------|---------|---------|
| ClawMate API | `/opt/ClawMate-Server` | `docker-compose.prod.yml` | `docker compose -f docker-compose.prod.yml up -d` |
| Nginx 反向代理 | `/opt/nginx-proxy` | `docker-compose.yml` | `docker compose up -d` |

> ⚠️ 服务器上必须加 `-f docker-compose.prod.yml`，直接 `docker compose up -d` 读的是开发环境配置

## 域名分工

| 域名 | 用途 | 指向 |
|------|------|------|
| `api.clawmate.site` | API 服务端 | clawmate-api-1:3000 |
| `clawmate.site` | 官网 | /opt/nginx-proxy/site/ |
| `admin.clawmate.site` | 管理后台 | /opt/nginx-proxy/admin/ |
| `www.clawmate.site` | → 301 跳转到 clawmate.site | |
| `yiqiyue98.online` | yue98 项目 | yue98-app-prod-1:3000 |

## ClawMate API

以下命令在 `/opt/ClawMate-Server` 目录下执行。

### 启动/更新服务

```bash
docker compose -f docker-compose.prod.yml up -d --build api    # 更新代码后重建并启动
docker compose -f docker-compose.prod.yml up -d api             # 修改 .env 后重建容器
docker compose -f docker-compose.prod.yml restart api            # 只重启，不重建
```

### 停止服务

```bash
docker compose -f docker-compose.prod.yml down                  # 停止并删除所有容器（保留数据卷）
docker compose -f docker-compose.prod.yml down -v               # 停止并删除所有容器和数据卷
docker compose -f docker-compose.prod.yml stop api              # 只停止 api 容器
```

### 查看状态与日志

```bash
docker compose -f docker-compose.prod.yml ps                    # 查看所有容器状态
docker compose -f docker-compose.prod.yml logs api              # 查看 api 日志
docker compose -f docker-compose.prod.yml logs api -f           # 实时跟踪 api 日志
docker compose -f docker-compose.prod.yml logs api --tail 100   # 查看最近 100 行日志
```

### 修改 .env 后生效

```bash
docker compose -f docker-compose.prod.yml up -d api
```

### 同步配置到数据库

修改 `.env` 中的 `LICENSE_PRICE`、`LICENSE_DISCOUNT_PRICE`、`DEFAULT_TRIAL_DAYS` 等后：

```bash
docker compose -f docker-compose.prod.yml up -d api
docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed.ts
```

### 数据库迁移

```bash
docker compose -f docker-compose.prod.yml exec api npx prisma migrate deploy
```

### 数据库初始化（Seed）

```bash
docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed.ts
```

### 可视化数据库管理（Prisma Studio）

Prisma 自带 Web 端数据库管理工具，支持所有表的查看、筛选、编辑、删除。

**第一步**：在 `docker-compose.prod.yml` 给 api 服务加端口映射（只绑定本地，避免公网访问）：

```yaml
api:
  ports:
    - "3002:3000"
    - "127.0.0.1:5555:5555"  # 新增：Prisma Studio
```

重建容器：

```bash
docker compose -f docker-compose.prod.yml up -d api
```

**第二步**：服务器上启动 Prisma Studio（`--hostname 0.0.0.0` 让容器外也能访问）：

```bash
docker compose -f docker-compose.prod.yml exec api npx prisma studio --port 5555 --hostname 0.0.0.0
```

**第三步**：本地建 SSH 隧道（把服务器的 5555 端口转回本地）：

```bash
ssh -L 5555:127.0.0.1:5555 root@120.27.19.183
```

**第四步**：本地浏览器打开 `http://localhost:5555` 即可看到所有表。

> ⚠️ 用完记得关闭 Prisma Studio 进程（`Ctrl+C`），避免数据库一直暴露

### 手动执行 SQL

```bash
docker compose -f docker-compose.prod.yml exec api npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
SELECT * FROM app_config;
SQL
```

## Nginx 反向代理

以下命令在 `/opt/nginx-proxy` 目录下执行。

### 修改了 nginx 配置文件（clawmate.conf / yue98.conf）

```bash
# 只重载配置，不重启容器
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
```

### 修改了 docker-compose.yml（增删 volume 挂载等）

```bash
# 必须重建容器，reload 不会让新挂载生效
docker compose down && docker compose up -d
```

### 更新静态文件（官网/管理后台）

```bash
# 直接上传文件到对应目录即可，无需任何操作
# 官网：/opt/nginx-proxy/site/
# 管理后台：/opt/nginx-proxy/admin/
```

## 证书管理

### 自动续期

已配置 crontab，每天凌晨 3 点自动续期所有 Let's Encrypt 证书：

```bash
crontab -l                              # 查看当前定时任务
```

### 手动续期

```bash
/usr/local/bin/certbot renew --quiet
docker exec nginx-proxy-nginx-1 nginx -s reload
```

## 故障排查

### 容器启动失败

```bash
cd /opt/ClawMate-Server
docker compose -f docker-compose.prod.yml logs api
docker compose -f docker-compose.prod.yml up -d --build api
```

### 数据库连接失败

```bash
cd /opt/ClawMate-Server
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs postgres
```

### Nginx 配置错误

```bash
cd /opt/nginx-proxy
docker compose exec nginx nginx -t
docker compose logs nginx
```

### 完全回滚（卸载 ClawMate + 恢复 yue98 原始 Nginx）

```bash
cd /opt/ClawMate-Server
docker compose -f docker-compose.prod.yml down -v
cd /opt/nginx-proxy && docker compose down
docker start yue98-nginx-1
```

---

# 💻 开发环境（本地）

## 本地开发（不用 Docker）

```bash
npm install                             # 安装依赖
npx prisma generate                     # 生成 Prisma Client
npx prisma migrate dev                  # 执行迁移（需要本地 PostgreSQL）
npm run dev                             # 启动开发服务器（tsx watch 热更新）
```

## Docker 开发模式

当前 `docker-compose.yml` 已配置：
- 整个项目目录挂载到容器（`.:/app`）
- 使用 `tsx watch` 启动，修改 `.ts` 文件自动重启

日常改代码**不需要重建容器**，保存即生效。

**需要重建容器的场景**：
- 修改了 `package.json` 中的依赖（增删 npm 包）
- 修改了 `.env` 中的环境变量

```bash
docker compose up -d --build api        # 重建镜像 + 重启
docker compose up -d api                # 修改 .env 后重建容器
docker compose down                     # 停止并删除所有容器
docker compose ps                       # 查看所有容器状态
docker compose logs api -f              # 实时跟踪 api 日志
```

## 密钥生成

### 生成 Ed25519 签名密钥对

```bash
node -e "const nacl=require('tweetnacl'); const k=nacl.sign.keyPair(); console.log('PRIVATE_KEY:', Buffer.from(k.secretKey).toString('base64')); console.log('PUBLIC_KEY:', Buffer.from(k.publicKey).toString('base64'))"
```

> 生成后填入 `.env` 的 `ED25519_PRIVATE_KEY` 和 `ED25519_PUBLIC_KEY`，客户端需硬编码公钥

### 生成 JWT_SECRET

```bash
openssl rand -hex 32
```

---

# 📡 API 接口速查

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/v1/license/trial-config` | 无 | 获取试用期天数 |
| POST | `/api/v1/license/register` | 无 | 注册机器码 |
| GET | `/api/v1/license/price` | 无 | 获取许可证价格（支持 ?machineCode= 优惠价） |
| POST | `/api/v1/license/validate` | 无 | 验证 license |
| POST | `/api/v1/license/create-order` | 无 | 创建订单 |
| GET | `/api/v1/license/check-order` | 无 | 查询订单状态（支持 ?machineCode= 校验） |
| POST | `/api/v1/license/activate` | 无 | 激活码激活（管理后台用） |
| POST | `/api/v1/payment/alipay-callback` | 无 | 支付宝回调 |
| POST | `/api/v1/payment/wechat-callback` | 无 | 微信回调 |
| POST | `/api/v1/admin/login` | 无 | 管理员登录 |
| GET | `/api/v1/admin/licenses` | JWT | 许可证列表 |
| GET | `/api/v1/admin/orders` | JWT | 订单列表（支持 ?paymentStatus=&search=） |
| POST | `/api/v1/admin/extend-trial` | JWT | 延长试用期 |
| POST | `/api/v1/admin/revoke-license` | JWT | 吊销许可证 |
| POST | `/api/v1/admin/update-trial-config` | JWT | 修改全局试用天数 |
| GET | `/api/v1/admin/stats` | JWT | 统计数据 |
| GET | `/health` | 无 | 健康检查 |

### 快速测试 API

```bash
# 健康检查
curl https://api.clawmate.site/health

# 获取试用配置
curl https://api.clawmate.site/api/v1/license/trial-config

# 获取价格
curl https://api.clawmate.site/api/v1/license/price

# 注册机器码
curl -X POST https://api.clawmate.site/api/v1/license/register \
  -H "Content-Type: application/json" \
  -d '{"machineCode":"test123"}'

# 验证 license
curl -X POST https://api.clawmate.site/api/v1/license/validate \
  -H "Content-Type: application/json" \
  -d '{"machineCode":"test123"}'

# 管理员登录
curl -X POST https://api.clawmate.site/api/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```
