# SP-0: Monorepo + Infra Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把空仓库变成"5 进程 + 反代"在本地与服务器都能跑起来的工程地基，不写业务代码。

**Architecture:** pnpm workspace + Turborepo monorepo，三个 apps（web/api/worker）分别是 Next.js 15、NestJS 11 REST、NestJS standalone Worker；两个 packages（db/types）共享代码；Docker Compose 在 dev 仅跑 pg+redis、prod 跑全部 6 容器；GitHub Actions push to main 后构建镜像推 GHCR 并 SSH 部署到搬瓦工 VPS。

**Tech Stack:** Node 22 LTS · pnpm 9 · Turborepo 2 · TypeScript 5 · Next.js 15 + React 19 + Tailwind 4 · NestJS 11 · Prisma 6 · pgvector/pgvector:pg16 · Redis 7 · BullMQ 5 · Vitest 2 · ESLint 9 (flat) · Prettier 3 · Caddy 2 · GitHub Actions · GHCR

**Spec：** `docs/superpowers/specs/2026-05-01-sp0-monorepo-infra-design.md`

---

## 任务总览（16 个 Task）

| # | Task | 主要产出 | 提交 |
|---|------|---------|------|
| 1 | Repo bootstrap | root config 文件 + workspace | feat: bootstrap pnpm workspace |
| 2 | ESLint + Prettier + tsconfig.base | 根级 lint/format/TS 配置 | chore: add eslint/prettier/tsconfig |
| 3 | Docker Compose dev | docker/docker-compose.dev.yml | chore: add docker-compose for local dev |
| 4 | packages/types | 共享 enum + index | feat(types): add shared enums |
| 5 | packages/db (Prisma) | schema + 初版迁移 + client | feat(db): add prisma schema and client |
| 6 | apps/api (NestJS health) | health module + main.ts | feat(api): scaffold nestjs with health endpoint |
| 7 | apps/worker (standalone) | worker context + liveness | feat(worker): scaffold standalone worker with liveness |
| 8 | apps/web (Next.js placeholder) | layout + page + health route | feat(web): scaffold next.js with placeholder homepage |
| 9 | 本地 5 进程联调验证 | （仅验证，无文件改动）| — |
| 10 | 三个 app 的 Dockerfile | apps/{web,api,worker}/Dockerfile | chore: add multi-stage Dockerfiles |
| 11 | docker-compose.prod.yml + Caddyfile | docker/docker-compose.prod.yml + Caddyfile | chore: add production compose and Caddy |
| 12 | GitHub Actions CI | .github/workflows/ci.yml | ci: add lint/typecheck/build workflow |
| 13 | GitHub Actions build-images | ci.yml 增加 build-images job | ci: add ghcr image build job |
| 14 | GitHub Actions deploy + scripts/deploy.sh | .github/workflows/deploy.yml + scripts/deploy.sh | ci: add auto-deploy on main |
| 15 | VPS 首次配置 + smoke check | （服务器侧，无仓库改动）| — |
| 16 | README finalization | README.md | docs: add setup and deployment guide |

---

## Task 1: Repo Bootstrap

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.nvmrc`
- Modify: `.gitignore`（已存在 git 自动 init 的 .gitignore？检查一下）
- Create: `.env.example`

- [ ] **Step 1.1: 检查并清理现有根级文件**

```bash
ls -la
cat .gitignore 2>/dev/null || echo "no .gitignore"
```

Expected: 仓库根目前只有 `README.md`、`docs/`、`.cursor/`、`.claude/`、`.git/`、`.DS_Store`，没有 `package.json` / `pnpm-workspace.yaml`。

- [ ] **Step 1.2: 创建 `.nvmrc`**

```text
22
```

- [ ] **Step 1.3: 创建 `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
.next/
.turbo/
*.tsbuildinfo

# Generated Prisma client
packages/db/src/generated/

# Env files
.env
.env.local
.env.*.local
!.env.example

# IDE / OS
.DS_Store
.vscode/
.idea/
*.swp

# Docker volumes (local dev)
data/
postgres-data/
redis-data/

# Logs
*.log
npm-debug.log*
pnpm-debug.log*
```

- [ ] **Step 1.4: 创建 root `package.json`**

```json
{
  "name": "ai-hot-news",
  "version": "0.0.1",
  "private": true,
  "description": "AI Hot News 热点信息聚合与监控平台",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "db:generate": "pnpm --filter @ai-hot-news/db prisma generate",
    "db:migrate:dev": "pnpm --filter @ai-hot-news/db prisma migrate dev",
    "db:migrate:deploy": "pnpm --filter @ai-hot-news/db prisma migrate deploy",
    "db:studio": "pnpm --filter @ai-hot-news/db prisma studio",
    "docker:dev": "docker compose -f docker/docker-compose.dev.yml up -d",
    "docker:dev:down": "docker compose -f docker/docker-compose.dev.yml down"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.6.3",
    "prettier": "^3.3.3",
    "@types/node": "^22.9.0"
  }
}
```

- [ ] **Step 1.5: 创建 `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 1.6: 创建 `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local", "**/.env"],
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build", "@ai-hot-news/db#db:generate"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build", "@ai-hot-news/db#db:generate"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "@ai-hot-news/db#db:generate": {
      "cache": false,
      "outputs": ["src/generated/**"]
    }
  }
}
```

- [ ] **Step 1.7: 创建 root `.env.example`**

```bash
# === Database ===
POSTGRES_USER=ai_hot_news
POSTGRES_PASSWORD=dev_password
POSTGRES_DB=ai_hot_news_dev
DATABASE_URL=postgresql://ai_hot_news:dev_password@localhost:5432/ai_hot_news_dev?schema=public

# === Redis ===
REDIS_URL=redis://localhost:6379

# === Common ===
NODE_ENV=development
DOMAIN=localhost
```

- [ ] **Step 1.8: 复制 `.env.example` 到 `.env`（仅本地，不入库）**

```bash
cp .env.example .env
```

- [ ] **Step 1.9: 安装 root 依赖并验证 workspace 起来**

```bash
pnpm install
```

Expected: 输出包含 `Already up to date` 或 lock 文件生成；root `node_modules` 出现；无 ERR。

- [ ] **Step 1.10: 验证 turbo 命令**

```bash
pnpm turbo --version
```

Expected: `2.3.x`。

- [ ] **Step 1.11: Commit**

```bash
git add .
git commit -m "feat: bootstrap pnpm workspace with turborepo"
```

---

## Task 2: ESLint + Prettier + tsconfig.base

**Files:**
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json`（增加 ESLint 依赖）

- [ ] **Step 2.1: 创建 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "incremental": true,
    "declaration": false,
    "sourceMap": true,
    "allowJs": false,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false
  },
  "exclude": ["node_modules", "dist", ".next", "src/generated"]
}
```

- [ ] **Step 2.2: 创建 `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf"
}
```

- [ ] **Step 2.3: 创建 `.prettierignore`**

