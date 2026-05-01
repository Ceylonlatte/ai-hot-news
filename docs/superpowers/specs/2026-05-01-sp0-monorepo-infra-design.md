# SP-0：Monorepo + Infra 骨架 设计

- **日期**：2026-05-01
- **状态**：Draft，待用户审阅
- **所属**：Phase 0 / SP-0（详见 `2026-05-01-ai-hot-news-decomposition-design.md` 第 6 节）
- **预计工作量**：3-5 天
- **本文档定位**：单个子项目实现 spec，用户审阅通过后调用 `writing-plans` 生成 step-by-step 实施计划。

---

## 1. 目标与验收标准

### 1.1 目标

把仓库从"空"变成"5 个进程能在本地和服务器同时跑起来"，**不写任何业务代码**。
SP-0 完成后再启动 SP-1 写业务，整个项目生命周期内不再大改 monorepo 结构。

### 1.2 硬验收标准（必须通过的命令）

```bash
# === 本地（macOS）===
pnpm install                                              # 0 错误
docker compose -f docker/docker-compose.dev.yml up -d     # pg + redis 起来
pnpm db:migrate:dev                                       # Prisma 迁移成功
pnpm dev                                                  # web/api/worker 三进程
curl localhost:3000                                       # web 200（占位首页）
curl localhost:3001/health                                # api 200 {ok:true,service:"api",...}
# worker 进程 logs 输出 "Worker ready, no jobs registered yet"

# === CI（任意分支 push 或 PR）===
# GitHub Actions ci.yml 全绿：lint + typecheck + build (+ 可选 test)

# === 部署（push 到 main 触发 deploy.yml）===
# 1) CI 跑完后 deploy.yml 自动执行
# 2) GHCR 拉取最新镜像
# 3) SSH 到 VPS 执行迁移 + up -d
ssh vps "cd /srv/ai-hot-news && docker compose -f docker/docker-compose.prod.yml ps"
# 5 个容器（postgres, redis, web, api, worker）+ 1 个 caddy 全部 healthy
curl https://<your-domain>/health                         # 200 + 证书有效（Let's Encrypt）
curl https://<your-domain>                                # 占位首页
```

### 1.3 Out-of-scope（不在 SP-0 内）

明确**不做**，防止范围爆炸：

| 不做的事 | 留给 |
|---|---|
| shadcn/ui 安装与配置 | P4 / SP-8 |
| 任何业务 API 端点（除 `/health`） | P1 / SP-1 起 |
| 任何爬虫代码 | P1 / SP-1 |
| Vercel AI SDK 集成 | P3 / SP-5 |
| JWT 认证 | P5 / SP-13 |
| Tailwind theme / Aurora 设计 | P4 / SP-8 |
| Dashboard / Feed / Detail 等业务页面 | P4 / SP-9..12 |
| BullMQ 队列定义和消费者 | P1 / SP-1（开始注册 RSS job） |
| pgvector 索引（IVFFlat / HNSW） | P3 / SP-7（合并阶段才需要） |
| 监控与告警系统 | P5 / SP-18（邮件出来后） |

---

## 2. 关键技术决策汇总

