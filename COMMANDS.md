# ClawMate Server 运维命令手册

## Docker Compose 基础命令

### 启动服务

```bash
docker compose up -d                    # 后台启动所有服务
docker compose up -d api                # 只启动 api（自动启动依赖的 postgres/redis）
docker compose up -d --build api        # 重新构建镜像后启动（修改 package.json 依赖后需要）
```

### 停止服务

```bash
docker compose down                     # 停止并删除所有容器
docker compose stop api                 # 只停止 api 容器
docker compose restart api              # 重启 api 容器
```

### 查看状态与日志

```bash
docker compose ps                       # 查看所有容器状态
docker compose logs api                 # 查看 api 日志
docker compose logs api -f              # 实时跟踪 api 日志
docker compose logs api --tail 100      # 查看最近 100 行日志
docker compose logs postgres            # 查看数据库日志
```

---

## 环境变量与配置

### 修改 .env 后生效

修改 `.env` 文件后，需要重建容器才能让新环境变量生效：

```bash
docker compose up -d api                # 检测到 .env 变化会自动重建容器
```

### 同步配置到数据库

修改 `.env` 中的 `LICENSE_PRICE`、`LICENSE_DISCOUNT_PRICE`、`DEFAULT_TRIAL_DAYS` 等后，需要跑 seed 同步到数据库：

```bash
docker compose up -d api                # 先让容器读到新 .env
docker compose exec api npx tsx prisma/seed.ts   # 再同步配置到数据库
```

---

## 数据库相关

### 数据库迁移

```bash
# 生成迁移文件（不执行，仅创建 SQL 文件）
npx prisma migrate dev --name <迁移名> --create-only

# 在 Docker 中执行迁移
docker compose exec api npx prisma migrate deploy
```

### 数据库初始化（Seed）

```bash
docker compose exec api npx tsx prisma/seed.ts
```

> seed 会同步 .env 中的配置到 app_config 表，并创建管理员账户（如果不存在）

### 手动执行 SQL

```bash
docker compose exec api npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
SELECT * FROM app_config;
SQL
```

```bash
# 更新配置项（value 是 jsonb 类型，需要 to_jsonb 转换）
docker compose exec api npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
UPDATE app_config SET value = to_jsonb(68) WHERE key = 'license_discount_price';
SQL
```

---

## Prisma 命令

```bash
# 生成 Prisma Client（修改 schema 后需要）
docker compose exec api npx prisma generate

# 查看 Prisma Studio（数据库可视化管理，浏览器打开）
docker compose exec api npx prisma studio
# 访问 http://localhost:5555

# 查看数据库状态
docker compose exec api npx prisma db push --help
```

---

## 密钥生成

### 生成 Ed25519 签名密钥对

```bash
node -e "const nacl=require('tweetnacl'); const k=nacl.sign.keyPair(); console.log('PRIVATE_KEY:', Buffer.from(k.secretKey).toString('base64')); console.log('PUBLIC_KEY:', Buffer.from(k.publicKey).toString('base64'))"
```

> 生成后填入 `.env` 的 `ED25519_PRIVATE_KEY` 和 `ED25519_PUBLIC_KEY`，客户端需硬编码公钥

---

## 开发模式

### 本地开发（不用 Docker）

```bash
npm install                             # 安装依赖
npx prisma generate                     # 生成 Prisma Client
npx prisma migrate dev                  # 执行迁移（需要本地 PostgreSQL）
npm run dev                             # 启动开发服务器（tsx watch 热更新）
```

### Docker 开发模式

当前 `docker-compose.yml` 已配置：
- 整个项目目录挂载到容器（`.:/app`）
- 使用 `tsx watch` 启动，修改 `.ts` 文件自动重启

所以日常改代码**不需要重建容器**，保存即生效。

**需要重建容器的场景**：
- 修改了 `package.json` 中的依赖（增删 npm 包）
- 修改了 `.env` 中的环境变量

```bash
docker compose up -d --build api        # 重建镜像 + 重启
```

---

## 常用运维操作

### 创建管理员

确保 `.env` 中设置了 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD`，然后：

```bash
docker compose up -d api
docker compose exec api npx tsx prisma/seed.ts
```

> 已存在的管理员不会被覆盖

### 修改许可证价格

1. 修改 `.env` 中的 `LICENSE_PRICE` 和 `LICENSE_DISCOUNT_PRICE`
2. 重建容器 + 同步数据库：

```bash
docker compose up -d api
docker compose exec api npx tsx prisma/seed.ts
```

### 修改试用期天数

同上，修改 `.env` 中的 `DEFAULT_TRIAL_DAYS`，然后重建 + seed。

---

## API 接口速查

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
| GET | `/api/v1/admin/orders` | JWT | 订单列表 |
| POST | `/api/v1/admin/extend-trial` | JWT | 延长试用期 |
| POST | `/api/v1/admin/revoke-license` | JWT | 吊销许可证 |
| POST | `/api/v1/admin/update-trial-config` | JWT | 修改全局试用天数 |
| GET | `/api/v1/admin/stats` | JWT | 统计数据 |
| GET | `/health` | 无 | 健康检查 |

### 快速测试 API

```bash
# 健康检查
curl http://localhost:3000/health

# 获取试用配置
curl http://localhost:3000/api/v1/license/trial-config

# 获取价格（无优惠）
curl http://localhost:3000/api/v1/license/price

# 获取价格（带优惠判断）
curl "http://localhost:3000/api/v1/license/price?machineCode=YOUR_MACHINE_CODE"

# 注册机器码
curl -X POST http://localhost:3000/api/v1/license/register \
  -H "Content-Type: application/json" \
  -d '{"machineCode":"test123"}'

# 验证 license
curl -X POST http://localhost:3000/api/v1/license/validate \
  -H "Content-Type: application/json" \
  -d '{"machineCode":"test123"}'

# 管理员登录
curl -X POST http://localhost:3000/api/v1/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

---

## 故障排查

### 容器启动失败

```bash
docker compose logs api                 # 查看错误日志
docker compose up -d --build api        # 尝试重建
```

### 数据库连接失败

```bash
docker compose ps                       # 检查 postgres 是否运行
docker compose logs postgres            # 查看数据库日志
docker compose exec api npx prisma db execute --schema prisma/schema.prisma --stdin <<'SQL'
SELECT 1;
SQL
```

### 端口冲突

```bash
lsof -i :3000                          # 检查 3000 端口占用
lsof -i :5432                          # 检查 5432 端口占用
```

### 清理并重新开始

```bash
docker compose down -v                  # 停止容器 + 删除数据卷
docker compose up -d --build            # 重新构建并启动
docker compose exec api npx prisma migrate deploy
docker compose exec api npx tsx prisma/seed.ts
```