```text
node_modules/
.next/
.turbo/
dist/
data/
src/generated/
pnpm-lock.yaml
*.md
```

- [ ] **Step 2.4: 安装 ESLint 相关依赖**

```bash
pnpm add -D -w eslint@^9.15.0 typescript-eslint@^8.15.0 \
  eslint-config-prettier@^9.1.0 \
  @eslint/js@^9.15.0
```

Expected: 安装成功，root `package.json` `devDependencies` 增加这些。

- [ ] **Step 2.5: 创建 `eslint.config.js`（flat config）**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/src/generated/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
```

- [ ] **Step 2.6: 在 root `package.json` `scripts` 增加 lint root 命令**

修改 `package.json` 的 `scripts.lint`：

```json
"lint": "eslint . && turbo run lint"
```

> root eslint 跑一遍捕获顶层 config 错；turbo run lint 在每个 workspace 跑各自的 lint script（后续每个 app/package 自己定义）。

- [ ] **Step 2.7: 验证 prettier 和 eslint 命令可用**

```bash
pnpm prettier --version
pnpm eslint --version
```

Expected: 分别输出 `3.3.x` 和 `9.15.x`。

- [ ] **Step 2.8: 跑一次 prettier check 确认无报错**

```bash
pnpm format:check
```

Expected: 输出 `All matched files use Prettier code style!`。

- [ ] **Step 2.9: Commit**

```bash
git add .
git commit -m "chore: add eslint flat config, prettier, base tsconfig"
```

---

## Task 3: Docker Compose Dev

**Files:**
- Create: `docker/docker-compose.dev.yml`

- [ ] **Step 3.1: 创建 `docker/docker-compose.dev.yml`**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: ai-hot-news-postgres-dev
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-ai_hot_news}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-dev_password}
      POSTGRES_DB: ${POSTGRES_DB:-ai_hot_news_dev}
    ports:
      - "5432:5432"
    volumes:
      - ../data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-ai_hot_news}"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: ai-hot-news-redis-dev
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

- [ ] **Step 3.2: 启动 dev compose 验证**

```bash
pnpm docker:dev
```

Expected: 输出含 `Container ai-hot-news-postgres-dev  Started` 和 `Container ai-hot-news-redis-dev  Started`。

- [ ] **Step 3.3: 验证两服务 healthy**

```bash
sleep 8
docker compose -f docker/docker-compose.dev.yml ps
```

Expected: 两行容器，STATUS 列含 `(healthy)`。

- [ ] **Step 3.4: 用 psql 客户端连接验证**

```bash
docker exec ai-hot-news-postgres-dev psql -U ai_hot_news -d ai_hot_news_dev -c "SELECT version();"
docker exec ai-hot-news-postgres-dev psql -U ai_hot_news -d ai_hot_news_dev -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname='vector';"
```

Expected: 第一条返回 PG 16 版本，第二条返回 `vector`。

- [ ] **Step 3.5: 关闭 dev compose**

```bash
pnpm docker:dev:down
```

- [ ] **Step 3.6: Commit**

```bash
git add docker/
git commit -m "chore: add docker-compose for local pg+redis"
```

---

## Task 4: packages/types

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/src/enums.ts`
- Create: `packages/types/src/index.ts`

- [ ] **Step 4.1: 创建 `packages/types/package.json`**

```json
{
  "name": "@ai-hot-news/types",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "build": "echo 'no-op (types-only package)'"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 4.2: 创建 `packages/types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4.3: 创建 `packages/types/src/enums.ts`**

```ts
export const Platform = {
  TWITTER: 'TWITTER',
  RSS: 'RSS',
  HACKERNEWS: 'HACKERNEWS',
  REDDIT: 'REDDIT',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const HeatLevel = {
  BURST: 'BURST',
  HOT: 'HOT',
  NORMAL: 'NORMAL',
  LOW: 'LOW',
} as const;
export type HeatLevel = (typeof HeatLevel)[keyof typeof HeatLevel];

export const ContentStatus = {
  VISIBLE: 'VISIBLE',
  HIDDEN: 'HIDDEN',
  PENDING: 'PENDING',
} as const;
export type ContentStatus = (typeof ContentStatus)[keyof typeof ContentStatus];

export const SourceStatus = {
  NORMAL: 'NORMAL',
  FAILED: 'FAILED',
  LIMITED: 'LIMITED',
} as const;
export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];

export const UserRole = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const NotificationType = {
  KEYWORD_HIT: 'KEYWORD_HIT',
  BURST_HOTNEWS: 'BURST_HOTNEWS',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
```

- [ ] **Step 4.4: 创建 `packages/types/src/index.ts`**

```ts
export * from './enums.js';
```

- [ ] **Step 4.5: 安装 packages/types 依赖**

```bash
pnpm install
```

Expected: lock 文件更新，无错。

- [ ] **Step 4.6: 跑一次 typecheck 验证**

```bash
pnpm --filter @ai-hot-news/types typecheck
```

Expected: 0 errors。

- [ ] **Step 4.7: Commit**

```bash
git add packages/types/
git commit -m "feat(types): add shared enums for platform, heat level, content status"
```

---

## Task 5: packages/db (Prisma)

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/index.ts`

- [ ] **Step 5.1: 创建 `packages/db/package.json`**

```json
{
  "name": "@ai-hot-news/db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "build": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0",
    "prisma": "^6.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3"
  }
}

> **注**：`prisma` CLI 故意放在 `dependencies` 而非 `devDependencies`，因为生产环境部署时需要在 api 容器内运行 `prisma migrate deploy`。Prisma 官方文档也允许这样。
```

- [ ] **Step 5.2: 创建 `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/generated"]
}
```

- [ ] **Step 5.3: 创建 `packages/db/prisma/schema.prisma`**

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
  output          = "../src/generated"
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

// ═════════════════════════════════════════════════════════════
// Enums
// ═════════════════════════════════════════════════════════════

enum Platform {
  TWITTER
  RSS
  HACKERNEWS
  REDDIT
}

enum HeatLevel {
  BURST
  HOT
  NORMAL
  LOW
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

enum UserRole {
  ADMIN
  USER
}

enum NotificationType {
  KEYWORD_HIT
  BURST_HOTNEWS
  SYSTEM
}

// ═════════════════════════════════════════════════════════════
// Full models (used from P0/P1)
// ═════════════════════════════════════════════════════════════

model HotNews {
  id              String        @id @default(cuid())
  title           String
  summary         String?
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
  embedding       Unsupported("vector(1536)")?

  dedupeHash      String        @unique
  groupId         String?

  status          ContentStatus @default(VISIBLE)
  interactionData Json?

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
  name           String
  url            String?
  identifier     String?
  enabled        Boolean      @default(true)
  crawlInterval  Int          @default(1800)
  lastCrawledAt  DateTime?
  status         SourceStatus @default(NORMAL)
  errorMessage   String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([platform, enabled])
  @@map("source_configs")
}

// ═════════════════════════════════════════════════════════════
// Placeholder models (activated in later SPs)
// ═════════════════════════════════════════════════════════════

model User {
  id           String           @id @default(cuid())
  email        String           @unique
  passwordHash String
  role         UserRole         @default(ADMIN)
  createdAt    DateTime         @default(now())

  monitors      KeywordMonitor[]
  notifications Notification[]

  @@map("users")
}

model KeywordMonitor {
  id        String       @id @default(cuid())
  userId    String
  keyword   String
  enabled   Boolean      @default(true)
  createdAt DateTime     @default(now())

  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  hits KeywordHit[]

  @@index([userId])
  @@map("keyword_monitors")
}

model KeywordHit {
  id        String   @id @default(cuid())
  hotNewsId String
  keywordId String
  hitAt     DateTime @default(now())

  hotNews HotNews        @relation(fields: [hotNewsId], references: [id], onDelete: Cascade)
  keyword KeywordMonitor @relation(fields: [keywordId], references: [id], onDelete: Cascade)

  @@unique([hotNewsId, keywordId])
  @@index([keywordId, hitAt(sort: Desc)])
  @@map("keyword_hits")
}

model Notification {
  id        String           @id @default(cuid())
  userId    String
  type      NotificationType
  payload   Json
  readAt    DateTime?
  createdAt DateTime         @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, readAt])
  @@map("notifications")
}
```