| 维度 | 决策 | 备注 |
|---|---|---|
| Node | 22 LTS | 通过 `package.json` engines 字段约束 |
| 包管理器 | pnpm 9+ | `packageManager` 字段锁定版本 |
| Monorepo 工具 | Turborepo 2 | 任务编排 + 增量缓存 |
| 前端 | Next.js 15 (App Router) + React 19 + Tailwind 4 | shadcn 留给 P4 |
| 后端 | NestJS 11 + Prisma 6 | REST，OpenAPI 后续按需 |
| Worker | NestJS standalone（`createApplicationContext`） + BullMQ 5 | 独立进程，与 API 共享 Prisma client |
| 数据库 | PostgreSQL 16 + pgvector 扩展 | Docker 镜像 `pgvector/pgvector:pg16` |
| 缓存/队列 | Redis 7 | 镜像 `redis:7-alpine` |
| 测试 | Vitest 2 | 替代 NestJS 默认 Jest |
| Lint/Format | ESLint 9 (flat config) + Prettier 3 | NestJS 标配 |
| 本地 dev | Docker 跑 pg+redis；host 跑 web/api/worker | 平衡热重载体验与 prod 一致性 |
| HTTPS | Caddy 容器 + Let's Encrypt 自动证书 | 已有域名 |
| 部署触发 | push to main → CI 通过 → 自动 deploy | 个人项目反馈最快 |
| 镜像构建 | CI 中 `docker buildx` build & push 到 GHCR | 服务器只 pull |
| 数据库迁移 | 部署脚本中 `docker compose run --rm api pnpm prisma migrate deploy` | 失败可手动回滚 |
| 健康检查 | 每应用 `GET /health` 返回 `{ok, service, version, uptime}` | docker healthcheck 也用同端点 |
| 环境变量 | root `.env`（共享）+ 各 app `.env`（局部）+ 全部提交 `.env.example` | dotenv 读取 |
| Commit 规范 | Conventional Commits（推荐，不强制）| husky/commitlint 不引入 |

---

## 3. 仓库结构

```text
ai-hot-news/
├── apps/
│   ├── web/                          # Next.js 15
│   │   ├── app/
│   │   │   ├── page.tsx              # 占位首页（一句"AI Hot News" + 版本号）
│   │   │   ├── layout.tsx            # 极简 layout（Aurora 留给 P4）
│   │   │   ├── globals.css           # Tailwind base（无 Aurora tokens）
│   │   │   └── api/
│   │   │       └── health/route.ts   # Next.js Route Handler 健康检查
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── postcss.config.mjs
│   │   ├── tsconfig.json
│   │   ├── package.json
│   │   ├── Dockerfile                # 多阶段：deps → build → runner
│   │   └── .env.example
│   │
│   ├── api/                          # NestJS 11
│   │   ├── src/
│   │   │   ├── main.ts               # bootstrap, CORS, ValidationPipe, listen 3001
│   │   │   ├── app.module.ts         # imports: ConfigModule, HealthModule
│   │   │   └── health/
│   │   │       ├── health.module.ts
│   │   │       ├── health.controller.ts   # GET /health
│   │   │       └── health.service.ts      # 检查 DB ping + Redis ping
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── .env.example
│   │
│   └── worker/                       # NestJS standalone
│       ├── src/
│       │   ├── main.ts               # NestFactory.createApplicationContext
│       │   ├── worker.module.ts      # imports: ConfigModule, PrismaModule
│       │   └── liveness.service.ts   # 每 30s 写 /tmp/worker-alive，docker healthcheck 用
│       ├── tsconfig.json
│       ├── package.json
│       ├── Dockerfile
│       └── .env.example
│
├── packages/
│   ├── db/                           # Prisma + 共享 client
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # 完整 schema（见第 4 节）
│   │   │   └── migrations/
│   │   │       └── 20260501000000_init/
│   │   │           └── migration.sql # 由 prisma migrate dev 生成
│   │   ├── src/
│   │   │   └── index.ts              # export PrismaClient 单例 + 类型
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── types/                        # 共享 enum / DTO
│       ├── src/
│       │   ├── enums.ts              # Platform, HeatLevel, ContentStatus, NotificationType
│       │   ├── dtos.ts               # 占位（HotNewsDto 等留给 SP-1）
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json
│
├── docker/
│   ├── docker-compose.dev.yml        # 仅 postgres + redis
│   ├── docker-compose.prod.yml       # postgres + redis + web + api + worker + caddy
│   └── Caddyfile                     # 反代规则（见第 6 节）
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # lint + typecheck + build (+ build images for main)
│       └── deploy.yml                # main 分支 CI 通过后 SSH 部署
│
├── scripts/
│   └── deploy.sh                     # 部署脚本（VPS 上执行）
│
├── turbo.json                        # Turborepo 任务配置
├── pnpm-workspace.yaml               # pnpm workspace 定义
├── package.json                      # root：脚本 + devDeps
├── tsconfig.base.json                # 各包继承的基础 TS 配置
├── eslint.config.js                  # ESLint 9 flat config
├── .prettierrc.json
├── .prettierignore
├── .gitignore
├── .nvmrc                            # 22
├── .env.example                      # root 共享：DATABASE_URL, REDIS_URL, NODE_ENV, ...
├── README.md                         # 安装与使用说明（见第 9 节）
└── docs/                             # （已存在）
```

