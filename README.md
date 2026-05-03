# AI Hot News

AI 热点信息聚合与监控平台 · [PRD V3](docs/PRD/AI%20Hot%20News%20%E7%83%AD%E7%82%B9%E4%BF%A1%E6%81%AF%E8%81%9A%E5%90%88%E7%BD%91%E7%AB%993%20PRD.md) · [Aurora 设计稿](docs/Design/AI%20Hot%20News%20Aurora.html) · [SP-0 设计](docs/superpowers/specs/2026-05-01-sp0-monorepo-infra-design.md)

## 技术栈

- **前端**：Next.js 15 (App Router) · React 19 · Tailwind 4
- **后端**：NestJS 11 · Prisma 6 · PostgreSQL 16 + pgvector · Redis 7 · BullMQ 5
- **基础设施**：pnpm 9 + Turborepo 2 · Docker Compose · Caddy 2 (auto HTTPS)
- **部署**：搬瓦工 VPS · GitHub Actions · GHCR

## 本地开发

### 前置依赖

- Node 22 (`nvm use` 或 `fnm use` 或装好后 `node --version` 显示 22.x)
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker Desktop / OrbStack / Colima（任一 docker engine）

### 一键启动

```bash
git clone <this-repo> ai-hot-news && cd ai-hot-news
cp .env.example .env

pnpm install                  # 安装所有 workspace 依赖
pnpm docker:dev               # 启动 postgres (含 pgvector) + redis 容器
pnpm db:migrate:deploy        # 应用 Prisma migration（fresh checkout 推荐）
pnpm dev                      # turbo 并行启动 web/api/worker
```

启动后：

- Web：<http://localhost:3000>（占位首页）
- API：<http://localhost:3001/health>（含 db/redis 状态检查）
- 数据库：localhost:5432（pgvector 已启用）
- Redis：localhost:6379
- Worker：无 HTTP 端口；通过 `/tmp/worker-alive` 心跳文件健康检查

### 常用命令

```bash
pnpm lint                     # 全仓库 lint（ESLint flat config）
pnpm typecheck                # 全仓库 TS 检查
pnpm build                    # 全仓库构建
pnpm test                     # 全仓库测试（Vitest）
pnpm db:studio                # 打开 Prisma Studio（数据库 GUI）
pnpm db:migrate:dev           # 创建新 migration（开发期）
pnpm db:generate              # 重生成 Prisma client（一般 build/migrate 会自动跑）
pnpm format                   # Prettier 格式化
pnpm docker:dev:down          # 关闭本地 pg + redis
```

## 项目结构

```
ai-hot-news/
├── apps/
│   ├── web/        # Next.js 15 (App Router) - 端口 3000
│   ├── api/        # NestJS REST API - 端口 3001
│   └── worker/     # NestJS standalone - 后台 BullMQ worker，无 HTTP
├── packages/
│   ├── db/         # Prisma schema + 共享 PrismaClient（CJS bundle via esbuild）
│   └── types/      # 共享 TypeScript enum / DTO（pure types-only）
├── docker/
│   ├── docker-compose.dev.yml    # 仅 pg+redis（本地开发）
│   ├── docker-compose.prod.yml   # 全部服务 + Caddy（生产）
│   └── Caddyfile                  # Caddy 反代 + 自动 HTTPS
├── .github/workflows/
│   ├── ci.yml      # lint / typecheck / build / test + 镜像推 GHCR
│   └── deploy.yml  # main 通过后 SSH 自动部署到 VPS
├── scripts/deploy.sh             # VPS 上执行的部署脚本
└── docs/                         # PRD / 设计稿 / spec / plan
```

## 部署到搬瓦工 VPS

### 首次配置（一次性）

详见 `docs/superpowers/plans/2026-05-01-sp0-monorepo-infra-plan.md` Task 15。要点：

1. **VPS 安装 Docker + Docker Compose**

   ```bash
   curl -fsSL https://get.docker.com | sh
   systemctl enable --now docker
   ```

2. **创建 `deploy` 用户**（避免用 root）：

   ```bash
   useradd -m -s /bin/bash deploy
   usermod -aG docker deploy
   mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
   touch /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
   chown -R deploy:deploy /home/deploy/.ssh
   ```

3. **生成专用部署 SSH 密钥**（在你的本地）：

   ```bash
   ssh-keygen -t ed25519 -C "github-deploy@ai-hot-news" -f ~/.ssh/ai-hot-news-deploy -N ""
   ssh-copy-id -i ~/.ssh/ai-hot-news-deploy.pub deploy@<vps-ip>
   ```

4. **VPS 上准备项目目录**（用 `deploy` 用户）：

   ```bash
   sudo mkdir -p /srv/ai-hot-news
   sudo chown deploy:deploy /srv/ai-hot-news
   cd /srv/ai-hot-news
   git clone https://github.com/<owner>/ai-hot-news.git .
   ```