- [ ] **Step 5.4: 创建 `packages/db/src/index.ts`**

```ts
import { PrismaClient } from './generated/index.js';

let prismaInstance: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

export type { PrismaClient } from './generated/index.js';
export * from './generated/index.js';
```

- [ ] **Step 5.5: 安装 db 包依赖**

```bash
pnpm install
```

Expected: lock 文件更新，prisma 和 @prisma/client 出现在 packages/db/node_modules 或 hoisted 到 root。

- [ ] **Step 5.6: 启动 dev pg + redis**

```bash
pnpm docker:dev
sleep 5
```

- [ ] **Step 5.7: 第一次跑 prisma migrate dev 创建初始迁移**

```bash
pnpm db:migrate:dev --name init
```

Expected: 输出含 `Applying migration '20260501XXXXXX_init'` 和 `Your database is now in sync with your schema.`，并生成 `packages/db/prisma/migrations/<timestamp>_init/migration.sql` 和 `packages/db/src/generated/`。

> **若失败**：检查 `.env` 中 `DATABASE_URL` 是否能连接（`localhost:5432`），pgvector extension 是否安装在 PG 容器内（`pgvector/pgvector:pg16` 镜像默认带）。

- [ ] **Step 5.8: 验证表结构创建成功**

```bash
docker exec ai-hot-news-postgres-dev psql -U ai_hot_news -d ai_hot_news_dev -c "\dt"
```

Expected: 输出 6 张表 `hot_news`、`source_configs`、`users`、`keyword_monitors`、`keyword_hits`、`notifications`，外加 `_prisma_migrations`。

- [ ] **Step 5.9: 验证 vector 扩展已创建**

```bash
docker exec ai-hot-news-postgres-dev psql -U ai_hot_news -d ai_hot_news_dev -c "SELECT extname FROM pg_extension;"
```

Expected: 输出含 `plpgsql` 和 `vector`。

- [ ] **Step 5.10: 跑 typecheck 验证 generated client 类型可用**

```bash
pnpm --filter @ai-hot-news/db typecheck
```

Expected: 0 errors。

- [ ] **Step 5.11: Commit（不要 commit 生成的 client）**

```bash
git add packages/db/
git status
# 确认 packages/db/src/generated/ 不在 staging 里（被 .gitignore 排除）
git commit -m "feat(db): add prisma schema with hot_news, source_configs, and placeholder models"
```

---

## Task 6: apps/api (NestJS REST + health)

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/nest-cli.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.service.ts`
- Create: `apps/api/src/health/health.controller.spec.ts`
- Create: `apps/api/.env.example`

- [ ] **Step 6.1: 创建 `apps/api/package.json`**

```json
{
  "name": "@ai-hot-news/api",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@ai-hot-news/db": "workspace:*",
    "@ai-hot-news/types": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "ioredis": "^5.4.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.9.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "ts-loader": "^9.5.1",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 6.2: 创建 `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "removeComments": true,
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "baseUrl": ".",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 6.3: 创建 `apps/api/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 6.4: 创建 `apps/api/.env.example`**

```bash
PORT=3001
CORS_ORIGIN=http://localhost:3000
```

- [ ] **Step 6.5: 创建 `apps/api/src/main.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = parseInt(process.env.PORT ?? '3001', 10);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

bootstrap();
```

- [ ] **Step 6.6: 创建 `apps/api/src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 6.7: 写 health controller 的失败测试（TDD）**

Create `apps/api/src/health/health.controller.spec.ts`:

```ts
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let serviceMock: { getHealth: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    serviceMock = {
      getHealth: vi.fn().mockResolvedValue({
        ok: true,
        service: 'api',
        version: '0.0.1',
        uptime: 1.23,
        checks: { db: 'ok', redis: 'ok' },
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: serviceMock }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('GET /health 返回 ok=true 含 db/redis 状态', async () => {
    const result = await controller.getHealth();
    expect(result.ok).toBe(true);
    expect(result.service).toBe('api');
    expect(result.checks.db).toBe('ok');
    expect(result.checks.redis).toBe('ok');
    expect(serviceMock.getHealth).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6.8: 跑测试，确认失败**

```bash
cd apps/api
pnpm vitest run src/health/health.controller.spec.ts
```

Expected: FAIL，"Cannot find module './health.controller'"。

- [ ] **Step 6.9: 创建 `apps/api/src/health/health.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { getPrisma } from '@ai-hot-news/db';
import Redis from 'ioredis';

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  uptime: number;
  checks: {
    db: 'ok' | 'fail';
    redis: 'ok' | 'fail';
  };
}

@Injectable()
export class HealthService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async getHealth(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    return {
      ok: db === 'ok' && redis === 'ok',
      service: 'api',
      version: process.env.npm_package_version ?? '0.0.1',
      uptime: process.uptime(),
      checks: { db, redis },
    };
  }

  private async checkDb(): Promise<'ok' | 'fail'> {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  private async checkRedis(): Promise<'ok' | 'fail'> {
    try {
      await this.redis.connect().catch(() => undefined);
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'ok' : 'fail';
    } catch {
      return 'fail';
    }
  }
}
```

- [ ] **Step 6.10: 创建 `apps/api/src/health/health.controller.ts`**

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthResponse } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth(): Promise<HealthResponse> {
    return this.health.getHealth();
  }
}
```

- [ ] **Step 6.11: 创建 `apps/api/src/health/health.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
```

- [ ] **Step 6.12: 创建 `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  esbuild: {
    target: 'es2022',
  },
});
```

- [ ] **Step 6.13: 安装依赖并跑 health 测试，确认通过**

```bash
cd ../..
pnpm install
cd apps/api
pnpm vitest run src/health/health.controller.spec.ts
```