---

## 4. Prisma Schema（SP-0 落地版本）

### 4.1 设计原则

- **完整定义**：HotNews + SourceConfig（P0/P1 立即用所有字段）
- **最小占位**：User / KeywordMonitor / KeywordHit / Notification（保留外键关系，对应 SP 启用时再 add columns）
- **不创建**：HotNewsGroup（P3）、KeywordTimeSeries（P6）、DailyReport（P6）—— 让对应 SP 自己加 migration

### 4.2 schema.prisma（完整内容草稿）

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
  output          = "../src/generated"
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgvector(map: "vector")]
}

// ═════════════════════════════════════════════════════════════
// 完整定义：P0/P1 即用
// ═════════════════════════════════════════════════════════════

enum Platform {
  TWITTER
  RSS
  HACKERNEWS
  REDDIT
}

enum HeatLevel {
  BURST   // 90-100
  HOT     // 70-89
  NORMAL  // 40-69
  LOW     // 0-39
}

enum ContentStatus {
  VISIBLE
  HIDDEN
  PENDING
}

enum SourceStatus {
  NORMAL
  FAILED
  LIMITED
}

model HotNews {
  id              String        @id @default(cuid())
  title           String
  summary         String?       // P3 才填充
  content         String        @db.Text
  rawHtml         String?       @db.Text
  sourcePlatform  Platform
  sourceUrl       String        @unique
  author          String?
  publishedAt     DateTime
  crawledAt       DateTime      @default(now())

  aiTags          String[]      @default([])
  matchedKeywords String[]      @default([])
  heatScore       Float         @default(0)
  heatLevel       HeatLevel     @default(LOW)
  embedding       Unsupported("vector(1536)")?  // OpenAI text-embedding-3-small

  dedupeHash      String        @unique
  groupId         String?       // P3 写入

  status          ContentStatus @default(VISIBLE)
  interactionData Json?         // {likes, reposts, comments, upvotes}

  hits            KeywordHit[]

  @@index([publishedAt(sort: Desc)])
  @@index([heatScore(sort: Desc)])
  @@index([groupId])
  @@index([sourcePlatform, publishedAt])
  @@map("hot_news")
}

model SourceConfig {
  id             String       @id @default(cuid())
  platform       Platform
  name           String       // 显示名，如 "OpenAI Blog"
  url            String?      // RSS feed URL / subreddit URL
  identifier     String?      // HN 的 topic / Reddit 的 subreddit name / X 的关键词
  enabled        Boolean      @default(true)
  crawlInterval  Int          @default(1800)  // 秒，默认 30 分钟
  lastCrawledAt  DateTime?
  status         SourceStatus @default(NORMAL)
  errorMessage   String?      // 最近一次失败原因
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([platform, enabled])
  @@map("source_configs")
}

// ═════════════════════════════════════════════════════════════
// 最小占位：对应 SP 启用时 add columns
// ═════════════════════════════════════════════════════════════

enum UserRole {
  ADMIN
  USER
}

model User {
  id           String           @id @default(cuid())
  email        String           @unique
  passwordHash String           // P5 启用
  role         UserRole         @default(ADMIN)
  createdAt    DateTime         @default(now())
  // SP-13 起：name, lastLoginAt, ...

  monitors     KeywordMonitor[]
  notifications Notification[]

  @@map("users")
}