5. **创建生产环境变量** `/srv/ai-hot-news/.env`：

   ```bash
   cat > /srv/ai-hot-news/.env <<'EOF'
   DOMAIN=hotnews.yourdomain.com
   POSTGRES_USER=ai_hot_news
   POSTGRES_PASSWORD=$(openssl rand -base64 32)
   POSTGRES_DB=ai_hot_news_prod
   DATABASE_URL=postgresql://ai_hot_news:<paste 上面密码>@postgres:5432/ai_hot_news_prod?schema=public
   REDIS_URL=redis://redis:6379
   CORS_ORIGIN=https://hotnews.yourdomain.com
   PUBLIC_API_URL=https://hotnews.yourdomain.com/api
   GHCR_REPO=ghcr.io/<owner>/ai-hot-news
   IMAGE_TAG=latest
   EOF
   chmod 600 /srv/ai-hot-news/.env
   ```

6. **配置 DNS**：把 `hotnews.yourdomain.com` 的 A 记录指向 VPS 公网 IP。验证：`dig +short hotnews.yourdomain.com`。

7. **GitHub 仓库 Secrets**（Settings → Secrets and variables → Actions）：

   | Secret | 值 |
   |---|---|
   | `VPS_HOST` | VPS 公网 IP |
   | `VPS_USER` | `deploy` |
   | `VPS_SSH_KEY` | 本地 `~/.ssh/ai-hot-news-deploy` 私钥内容（含 BEGIN/END 整段）|
   | `GHCR_PULL_TOKEN` | GitHub PAT（fine-grained，权限 `packages:read`）|
   | `DOMAIN` | `hotnews.yourdomain.com` |

### 自动部署流程

```text
git push origin main
   │
   ▼
GitHub Actions: ci.yml (lint / typecheck / build / test)
   │
   ▼ 通过后并触发
GitHub Actions: ci.yml > build-images job
   │ (并行构建 web / api / worker 三镜像，推 GHCR)
   ▼ 完成后触发
GitHub Actions: deploy.yml (SSH 到 VPS 执行 scripts/deploy.sh)
   │
   ▼
VPS：git pull → docker compose pull → prisma migrate deploy → prisma db seed → up -d → worker restart
   │
   ▼
Smoke check：curl https://your-domain/health
```

### Source config 种子数据

种子（`packages/db/prisma/seed.ts`）由 deploy.sh 在每次部署中**自动**跑一次 — `prisma db seed` 是 idempotent 的（RSS 走 `upsert(platform_url)`，HN 走 `findFirst(platform, identifier)` + update-or-create），新增 SP（如 SP-3 Reddit、SP-22 Twitter）只需把 SourceConfig 行加进 seed.ts，下一次 push to main 即自动生效，无需手动 ssh。

如需在不发版的前提下手动重跑 seed（例如调整了某个 source 的 `enabled`/`crawlInterval` 想立刻生效）：

```bash
ssh deploy@<vps-ip>
cd /srv/ai-hot-news
docker compose --env-file .env -f docker/docker-compose.prod.yml \
  run --rm --entrypoint sh api -c "cd packages/db && npx prisma db seed"
docker compose --env-file .env -f docker/docker-compose.prod.yml restart worker

# 验证
docker compose --env-file .env -f docker/docker-compose.prod.yml exec postgres \
  psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "SELECT platform, name, identifier, enabled FROM source_configs ORDER BY platform, name;"
```

之后访问 `https://<your-domain>/news` 即可看到列表页。

### 手动回滚

```bash
ssh deploy@<vps-ip>
cd /srv/ai-hot-news
git log --oneline -10                      # 看最近提交
IMAGE_TAG=<旧 commit sha> bash scripts/deploy.sh <旧 commit sha>
```

## Troubleshooting

### `pnpm install` 报 `ERR_PNPM_OUTDATED_LOCKFILE`

```bash
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml && git commit -m "chore: update pnpm lockfile"
```

### Prisma migrate 报 `extension "vector" is not available`

dev 容器镜像必须是 `pgvector/pgvector:pg16`。如果错误持续：

```bash
docker compose -f docker/docker-compose.dev.yml down -v
docker compose -f docker/docker-compose.dev.yml up -d
```

### `pnpm dev` 后 NestJS 报 "Cannot find module dist/main"

`nest start --watch` 在 `tsconfig.tsbuildinfo` 与 `dist/` 不一致时偶发：

```bash
rm -rf apps/api/dist apps/api/tsconfig.tsbuildinfo
rm -rf apps/worker/dist apps/worker/tsconfig.tsbuildinfo
pnpm dev
```

### Caddy 自动证书签发失败

- 检查域名 DNS 是否解析到 VPS IP（`dig +short <domain>`）
- 检查 80 / 443 端口是否被防火墙放行
- 查看 caddy 日志：`docker compose -f docker/docker-compose.prod.yml logs caddy`

### GHCR 仓库 pull 报 `unauthorized`

- `GHCR_PULL_TOKEN` 权限不够：必须至少 `packages:read`
- VPS 上执行 `echo $GHCR_TOKEN | docker login ghcr.io -u <user> --password-stdin` 手动验证

### Node 25 / 24 警告

`.nvmrc` 锁定 Node 22 LTS。如本机用更新版本，建议 `nvm use` 或 `fnm use` 切到 22 接近 prod 行为。

## License

MIT