Expected: 1 passed。

- [ ] **Step 6.14: 跑 typecheck**

```bash
cd ../..
pnpm --filter @ai-hot-news/api typecheck
```

Expected: 0 errors。

- [ ] **Step 6.15: 启动 api 进程验证可访问 /health**

```bash
pnpm --filter @ai-hot-news/api dev
```

打开新终端：

```bash
curl -s http://localhost:3001/health | jq
```

Expected: 输出含 `"ok": true`、`"service": "api"`、`"checks":{"db":"ok","redis":"ok"}`。

- [ ] **Step 6.16: 停掉 api 进程（Ctrl-C）**

- [ ] **Step 6.17: Commit**

```bash
git add apps/api/
git commit -m "feat(api): scaffold nestjs with /health endpoint and db+redis checks"
```

---

## Task 7: apps/worker (NestJS standalone + liveness)

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/nest-cli.json`
- Create: `apps/worker/src/main.ts`
- Create: `apps/worker/src/worker.module.ts`
- Create: `apps/worker/src/liveness.service.ts`
- Create: `apps/worker/src/liveness.service.spec.ts`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/.env.example`

- [ ] **Step 7.1: 创建 `apps/worker/package.json`**

```json
{
  "name": "@ai-hot-news/worker",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "nest start --watch --entryFile main",
    "build": "nest build",
    "start": "node dist/main",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@ai-hot-news/db": "workspace:*",
    "@ai-hot-news/types": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/schedule": "^4.1.2",
    "bullmq": "^5.34.0",
    "ioredis": "^5.4.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/node": "^22.9.0",
    "ts-loader": "^9.5.1",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 7.2: 创建 `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "removeComments": true,
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 7.3: 创建 `apps/worker/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 7.4: 创建 `apps/worker/.env.example`**

```bash
# Worker reads root .env for DATABASE_URL and REDIS_URL
LIVENESS_FILE=/tmp/worker-alive
```

- [ ] **Step 7.5: 写 liveness service 的失败测试（TDD）**

Create `apps/worker/src/liveness.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LivenessService } from './liveness.service';

describe('LivenessService', () => {
  const testFile = join(tmpdir(), `worker-alive-test-${process.pid}`);
  let service: LivenessService;

  beforeEach(() => {
    process.env.LIVENESS_FILE = testFile;
    service = new LivenessService();
    if (existsSync(testFile)) unlinkSync(testFile);
  });

  afterEach(() => {
    service.onModuleDestroy();
    if (existsSync(testFile)) unlinkSync(testFile);
  });

  it('onModuleInit 后立即写一次 liveness file', () => {
    service.onModuleInit();
    expect(existsSync(testFile)).toBe(true);
    const content = readFileSync(testFile, 'utf-8');
    expect(content).toMatch(/^\d+$/); // timestamp
  });

  it('updateLiveness 写入当前时间戳到 liveness file', () => {
    const before = Math.floor(Date.now() / 1000);
    service.updateLiveness();
    expect(existsSync(testFile)).toBe(true);
    const content = parseInt(readFileSync(testFile, 'utf-8'), 10);
    expect(content).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 7.6: 创建 `apps/worker/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  esbuild: {
    target: 'es2022',
  },
});
```

- [ ] **Step 7.7: 跑测试确认失败**

```bash
cd ../..
pnpm install
cd apps/worker
pnpm vitest run src/liveness.service.spec.ts
```

Expected: FAIL "Cannot find module './liveness.service'"。

- [ ] **Step 7.8: 实现 `apps/worker/src/liveness.service.ts`**

```ts
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { writeFileSync } from 'node:fs';

const DEFAULT_FILE = '/tmp/worker-alive';
const INTERVAL_MS = 30_000;

@Injectable()
export class LivenessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LivenessService.name);
  private timer?: NodeJS.Timeout;
  private readonly file = process.env.LIVENESS_FILE ?? DEFAULT_FILE;

  onModuleInit(): void {
    this.updateLiveness();
    this.timer = setInterval(() => this.updateLiveness(), INTERVAL_MS);
    this.logger.log(`Liveness writer started at ${this.file} (interval ${INTERVAL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  updateLiveness(): void {
    try {
      writeFileSync(this.file, String(Math.floor(Date.now() / 1000)));
    } catch (err) {
      this.logger.error(`Failed to write liveness file ${this.file}`, err);
    }
  }
}
```

- [ ] **Step 7.9: 跑测试确认通过**

```bash
pnpm vitest run src/liveness.service.spec.ts
```

Expected: 2 passed。

- [ ] **Step 7.10: 创建 `apps/worker/src/worker.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LivenessService } from './liveness.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [LivenessService],
})
export class WorkerModule {}
```

- [ ] **Step 7.11: 创建 `apps/worker/src/main.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });

  const logger = new Logger('Worker');
  logger.log('Worker ready, no jobs registered yet');

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();
```

- [ ] **Step 7.12: 跑 typecheck 验证**

```bash
cd ../..
pnpm --filter @ai-hot-news/worker typecheck
```

Expected: 0 errors。

- [ ] **Step 7.13: 启动 worker 验证 liveness file**

```bash
pnpm --filter @ai-hot-news/worker dev
```

新终端：

```bash
sleep 3
cat /tmp/worker-alive
```

Expected: 输出当前时间戳（10 位数字）。

- [ ] **Step 7.14: 停掉 worker 进程（Ctrl-C），观察日志含 "shutting down..."**

- [ ] **Step 7.15: Commit**

```bash
git add apps/worker/
git commit -m "feat(worker): scaffold standalone nestjs worker with liveness writer"
```

---

## Task 8: apps/web (Next.js placeholder)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/api/health/route.ts`
- Create: `apps/web/.env.example`

- [ ] **Step 8.1: 创建 `apps/web/package.json`**

```json
{
  "name": "@ai-hot-news/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "eslint app/",
    "typecheck": "tsc --noEmit",
    "test": "echo 'no tests yet (P4)'"
  },
  "dependencies": {
    "@ai-hot-news/types": "workspace:*",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0-beta.6",
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^4.0.0-beta.6",
    "typescript": "^5.6.3"
  }
}
```

> **注**：Tailwind 4 在 2026-05-01 仍处 beta。若 GA 已发布，把版本号改为 `^4.0.0`。

- [ ] **Step 8.2: 创建 `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 8.3: 创建 `apps/web/next.config.ts`**

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    typedRoutes: true,
  },
};

export default config;
```

- [ ] **Step 8.4: 创建 `apps/web/postcss.config.mjs`**

```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

> **若使用 Tailwind 4 GA 版本**：可能改为 `tailwindcss: {}` + `autoprefixer: {}`。检查 tailwindcss v4 官方迁移文档。

- [ ] **Step 8.5: 创建 `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 8.6: 创建 `apps/web/app/globals.css`**