model KeywordMonitor {
  id        String       @id @default(cuid())
  userId    String
  keyword   String
  enabled   Boolean      @default(true)
  createdAt DateTime     @default(now())
  // SP-14 起：synonyms, excludeWords, platforms, frequency, triggerRules, notifyChannels

  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  hits      KeywordHit[]

  @@index([userId])
  @@map("keyword_monitors")
}

model KeywordHit {
  id        String         @id @default(cuid())
  hotNewsId String
  keywordId String
  hitAt     DateTime       @default(now())

  hotNews   HotNews        @relation(fields: [hotNewsId], references: [id], onDelete: Cascade)
  keyword   KeywordMonitor @relation(fields: [keywordId], references: [id], onDelete: Cascade)

  @@unique([hotNewsId, keywordId])
  @@index([keywordId, hitAt(sort: Desc)])
  @@map("keyword_hits")
}

enum NotificationType {
  KEYWORD_HIT
  BURST_HOTNEWS
  SYSTEM
}

model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  payload   Json             // 不同 type 不同 payload，留给 SP-17 定义
  readAt    DateTime?
  createdAt DateTime         @default(now())

  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, readAt])
  @@map("notifications")
}
```

### 4.3 SP-0 不创建的模型

留给后续 SP 自己加 migration：
- `HotNewsGroup`（P3 / SP-7）：跨平台事件聚合的 group 元信息
- `KeywordTimeSeries`（P6 / SP-19）：按小时/天聚合
- `DailyReport`（P6 / SP-21）

### 4.4 Migration 名称规范

`20YYMMDDHHMMSS_<verb>_<subject>` —— 如 `20260501120000_init`、`20260615093000_add_hot_news_group`。

---

## 5. Docker Compose 设计

### 5.1 `docker/docker-compose.dev.yml`

仅本地依赖服务（pg + redis）。应用三进程 host 跑。

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: ai_hot_news
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB: ai_hot_news_dev
    ports:
      - "5432:5432"
    volumes:
      - ../data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ai_hot_news"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - ../data/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

### 5.2 `docker/docker-compose.prod.yml`

完整 prod 拓扑，6 个容器（5 应用/数据 + 1 反代）。
> **注意**：下方 `ghcr.io/<owner>/ai-hot-news/...` 中的 `<owner>` 在实施时替换为用户的 GitHub 用户名或组织名（如 `ghcr.io/yourname/ai-hot-news/api`）。后续也可考虑用 `GHCR_REPO` 环境变量参数化。

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
      interval: 10s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 5

  api:
    image: ghcr.io/<owner>/ai-hot-news/api:${IMAGE_TAG:-latest}
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      NODE_ENV: production
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 15s
      retries: 5

  worker:
    image: ghcr.io/<owner>/ai-hot-news/worker:${IMAGE_TAG:-latest}
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      NODE_ENV: production
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "test", "-f", "/tmp/worker-alive"]   # liveness file 30s 内更新
      interval: 60s
      retries: 3

  web:
    image: ghcr.io/<owner>/ai-hot-news/web:${IMAGE_TAG:-latest}
    environment:
      NEXT_PUBLIC_API_URL: ${PUBLIC_API_URL}
      NODE_ENV: production
    depends_on:
      api: { condition: service_healthy }
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000"]
      interval: 15s
      retries: 5

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      api: { condition: service_healthy }
      web: { condition: service_healthy }
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  caddy_data:
  caddy_config:
```

---

## 6. Caddyfile

```Caddyfile
{$DOMAIN} {
    encode gzip zstd
    
    # API 反代到 NestJS
    handle_path /api/* {
        reverse_proxy api:3001
    }
    
    # 健康检查直通（运维方便）
    handle /health {
        reverse_proxy api:3001
    }
    
    # 其余请求给 Next.js
    handle {
        reverse_proxy web:3000
    }
    
    # 自动 Let's Encrypt（Caddy 默认行为，无需额外配置）
}
```

> **注意**：`{$DOMAIN}` 从环境变量读取（在服务器 `.env` 中设置），CI 不持有域名。

---

## 7. GitHub Actions 工作流

### 7.1 `.github/workflows/ci.yml`

触发：push 任意分支 + PR。

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: 22
  PNPM_VERSION: 9

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: ${{ env.PNPM_VERSION }} }
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate                # prisma generate
      - run: pnpm turbo lint typecheck build
      - run: pnpm turbo test
        # SP-0 阶段无业务测试，期望 turbo 报告所有 task 为 "no tests" 或 0 个 test pass。
        # 命令本身退出码 0，CI 视为通过。

  build-images:
    runs-on: ubuntu-latest
    needs: ci
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        app: [web, api, worker]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ github.repository }}/${{ matrix.app }}:latest
            ghcr.io/${{ github.repository }}/${{ matrix.app }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 7.2 `.github/workflows/deploy.yml`

触发：`build-images` 成功后（用 `workflow_run` 监听 ci.yml）。

```yaml
name: Deploy

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            set -euo pipefail
            cd /srv/ai-hot-news
            git fetch origin main
            git reset --hard origin/main
            export IMAGE_TAG=${{ github.event.workflow_run.head_sha }}
            echo "$GHCR_TOKEN" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
            docker compose -f docker/docker-compose.prod.yml pull
            docker compose -f docker/docker-compose.prod.yml run --rm api pnpm prisma migrate deploy
            docker compose -f docker/docker-compose.prod.yml up -d
            docker compose -f docker/docker-compose.prod.yml ps
        env:
          GHCR_TOKEN: ${{ secrets.GHCR_PULL_TOKEN }}

      - name: Smoke check
        run: |
          sleep 10
          curl --fail --max-time 15 https://${{ secrets.DOMAIN }}/health
```

### 7.3 GitHub Secrets 清单

部署需要在 GitHub 仓库设置以下 secrets：
- `VPS_HOST`、`VPS_USER`、`VPS_SSH_KEY`
- `GHCR_PULL_TOKEN`（VPS pull 镜像用，权限：read:packages）
- `DOMAIN`（用于 smoke check）

---

## 8. 环境变量约定

### 8.1 root `.env.example`

```bash
# === Database ===
POSTGRES_USER=ai_hot_news
POSTGRES_PASSWORD=changeme
POSTGRES_DB=ai_hot_news
DATABASE_URL=postgresql://ai_hot_news:changeme@localhost:5432/ai_hot_news?schema=public

# === Redis ===
REDIS_URL=redis://localhost:6379

# === Common ===
NODE_ENV=development
DOMAIN=localhost
```

### 8.2 各 app 局部 `.env.example`

| app | 关键变量 |
|---|---|
| `apps/web/.env.example` | `NEXT_PUBLIC_API_URL=http://localhost:3001` |
| `apps/api/.env.example` | `PORT=3001`、`CORS_ORIGIN=http://localhost:3000` |
| `apps/worker/.env.example` | （空，从 root .env 继承）|

### 8.3 dev / prod 区分

- 本地：root 一份 `.env`（gitignore），dev compose 自动 load
- prod：服务器 `/srv/ai-hot-news/.env`（手工创建，不在 git 中），prod compose 通过 `env_file` 读取

---

## 9. 命令脚本（root `package.json`）

```json
{
  "name": "ai-hot-news",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "turbo dev --parallel",
    "build": "turbo build",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "format": "prettier --write .",
    "db:generate": "pnpm --filter @ai-hot-news/db prisma generate",
    "db:migrate:dev": "pnpm --filter @ai-hot-news/db prisma migrate dev",
    "db:migrate:deploy": "pnpm --filter @ai-hot-news/db prisma migrate deploy",
    "db:studio": "pnpm --filter @ai-hot-news/db prisma studio",
    "docker:dev": "docker compose -f docker/docker-compose.dev.yml up -d",
    "docker:dev:down": "docker compose -f docker/docker-compose.dev.yml down"
  }
}
```

`turbo.json`：

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": {
      "dependsOn": ["^build", "@ai-hot-news/db#db:generate"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["build"] },
    "@ai-hot-news/db#db:generate": {
      "cache": false,
      "outputs": ["src/generated/**"]
    }
  }
}
```

> Turborepo 2 用 `tasks` 替代旧的 `pipeline` 字段。

---

## 10. README.md 大纲

只列章节标题（实际内容在实施时编写）：

1. 项目简介（链接到 PRD V3）
2. 技术栈
3. 本地开发
   - 前置依赖（Node 22 / pnpm 9 / Docker）
   - 一键启动命令
4. 项目结构
5. 部署到搬瓦工 VPS
   - 服务器初始化（首次）
   - GitHub Secrets 配置
   - 自动部署流程
   - 手动回滚步骤
6. 常见问题（troubleshooting）

---

## 11. 已知风险与缓解

| 风险 | 缓解 |
|---|---|
| pgvector 镜像 `pgvector/pgvector:pg16` 在搬瓦工可能拉不动 | 失败时换 dockerhub 镜像源；或在 dev 阶段提前验证镜像可用 |
| GHCR 镜像在搬瓦工 pull 慢 | 后续可考虑迁到阿里云 ACR 镜像加速；MVP 阶段忍受 |
| 搬瓦工 1G 内存机型可能 build 时跑不动 6 个容器 | SP-0 完成后实测；如不够升级到 2G 实例 |
| Caddy 自动证书可能失败（域名 DNS 未生效 / 80 端口被占） | deploy 脚本中加 `caddy validate` 预检 |
| pnpm 锁文件冲突（多人协作时） | 个人项目暂不存在，CI 用 `--frozen-lockfile` 保证一致 |
| `prisma migrate deploy` 失败导致服务无法启动 | 部署脚本检测 migrate 退出码，失败时不执行 `up -d`，保持旧版本运行 |
| Turborepo 远程缓存未启用导致 CI 慢 | SP-0 不接 Vercel Remote Cache；后续如 CI 时间 > 5 min 再加 |
| dev 模式 host 跑 Node 与 prod 容器内 Node 行为差异 | `.nvmrc` + `package.json#engines` 锁版本；CI 在容器内构建保证一致 |