```css
@import 'tailwindcss';

:root {
  --background: 255 255 255;
  --foreground: 26 31 58;
}

body {
  color: rgb(var(--foreground));
  background: rgb(var(--background));
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 8.7: 创建 `apps/web/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Hot News',
  description: 'AI 热点信息聚合与监控平台',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8.8: 创建 `apps/web/app/page.tsx`**

```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold">AI Hot News</h1>
        <p className="mt-2 text-gray-600">SP-0 placeholder · v0.0.1</p>
        <p className="mt-1 text-xs text-gray-400">
          实际 UI 在 P4 / SP-8 起按 Aurora 设计稿落地
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 8.9: 创建 `apps/web/app/api/health/route.ts`**

```ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'web',
    version: '0.0.1',
    uptime: process.uptime(),
  });
}
```

- [ ] **Step 8.10: 创建 `apps/web/.env.example`**

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

- [ ] **Step 8.11: 安装依赖**

```bash
cd ../..
pnpm install
```

> 如果安装时出错（特别是 tailwindcss 4 beta），把版本调整为最新可用 beta，或临时回退到 `tailwindcss@^3.4.0` + 配合传统 `@tailwind base; @tailwind components; @tailwind utilities;` 写法。

- [ ] **Step 8.12: 跑 typecheck**

```bash
pnpm --filter @ai-hot-news/web typecheck
```

Expected: 0 errors。

- [ ] **Step 8.13: 启动 web 验证占位首页**

```bash
pnpm --filter @ai-hot-news/web dev
```

新终端：

```bash
curl -s http://localhost:3000 | grep -o 'AI Hot News'
curl -s http://localhost:3000/api/health
```

Expected：第一行输出 `AI Hot News`；第二行 JSON 含 `"ok":true,"service":"web"`。

- [ ] **Step 8.14: 停掉 web（Ctrl-C）**

- [ ] **Step 8.15: Commit**

```bash
git add apps/web/
git commit -m "feat(web): scaffold next.js 15 with placeholder homepage and /api/health"
```

---

## Task 9: 本地 5 进程联调验证（无文件改动）

- [ ] **Step 9.1: 确保 dev 容器在跑**

```bash
pnpm docker:dev
sleep 5
docker compose -f docker/docker-compose.dev.yml ps
```

Expected: postgres + redis 都 healthy。

- [ ] **Step 9.2: 用 turbo 一条命令并行起三个 app**

```bash
pnpm dev
```

观察输出：
- web 监听 3000
- api 监听 3001
- worker 输出 `Worker ready, no jobs registered yet`

- [ ] **Step 9.3: 三个 app 健康检查**

新终端：

```bash
curl -s http://localhost:3000 | grep -o 'AI Hot News' && echo "[web OK]"
curl -s http://localhost:3000/api/health | grep -q '"ok":true' && echo "[web /api/health OK]"
curl -s http://localhost:3001/health | grep -q '"ok":true' && echo "[api /health OK]"
test -f /tmp/worker-alive && echo "[worker liveness file OK]"
```

Expected: 4 行 `OK`。

- [ ] **Step 9.4: 关掉 turbo dev 进程（Ctrl-C），关 dev 容器**

```bash
pnpm docker:dev:down
```

> 这一 task 没有产生新文件，跳过 commit。

---

## Task 10: 三个 app 的 Dockerfile

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/web/Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 10.1: 创建 root `.dockerignore`**

```text
node_modules
**/node_modules
.next
**/.next
.turbo
**/.turbo
dist
**/dist
.git
.github
.env
.env.*
!.env.example
data
**/data
docs
.cursor
.claude
**/*.spec.ts
**/__tests__
README.md
```

- [ ] **Step 10.2: 创建 `apps/api/Dockerfile`（多阶段）**

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

# ───────── deps stage ─────────
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

# ───────── build stage ─────────
FROM node:${NODE_VERSION} AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
RUN pnpm --filter @ai-hot-news/db prisma generate
RUN pnpm --filter @ai-hot-news/api build

# ───────── runner stage ─────────
FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache openssl wget
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json apps/api/package.json
COPY --from=builder /app/packages/db/package.json packages/db/package.json
COPY --from=builder /app/packages/types/package.json packages/types/package.json
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/packages/db/src/generated packages/db/src/generated
COPY --from=builder /app/packages/db/prisma packages/db/prisma
COPY --from=builder /app/packages/types/src packages/types/src
RUN pnpm install --prod --frozen-lockfile --filter @ai-hot-news/api...

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "apps/api/dist/main"]
```

- [ ] **Step 10.3: 创建 `apps/worker/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

FROM node:${NODE_VERSION} AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
RUN pnpm --filter @ai-hot-news/db prisma generate
RUN pnpm --filter @ai-hot-news/worker build

FROM node:${NODE_VERSION} AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/worker/package.json apps/worker/package.json
COPY --from=builder /app/packages/db/package.json packages/db/package.json
COPY --from=builder /app/packages/types/package.json packages/types/package.json
COPY --from=builder /app/apps/worker/dist apps/worker/dist
COPY --from=builder /app/packages/db/src/generated packages/db/src/generated
COPY --from=builder /app/packages/db/prisma packages/db/prisma
COPY --from=builder /app/packages/types/src packages/types/src
RUN pnpm install --prod --frozen-lockfile --filter @ai-hot-news/worker...

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD test "$(($(date +%s) - $(cat /tmp/worker-alive 2>/dev/null || echo 0)))" -lt 90 || exit 1
CMD ["node", "apps/worker/dist/main"]
```

- [ ] **Step 10.4: 创建 `apps/web/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

FROM node:${NODE_VERSION} AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ai-hot-news/web build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache wget
RUN addgroup -g 1001 -S nextjs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nextjs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 10.5: 本地构建三个镜像验证 Dockerfile 正确**

```bash
docker build --platform linux/amd64 -f apps/api/Dockerfile -t ai-hot-news/api:local .
docker build --platform linux/amd64 -f apps/worker/Dockerfile -t ai-hot-news/worker:local .
docker build --platform linux/amd64 -f apps/web/Dockerfile -t ai-hot-news/web:local .
```

Expected: 三个镜像都 build 成功（每个约 5-10 分钟首次构建）。

> **若 web 构建失败**：检查 `apps/web/.next/standalone/` 是否生成（需要 `output: 'standalone'` 在 `next.config.ts` 中已配）。

- [ ] **Step 10.6: 本地 smoke test 镜像（可选但推荐）**

```bash
docker run --rm -d --name api-test \
  --add-host host.docker.internal:host-gateway \
  -e DATABASE_URL=postgresql://ai_hot_news:dev_password@host.docker.internal:5432/ai_hot_news_dev?schema=public \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e CORS_ORIGIN=http://localhost:3000 \
  -p 3001:3001 \
  ai-hot-news/api:local

sleep 8
curl -s http://localhost:3001/health | jq
docker stop api-test
```

Expected: 输出含 `"ok":true`、`"checks":{"db":"ok","redis":"ok"}`（前提：dev 容器在跑）。

- [ ] **Step 10.7: Commit**

```bash
git add apps/api/Dockerfile apps/worker/Dockerfile apps/web/Dockerfile .dockerignore
git commit -m "chore: add multi-stage Dockerfiles for api, worker, web"
```

---

## Task 11: docker-compose.prod.yml + Caddyfile

**Files:**
- Create: `docker/docker-compose.prod.yml`
- Create: `docker/Caddyfile`

- [ ] **Step 11.1: 创建 `docker/docker-compose.prod.yml`**

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
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    image: ${GHCR_REPO}/api:${IMAGE_TAG:-latest}
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      CORS_ORIGIN: ${CORS_ORIGIN}
      NODE_ENV: production
      PORT: 3001
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 15s
      timeout: 5s
      retries: 5

  worker:
    image: ${GHCR_REPO}/worker:${IMAGE_TAG:-latest}
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      NODE_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "test \"$(($(date +%s) - $(cat /tmp/worker-alive 2>/dev/null || echo 0)))\" -lt 90"]
      interval: 60s
      timeout: 5s
      retries: 3

  web:
    image: ${GHCR_REPO}/web:${IMAGE_TAG:-latest}
    environment:
      NEXT_PUBLIC_API_URL: ${PUBLIC_API_URL}
      NODE_ENV: production
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 15s
      timeout: 5s
      retries: 5

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      api:
        condition: service_healthy
      web:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  caddy_data:
  caddy_config:
```

- [ ] **Step 11.2: 创建 `docker/Caddyfile`**

```Caddyfile
{$DOMAIN} {
    encode gzip zstd

    # API 反代到 NestJS（去掉 /api 前缀传给后端）
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

    # Caddy 默认自动 Let's Encrypt（无需额外配置）
}
```

- [ ] **Step 11.3: Commit**

```bash
git add docker/docker-compose.prod.yml docker/Caddyfile
git commit -m "chore: add production docker-compose with caddy and ghcr image refs"
```

---

## Task 12: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 12.1: 创建 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: 22
  PNPM_VERSION: 9.15.0

jobs:
  test:
    name: Lint / Typecheck / Build / Test
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: ai_hot_news
          POSTGRES_PASSWORD: dev_password
          POSTGRES_DB: ai_hot_news_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U ai_hot_news"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://ai_hot_news:dev_password@localhost:5432/ai_hot_news_test?schema=public
      REDIS_URL: redis://localhost:6379

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm db:generate

      - name: Apply migrations to test DB
        run: pnpm db:migrate:deploy

      - name: Lint
        run: pnpm turbo run lint

      - name: Typecheck
        run: pnpm turbo run typecheck

      - name: Build
        run: pnpm turbo run build

      - name: Test
        run: pnpm turbo run test
```

- [ ] **Step 12.2: 本地模拟一遍 CI 流程**

```bash
pnpm docker:dev
sleep 5
DATABASE_URL=postgresql://ai_hot_news:dev_password@localhost:5432/ai_hot_news_dev?schema=public \
REDIS_URL=redis://localhost:6379 \
pnpm install && \
pnpm db:generate && \
pnpm turbo run lint typecheck build test
```

Expected: 所有任务通过。

> 失败时根据错误逐一修正（最常见：lint 规则、依赖未声明、prisma client 没生成等）。

- [ ] **Step 12.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint/typecheck/build/test workflow with pg+redis services"
```

- [ ] **Step 12.4: Push 验证 CI**

```bash
git push origin main
```

到 GitHub 看 Actions 标签页，等待 CI 跑完。

Expected: ci.yml 全绿（耗时约 3-5 分钟首次）。

> **若 CI 失败**：根据具体错误修复后重新提交。常见问题：
> - 锁文件不一致 → `pnpm install` 后重新 commit `pnpm-lock.yaml`
> - 路径大小写问题（macOS vs Linux）
> - Prisma 在 ubuntu CI 上需要不同的 binaryTargets（如失败，往 schema.prisma 里加 `binaryTargets = ["native", "debian-openssl-3.0.x"]`）

---

## Task 13: GitHub Actions build-images（push to GHCR）

**Files:**
- Modify: `.github/workflows/ci.yml`（增加 build-images job）

- [ ] **Step 13.1: 在 `.github/workflows/ci.yml` 末尾追加 build-images job**

完整文件改后内容（在 `test` job 后追加）：

```yaml
  build-images:
    name: Build & push images to GHCR
    needs: test
    runs-on: ubuntu-latest
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

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository }}/${{ matrix.app }}
          tags: |
            type=raw,value=latest
            type=sha,format=long

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          push: true
          platforms: linux/amd64
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=${{ matrix.app }}
          cache-to: type=gha,mode=max,scope=${{ matrix.app }}
```

- [ ] **Step 13.2: Push 触发 CI 验证 build-images**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add ghcr build & push job for web/api/worker"
git push origin main
```

到 GitHub 看 Actions：等 CI 跑完后，build-images 也应该全绿（3 个并行 job，每个 5-15 分钟）。

到 GitHub 仓库 → Packages 标签：应该看到 3 个 package：`ai-hot-news/web`、`ai-hot-news/api`、`ai-hot-news/worker`。

> **若失败**：常见问题
> - GITHUB_TOKEN 权限不够 → 仓库 Settings → Actions → General → Workflow permissions 选 "Read and write"
> - Dockerfile COPY 找不到文件 → 检查 .dockerignore 没把必要文件排除

---

## Task 14: GitHub Actions deploy + 部署脚本

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `scripts/deploy.sh`

- [ ] **Step 14.1: 创建 `scripts/deploy.sh`**

```bash
#!/usr/bin/env bash
# Run on the VPS by GitHub Actions deploy.yml.
# Pre-condition: /srv/ai-hot-news exists and contains the repo + .env.

set -euo pipefail

REPO_DIR="/srv/ai-hot-news"
COMPOSE_FILE="docker/docker-compose.prod.yml"
IMAGE_TAG="${1:-latest}"

cd "$REPO_DIR"

echo "==> Pulling latest source"
git fetch origin main
git reset --hard origin/main

echo "==> Logging into GHCR"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

echo "==> Pulling latest images (tag=$IMAGE_TAG)"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" pull

echo "==> Running database migrations"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" run --rm \
  --entrypoint sh api -c "cd packages/db && npx prisma migrate deploy"

echo "==> Bringing up services"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" up -d

echo "==> Container status"
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" ps

echo "==> Done"
```

- [ ] **Step 14.2: 给 `scripts/deploy.sh` 加可执行权限**

```bash
chmod +x scripts/deploy.sh
```

- [ ] **Step 14.3: 创建 `.github/workflows/deploy.yml`**

```yaml
name: Deploy

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest
    steps:
      - name: SSH deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          envs: GHCR_USER,GHCR_TOKEN
          script: |
            cd /srv/ai-hot-news
            export GHCR_USER="${{ github.actor }}"
            export GHCR_TOKEN="${{ secrets.GHCR_PULL_TOKEN }}"
            bash scripts/deploy.sh "${{ github.event.workflow_run.head_sha }}"

      - name: Smoke check
        run: |
          sleep 15
          curl --fail --max-time 15 "https://${{ secrets.DOMAIN }}/health" \
            && echo "[Smoke OK]"