---

## 12. 验收 checklist（实施完成后逐项打勾）

```text
[ ] pnpm install 成功，0 警告（除已知第三方）
[ ] docker compose -f docker/docker-compose.dev.yml up -d → pg + redis healthy
[ ] pnpm db:migrate:dev → 创建 6 张表（hot_news, source_configs, users,
    keyword_monitors, keyword_hits, notifications）
[ ] pnpm dev → 三进程并行启动，无报错
[ ] curl http://localhost:3000 → 200，显示 "AI Hot News" 占位
[ ] curl http://localhost:3001/health → 200，含 db ping + redis ping 状态
[ ] worker 日志含 "Worker ready"
[ ] CI on PR：lint + typecheck + build 全绿
[ ] CI on push to main：build-images 成功，3 个镜像推到 GHCR
[ ] deploy.yml 自动触发，SSH 到 VPS 执行成功
[ ] docker compose ps → 6 个容器全部 healthy
[ ] curl https://<your-domain>/health → 200，证书有效
[ ] curl https://<your-domain> → 200，显示占位首页
[ ] 模拟一次"误删 main 重新部署"：git revert + push → 自动重部署成功
[ ] README.md 完整，新人按文档可在 30min 内本地起服务
```

---

## 13. 后续步骤

本 spec 经用户审阅批准后：

1. 调用 `writing-plans` skill，把本 spec 转化为 step-by-step 实施计划文档（在 `docs/superpowers/plans/2026-05-XX-sp0-monorepo-infra-plan.md`）
2. 计划文档审阅通过后，进入 SP-0 实施
3. SP-0 完成（验收 checklist 全部打勾）后，启动 **SP-1（RSS → 列表页端到端骨架）** 的 brainstorming