```

- [ ] **Step 14.4: Commit**

```bash
git add scripts/deploy.sh .github/workflows/deploy.yml
git commit -m "ci: add ssh-based auto-deploy on main after ci passes"
```

> **不要现在 push！** 还需要先在 VPS 上配置好（Task 15）和在 GitHub 配置好 Secrets，否则推上去 deploy.yml 会失败。

---

## Task 15: VPS 首次配置 + smoke check

> 这一步在搬瓦工服务器上手工执行，无仓库改动。

- [ ] **Step 15.1: SSH 到 VPS（在本地 macOS 上执行）**

```bash
ssh root@<your-vps-ip>
```

- [ ] **Step 15.2: 安装 Docker + Docker Compose（如尚未安装）**

```bash
# 查看
docker --version || true
docker compose version || true
```

如果未安装：

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

- [ ] **Step 15.3: 创建非 root 部署用户（推荐）**

```bash
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

- [ ] **Step 15.4: 在本地生成专用部署密钥**

```bash
# 在本地（不在 VPS 上）
ssh-keygen -t ed25519 -C "github-deploy@ai-hot-news" -f ~/.ssh/ai-hot-news-deploy -N ""
```

把公钥追加到 VPS：

```bash
ssh-copy-id -i ~/.ssh/ai-hot-news-deploy.pub deploy@<your-vps-ip>
# 或手工：cat ~/.ssh/ai-hot-news-deploy.pub | ssh root@<ip> "cat >> /home/deploy/.ssh/authorized_keys"
```

测试：

```bash
ssh -i ~/.ssh/ai-hot-news-deploy deploy@<your-vps-ip> "whoami && docker ps"
```

Expected: 输出 `deploy` 和容器列表（可能空）。

- [ ] **Step 15.5: 在 VPS 上准备项目目录（用 deploy 用户）**

```bash
ssh deploy@<your-vps-ip>
sudo mkdir -p /srv/ai-hot-news
sudo chown deploy:deploy /srv/ai-hot-news
cd /srv/ai-hot-news
git clone https://github.com/<your-github-owner>/ai-hot-news.git .
```

- [ ] **Step 15.6: 在 VPS 上创建 `/srv/ai-hot-news/.env`（生产环境变量）**

```bash
cat > /srv/ai-hot-news/.env <<'EOF'
# === Domain ===
DOMAIN=hotnews.yourdomain.com

# === Postgres ===
POSTGRES_USER=ai_hot_news
POSTGRES_PASSWORD=<生成一个强密码>
POSTGRES_DB=ai_hot_news_prod
DATABASE_URL=postgresql://ai_hot_news:<同上密码>@postgres:5432/ai_hot_news_prod?schema=public

# === Redis ===
REDIS_URL=redis://redis:6379

# === API CORS ===
CORS_ORIGIN=https://hotnews.yourdomain.com

# === Web ===
PUBLIC_API_URL=https://hotnews.yourdomain.com/api

# === GHCR ===
GHCR_REPO=ghcr.io/<your-github-owner>/ai-hot-news

# === Image tag (deploy.sh 会覆盖) ===
IMAGE_TAG=latest
EOF
chmod 600 /srv/ai-hot-news/.env
```

> 强密码生成：`openssl rand -base64 32`

- [ ] **Step 15.7: DNS 解析配置（在 DNS 服务商面板）**

把 `hotnews.yourdomain.com` 的 A 记录指到 VPS 公网 IP。

验证：

```bash
dig +short hotnews.yourdomain.com
# 应输出 VPS IP
```

- [ ] **Step 15.8: 在 GitHub 仓库设置 Secrets**

到 `https://github.com/<your-github-owner>/ai-hot-news/settings/secrets/actions`，添加：

| Secret | 值 |
|---|---|
| `VPS_HOST` | VPS IP |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | 本地 `~/.ssh/ai-hot-news-deploy` 私钥内容（含 BEGIN/END） |
| `GHCR_PULL_TOKEN` | GitHub Personal Access Token（fine-grained，权限 read:packages） |
| `DOMAIN` | `hotnews.yourdomain.com` |

> GHCR_PULL_TOKEN 创建：GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new；Permissions：`packages: read`。

- [ ] **Step 15.9: Push 触发 deploy.yml**

```bash
# 本地
git push origin main
```

到 GitHub Actions 等 CI + build-images + deploy 全绿（首次约 10-20 分钟）。

- [ ] **Step 15.10: VPS 验证容器都跑起来了**

```bash
ssh deploy@<your-vps-ip>
cd /srv/ai-hot-news
docker compose -f docker/docker-compose.prod.yml ps
```

Expected: 6 个容器（postgres / redis / api / worker / web / caddy）全部 healthy。

- [ ] **Step 15.11: 浏览器和 curl 验证**

```bash
# 本地
curl -v https://hotnews.yourdomain.com/health
curl https://hotnews.yourdomain.com
```

Expected: 
- `/health` 返回 200，JSON 含 `"ok":true,"checks":{"db":"ok","redis":"ok"}`
- `/`（首页）返回 200，HTML 含 `AI Hot News`
- 证书是 Let's Encrypt 签发

> 这一步无 commit。

---

## Task 16: README finalization

**Files:**
- Modify: `README.md`

- [ ] **Step 16.1: 重写 `README.md`**

```markdown
# AI Hot News

AI 热点信息聚合与监控平台 · [PRD V3](docs/PRD/AI%20Hot%20News%20热点信息聚合网站3%20PRD.md) · [Aurora 设计稿](docs/Design/AI%20Hot%20News%20Aurora.html)

## 技术栈

- **前端**：Next.js 15 (App Router) · React 19 · Tailwind 4
- **后端**：NestJS 11 · Prisma 6 · PostgreSQL 16 + pgvector · Redis 7 · BullMQ 5
- **基础设施**：pnpm 9 + Turborepo 2 · Docker Compose · Caddy 2 (auto HTTPS)
- **部署**：搬瓦工 VPS · GitHub Actions · GHCR

## 本地开发

### 前置依赖

- Node 22 (`nvm use` 或 `fnm use`)
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker Desktop（或 Colima / OrbStack）

### 一键启动

```bash
git clone <this-repo> ai-hot-news && cd ai-hot-news
cp .env.example .env

pnpm install                  # 安装所有 workspace 依赖
pnpm docker:dev               # 启动 postgres + redis 容器
pnpm db:migrate:dev           # 应用 Prisma 迁移并生成 client
pnpm dev                      # 并行启动 web/api/worker
```

启动后：
- Web：http://localhost:3000
- API：http://localhost:3001/health
- 数据库：localhost:5432（pgvector 已启用）
- Redis：localhost:6379

### 常用命令

```bash
pnpm lint                     # 全仓库 lint
pnpm typecheck                # 全仓库 TS 检查
pnpm build                    # 全仓库构建
pnpm test                     # 全仓库测试
pnpm db:studio                # 打开 Prisma Studio（数据库 GUI）
pnpm format                   # Prettier 格式化
```

## 项目结构

```
ai-hot-news/
├── apps/
│   ├── web/        # Next.js 15 (App Router)
│   ├── api/        # NestJS REST API（端口 3001）
│   └── worker/     # NestJS standalone（无 HTTP 端口，跑后台任务）
├── packages/
│   ├── db/         # Prisma schema + 共享 client
│   └── types/      # 共享 enum / DTO
├── docker/
│   ├── docker-compose.dev.yml    # 仅 pg+redis（本地）
│   ├── docker-compose.prod.yml   # 全部服务 + Caddy（生产）
│   └── Caddyfile
├── .github/workflows/
│   ├── ci.yml      # lint / typecheck / build / test + 镜像推 GHCR
│   └── deploy.yml  # main 通过后 SSH 自动部署
├── scripts/deploy.sh             # VPS 上执行的部署脚本
└── docs/                         # PRD / 设计稿 / spec / plan
```

## 部署到搬瓦工 VPS

### 首次配置

详见 `docs/superpowers/plans/2026-05-01-sp0-monorepo-infra-plan.md` Task 15。要点：

1. 在 VPS 安装 Docker + Docker Compose
2. 创建 `deploy` 用户，加入 docker 组
3. SSH 公钥配置到 `deploy@<vps>`
4. `git clone` 到 `/srv/ai-hot-news`
5. 创建 `/srv/ai-hot-news/.env`（生产环境变量）
6. 配置域名 DNS A 记录指向 VPS
7. 在 GitHub 仓库设置 Secrets：`VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` / `GHCR_PULL_TOKEN` / `DOMAIN`

### 自动部署流程

```text
git push origin main
   │
   ▼
GitHub Actions: ci.yml (lint/typecheck/build/test)
   │
   ▼ 通过后并触发
GitHub Actions: ci.yml > build-images job
   │  (并行构建 web/api/worker 三镜像，推 GHCR)
   ▼ 完成后触发
GitHub Actions: deploy.yml
   │  (SSH 到 VPS 执行 scripts/deploy.sh)
   ▼
VPS 上：git pull → docker compose pull → prisma migrate deploy → up -d
   │
   ▼
Smoke check：curl https://your-domain/health
```

### 手动回滚

```bash
ssh deploy@<vps>
cd /srv/ai-hot-news
git log --oneline -10                      # 看最近提交
IMAGE_TAG=<旧 commit sha> bash scripts/deploy.sh <旧 commit sha>
```

## Troubleshooting

### `pnpm install` 报 `ERR_PNPM_OUTDATED_LOCKFILE`

```bash
pnpm install --no-frozen-lockfile        # 重新生成 lock
git add pnpm-lock.yaml && git commit -m "chore: update pnpm lockfile"
```

### Prisma migrate 报错 `extension "vector" is not available`

dev 容器镜像应该是 `pgvector/pgvector:pg16`。如错误持续：

```bash
docker compose -f docker/docker-compose.dev.yml down -v
docker compose -f docker/docker-compose.dev.yml up -d
```

### Caddy 证书签发失败

- 检查域名 DNS 是否真的解析到 VPS IP（`dig +short <domain>`）
- 检查 80 / 443 端口是否被防火墙放行
- 查 caddy 日志：`docker logs ai-hot-news-caddy-1`

## License

MIT
```

- [ ] **Step 16.2: Commit README**

```bash
git add README.md
git commit -m "docs: add comprehensive setup, architecture, and deployment guide"
```

- [ ] **Step 16.3: Push 触发最终一次完整 CI + deploy**

```bash
git push origin main
```

观察 Actions：CI → build-images → deploy → smoke 全绿。

---

## 验收 Checklist（实施完成后逐项打勾）

来自 spec 第 12 节：

- [ ] `pnpm install` 成功，0 警告（除已知第三方）
- [ ] `pnpm docker:dev` → pg + redis healthy
- [ ] `pnpm db:migrate:dev` → 创建 6 张表（hot_news, source_configs, users, keyword_monitors, keyword_hits, notifications）
- [ ] `pnpm dev` → 三进程并行启动，无报错
- [ ] `curl http://localhost:3000` → 200，显示 "AI Hot News" 占位
- [ ] `curl http://localhost:3001/health` → 200，含 db ping + redis ping 状态
- [ ] worker 日志含 `Worker ready`
- [ ] `/tmp/worker-alive` 文件存在且时间戳近 30s 内
- [ ] CI on PR：lint + typecheck + build 全绿
- [ ] CI on push to main：build-images 成功，3 个镜像推到 GHCR
- [ ] deploy.yml 自动触发，SSH 到 VPS 执行成功
- [ ] `docker compose ps`（VPS）→ 6 个容器全部 healthy
- [ ] `curl https://<your-domain>/health` → 200，证书有效
- [ ] `curl https://<your-domain>` → 200，显示占位首页
- [ ] 模拟一次"误删 main 重新部署"：`git revert + push` → 自动重部署成功
- [ ] README.md 完整，新人按文档可在 30min 内本地起服务

---

## 常见问题应急（Troubleshooting）

| 症状 | 可能原因 | 处理 |
|---|---|---|
| `pnpm install` 报 lockfile 过期 | 改了 package.json 没更新 lockfile | `pnpm install --no-frozen-lockfile` 后 commit |
| Prisma migrate 报 `extension "vector" not available` | 用了非 pgvector 镜像 | 确认 dev 镜像是 `pgvector/pgvector:pg16`；删 volume 重起 |
| API 容器 healthcheck 失败 | wget 缺失 / 端口不通 / DB 连不上 | `docker logs <api-container>` 看实际错；多见于 `DATABASE_URL` 写错 |
| Worker 容器 healthcheck 失败 | `/tmp/worker-alive` 没写入 | 确认 `LivenessService.onModuleInit` 被调用；查 worker logs |
| Caddy 证书签发失败 | DNS 没生效 / 80 端口被占 | `dig +short`、`netstat -tnlp \| grep ':80'` |
| GitHub Actions deploy.yml 触发不了 | workflow_run 条件没满足 | 检查 ci.yml conclusion 是否 success；branches 字段是否含 main |
| GHCR 仓库 pull 报 unauthorized | GHCR_PULL_TOKEN 权限不够 | PAT 至少要 packages:read，且 token 持有人能访问该仓库 |
| Build 阶段 prisma generate 失败 | binaryTargets 缺 ubuntu/alpine | 在 schema.prisma 加 `binaryTargets = ["native", "linux-musl", "linux-musl-openssl-3.0.x"]` |

---

## 完成判定

所有 16 个 Task 的 step 都打勾 + 上面 16 项验收 checklist 全部通过 = SP-0 完成，进入 SP-1 brainstorming。
