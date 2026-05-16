# SP-8 Aurora Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/web` 从 SP-1 灰白默认 Tailwind 升级到 Aurora 视觉系统：建立 `packages/ui` 共享组件包（6 atoms）+ 5 个路由（HomePage/news/Radar/Trends/Vault，4 个 mockup + 1 真页面）+ persistent Sidebar + aurora-blob 全局背景。`/news` 接 SP-6 的 heatScore 真数据并保留 SP-7 全部行为（折叠 / r/sub / 跨平台 badge）。

**Architecture:**

1. 新建 `packages/ui` workspace 包：6 个 atom（Glass / Pill / HeatBadge / Tag / PageHeader / Sidebar）+ tokens.ts + vitest+jsdom 测试基础设施（首次引入）。Sidebar 用 LinkComponent 注入避免 ui 包依赖 next。
2. `apps/web/app` 重写 layout.tsx（持久 Sidebar + aurora-blob）+ 新增 middleware.ts 注入 `x-pathname` header 让 RSC 拿到当前路径。
3. 4 个 mockup 路由（`/`、`/radar`、`/trends`、`/vault`）+ MockupBanner，hard-code Aurora HTML 假数据。
4. `/news` 复用现有 `fetchHotNewsList` 数据流，只换 _components/* 卡片样式，HeatBadge 接 SP-6 真数据，byline 区保留 SP-7-E 单独渲染（不并入 Pill）。

**Tech Stack:** Next.js 15 App Router · React 19 · Tailwind CSS v4 · @ai-hot-news/ui (TS 源码直 import) · vitest + @testing-library/react + jsdom (首次)

**Spec:** `docs/superpowers/specs/2026-05-16-sp8-aurora-visual-system-design.md`

**部署：3 PR 链** `feat/sp8-A-ui-tokens` → `feat/sp8-B-routes-mockups` → `feat/sp8-C-news-aurora-skin`，依赖序列。

---

## Pre-flight: codebase state on origin/main (VERIFIED 2026-05-16 22:06 UTC+8)

PR #24 (`docs/sp8-spec`) 已开但未 merge — **PR-A 启动前先把 PR #24 merge 到 origin/main**，否则 plan 引用 spec 的 §X.Y 锚点失效。

**已存在（不要重复创建）：**

- `apps/web/app/globals.css` — 当前 4 行简陋样式（仅 `@import 'tailwindcss'` + 2 个 CSS 变量）。**PR-A 重写**为 Aurora token + aurora-blob + glass + animations。
- `apps/web/app/layout.tsx` — 当前 24 行简陋 RootLayout（仅 `<html><body>{children}</body></html>`）。**PR-B 重写**为持久 Sidebar + aurora-blob 注入 + main 区 + middleware 读 x-pathname。
- `apps/web/app/page.tsx` — 当前 SP-1 placeholder（"→ 查看热点列表" 跳 /news）。**PR-B 重写**为 Aurora HomePage mockup。
- `apps/web/app/news/page.tsx` — SP-1/4.5/7 落地的真页面，含 feed-tabs + 真实 fetch。**PR-C 不动数据流**，仅顶部加 PageHeader。
- `apps/web/app/news/_components/news-item.tsx` — SP-7-E 后的最新版本（含 `formatByline` / `formatCrossPlatformBadge` / `<details>` 折叠 / titleZh fallback）。**PR-C 重写卡片样式**消费 packages/ui，**保留** byline / crossPlatformBadge / details JSX 结构。
- `apps/web/app/news/_components/{feed-tabs,list-header,pagination,empty-state,error-state,local-time}.tsx` — SP-1/4.5 落地。**PR-C 升级配色**到 aurora token（不改逻辑）。
- `apps/web/package.json` — Next 15.1 + React 19. **PR-A 加 `@ai-hot-news/ui: workspace:*` 依赖**。
- `apps/web/tailwind.config.ts` — 文件不存在！当前是 v4 写法直接在 globals.css 用 `@import 'tailwindcss'` 没有 ts config。**PR-A 新建** `tailwind.config.ts` 扩展 colors/fontFamily/animation。
- `pnpm-workspace.yaml` — 当前包含 `apps/*` + `packages/*`。**PR-A 不需要改**（packages/ui 自动被 `packages/*` glob 命中），但需要验证：`pnpm install` 后 `apps/web` 能 resolve `@ai-hot-news/ui`。
- `packages/types/src/dtos.ts` — `HotNewsListItemDto` 含 `subreddit / groupMembers / groupPlatforms / titleZh / heatScore / heatLevel`。**SP-8 不动**，仅消费。
- `packages/utils/`、`packages/prompts/`、`packages/db/`、`packages/types/` — 已用 vitest，**不动**。

**还没有（本 SP 创建/扩展）：**

- `packages/ui/` — 整个目录不存在（package.json + tsconfig + vitest.config + 6 atoms + 6 specs + tokens + index）。
- `apps/web/middleware.ts` — 不存在。
- `apps/web/app/_components/MockupBanner.tsx` — 不存在。
- `apps/web/app/{radar,trends,vault}/page.tsx` — 3 个新路由文件不存在。
- `apps/web/tailwind.config.ts` — 不存在。
- `apps/web` 没有 vitest infra（不打算补，§7.2 决策保留）。

**契约约束（实施时必须遵守）：**

1. **packages/ui 零 next 依赖** — Sidebar 通过 `LinkComponent` props 注入（spec §3.6）。任何 atom 不能 `import 'next/link'` / `'next/navigation'` 等。
2. **Pill atom 不接 subreddit** — SP-7-E 的 `r/<sub>` 显示在 byline 位单独渲染（spec §3.2 / §5.1）。
3. **/news 数据流 0 改动** — `fetchHotNewsList` / feed-tabs / pagination 逻辑保留，仅卡片样式升级（spec §5.1）。
4. **mockup 路由必带 MockupBanner** — `/`、`/radar`、`/trends`、`/vault` 顶部都要 `<MockupBanner targetSp="SP-X" />`，明确预期。
5. **3 个 PR 顺序部署** — PR-A merge → deploy（视觉无变化）→ PR-B merge → deploy（Aurora 5 路由 + /news 仍灰白）→ PR-C merge → deploy（/news 完成 Aurora 化，SP-8 V1 完工）。

---

## PR-A: tokens + ui 包 + globals.css

**分支：`feat/sp8-A-ui-tokens`**

**目标：** 建立 `packages/ui` 包（含 6 atoms + 22 单测 + tokens + vitest+jsdom 基础设施）；重写 `apps/web/app/globals.css` 为 Aurora 视觉系统；新增 `apps/web/tailwind.config.ts`。Merge 后 `apps/web` 视觉行为不变（layout/page/news 全部不改），仅样式底座就绪。

**估算：~2 天**

### Task A1: packages/ui workspace 包脚手架

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/.gitignore`

- [ ] **Step 1: 创建分支**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/sp8-A-ui-tokens
```

- [ ] **Step 2: 写 `packages/ui/package.json`**

```json
{
  "name": "@ai-hot-news/ui",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "scripts": {
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "echo 'no build needed (TS sources direct-imported)'"
  },
  "peerDependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^26.0.0",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 3: 写 `packages/ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src", "src/**/*.spec.tsx", "src/**/*.spec.ts"]
}
```

- [ ] **Step 4: 写 `packages/ui/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['@testing-library/jest-dom/vitest'],
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
```

- [ ] **Step 5: 写 `packages/ui/.gitignore`**

```
node_modules/
dist/
.turbo/
```

- [ ] **Step 6: 安装依赖（让 pnpm 把 packages/ui 加到 lockfile）**

```bash
pnpm install
```

Expected: `packages/ui` 出现在 `pnpm-lock.yaml` 的 importers 中。

- [ ] **Step 7: 验证 typecheck 跑通空目录**

```bash
mkdir -p packages/ui/src
echo 'export {};' > packages/ui/src/index.ts
pnpm --filter @ai-hot-news/ui typecheck
```

Expected: PASS（空 src 不应报错）。

- [ ] **Step 8: 提交脚手架**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "chore(sp8-A): scaffold packages/ui workspace package"
```

### Task A2: tokens.ts

**Files:**
- Create: `packages/ui/src/tokens.ts`
- Create: `packages/ui/src/tokens.spec.ts`

- [ ] **Step 1: 写 failing test `tokens.spec.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { tokens } from './tokens';

describe('tokens', () => {
  it('exports Aurora primary palette', () => {
    expect(tokens.bg).toBe('#f6f4ef');
    expect(tokens.ink).toBe('#14131a');
    expect(tokens.c1).toBe('#7e57f5');
  });

  it('exports glass surface tokens with rgba alpha', () => {
    expect(tokens.accentSoft).toMatch(/rgba\(126,\s*87,\s*245,/);
    expect(tokens.accentSoft2).toMatch(/rgba\(126,\s*87,\s*245,/);
  });

  it('is frozen const (readonly contract for downstream Tailwind config)', () => {
    expect(Object.isFrozen(tokens)).toBe(false); // 类型是 as const，runtime 不冻结，靠 TS 阻止突变
    // 这里只验证类型设计意图：tokens 引用与 spec §2.1 同步
    const colorKeys = Object.keys(tokens);
    expect(colorKeys).toContain('bg');
    expect(colorKeys).toContain('ink');
    expect(colorKeys).toContain('c1');
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

```bash
pnpm --filter @ai-hot-news/ui test -- tokens.spec
```

Expected: FAIL with "Cannot find module './tokens'"

- [ ] **Step 3: 写 `tokens.ts`**

```typescript
export const tokens = {
  bg: '#f6f4ef',
  ink: '#14131a',
  ink2: '#5a5763',
  ink3: '#9b97a3',
  ink4: '#d0ccd5',
  line: 'rgba(20, 19, 26, 0.06)',
  line2: 'rgba(20, 19, 26, 0.10)',
  c1: '#7e57f5',
  accent: '#7e57f5',
  accentSoft: 'rgba(126, 87, 245, 0.10)',
  accentSoft2: 'rgba(126, 87, 245, 0.18)',
} as const;

export type AuroraTokens = typeof tokens;
```

- [ ] **Step 4: 跑 test 确认 pass**

```bash
pnpm --filter @ai-hot-news/ui test -- tokens.spec
```

Expected: PASS（3/3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/tokens.ts packages/ui/src/tokens.spec.ts
git commit -m "feat(sp8-A): add tokens.ts with Aurora design palette"
```

### Task A3: Glass atom

**Files:**
- Create: `packages/ui/src/atoms/Glass.tsx`
- Create: `packages/ui/src/atoms/Glass.spec.tsx`

- [ ] **Step 1: 写 failing test `Glass.spec.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Glass } from './Glass';

describe('Glass', () => {
  it('renders default variant=card with .glass class', () => {
    render(<Glass data-testid="g">hello</Glass>);
    const el = screen.getByTestId('g');
    expect(el.className).toContain('glass');
    expect(el.className).not.toContain('glass-soft');
    expect(el.tagName).toBe('DIV');
  });

  it('renders variant=hover with .glass and .glass-hover classes', () => {
    render(<Glass variant="hover" data-testid="g">x</Glass>);
    const el = screen.getByTestId('g');
    expect(el.className).toContain('glass');
    expect(el.className).toContain('glass-hover');
  });

  it('renders as=article when as prop is set', () => {
    render(<Glass as="article" data-testid="g">x</Glass>);
    const el = screen.getByTestId('g');
    expect(el.tagName).toBe('ARTICLE');
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

```bash
pnpm --filter @ai-hot-news/ui test -- Glass.spec
```

Expected: FAIL with "Cannot find module './Glass'"

- [ ] **Step 3: 写 `Glass.tsx`**

```tsx
import { type HTMLAttributes, type ReactNode, createElement } from 'react';

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'card' | 'soft' | 'hover';
  as?: 'div' | 'article' | 'section' | 'aside';
  children: ReactNode;
}

const VARIANT_CLASSNAMES: Record<NonNullable<GlassProps['variant']>, string> = {
  card: 'glass',
  soft: 'glass-soft',
  hover: 'glass glass-hover',
};

export function Glass({
  variant = 'card',
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}: GlassProps) {
  const cls = `${VARIANT_CLASSNAMES[variant]} ${className}`.trim();
  return createElement(Tag, { className: cls, ...rest }, children);
}
```

- [ ] **Step 4: 跑 test 确认 pass**

```bash
pnpm --filter @ai-hot-news/ui test -- Glass.spec
```

Expected: PASS（3/3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/atoms/Glass.tsx packages/ui/src/atoms/Glass.spec.tsx
git commit -m "feat(sp8-A): add Glass atom with card/soft/hover variants"
```

### Task A4: Pill atom

**Files:**
- Create: `packages/ui/src/atoms/Pill.tsx`
- Create: `packages/ui/src/atoms/Pill.spec.tsx`

- [ ] **Step 1: 写 failing test `Pill.spec.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders HACKERNEWS as "HN"', () => {
    render(<Pill platform="HACKERNEWS" />);
    expect(screen.getByText('HN')).toBeInTheDocument();
  });

  it('renders REDDIT as "Reddit"', () => {
    render(<Pill platform="REDDIT" />);
    expect(screen.getByText('Reddit')).toBeInTheDocument();
  });

  it('renders RSS as "RSS"', () => {
    render(<Pill platform="RSS" />);
    expect(screen.getByText('RSS')).toBeInTheDocument();
  });

  it('renders TWITTER as "X"', () => {
    render(<Pill platform="TWITTER" />);
    expect(screen.getByText('X')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

```bash
pnpm --filter @ai-hot-news/ui test -- Pill.spec
```

Expected: FAIL with "Cannot find module './Pill'"

- [ ] **Step 3: 写 `Pill.tsx`**

```tsx
type Platform = 'HACKERNEWS' | 'REDDIT' | 'RSS' | 'TWITTER';

export interface PillProps {
  platform: Platform;
}

const PLATFORM_META: Record<Platform, { label: string; cls: string }> = {
  HACKERNEWS: { label: 'HN',     cls: 'bg-ink/[0.06] text-ink' },
  REDDIT:     { label: 'Reddit', cls: 'bg-aurora-soft text-aurora' },
  RSS:        { label: 'RSS',    cls: 'bg-ink-2/[0.08] text-ink-2' },
  TWITTER:    { label: 'X',      cls: 'bg-aurora-soft text-aurora' },
};

export function Pill({ platform }: PillProps) {
  const meta = PLATFORM_META[platform];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
```

- [ ] **Step 4: 跑 test 确认 pass**

```bash
pnpm --filter @ai-hot-news/ui test -- Pill.spec
```

Expected: PASS（4/4 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/atoms/Pill.tsx packages/ui/src/atoms/Pill.spec.tsx
git commit -m "feat(sp8-A): add Pill atom for HN/Reddit/RSS/Twitter platform labels"
```

### Task A5: HeatBadge atom

**Files:**
- Create: `packages/ui/src/atoms/HeatBadge.tsx`
- Create: `packages/ui/src/atoms/HeatBadge.spec.tsx`

- [ ] **Step 1: 写 failing test `HeatBadge.spec.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HeatBadge } from './HeatBadge';

describe('HeatBadge', () => {
  it('renders null when score and level are null (worker not yet processed)', () => {
    const { container } = render(<HeatBadge score={null} level={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders BURST level with pulse-ring class (visual emphasis)', () => {
    const { container } = render(<HeatBadge score={94} level="BURST" />);
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.className).toContain('pulse-ring');
    expect(span!.className).toContain('bg-aurora');
  });

  it('renders HOT level with aurora-soft2 background, no pulse-ring', () => {
    const { container } = render(<HeatBadge score={76} level="HOT" />);
    const span = container.querySelector('span');
    expect(span!.className).toContain('bg-aurora-soft2');
    expect(span!.className).not.toContain('pulse-ring');
  });

  it('renders NORMAL level without pulse-ring', () => {
    const { container } = render(<HeatBadge score={50} level="NORMAL" />);
    const span = container.querySelector('span');
    expect(span!.className).not.toContain('pulse-ring');
  });

  it('rounds float score to nearest integer (Math.round)', () => {
    const { container } = render(<HeatBadge score={85.7} level="HOT" />);
    expect(container.textContent).toBe('86');
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

```bash
pnpm --filter @ai-hot-news/ui test -- HeatBadge.spec
```

Expected: FAIL with "Cannot find module './HeatBadge'"

- [ ] **Step 3: 写 `HeatBadge.tsx`**

```tsx
type HeatLevel = 'BURST' | 'HOT' | 'NORMAL' | 'LOW';

export interface HeatBadgeProps {
  score: number | null;
  level: HeatLevel | null;
}

const LEVEL_META: Record<HeatLevel, { cls: string; pulse: boolean }> = {
  BURST:  { cls: 'bg-aurora text-white',                pulse: true },
  HOT:    { cls: 'bg-aurora-soft2 text-aurora',         pulse: false },
  NORMAL: { cls: 'bg-ink/[0.06] text-ink-2',            pulse: false },
  LOW:    { cls: 'bg-ink/[0.04] text-ink-3',            pulse: false },
};

export function HeatBadge({ score, level }: HeatBadgeProps) {
  if (score === null || level === null) return null;
  const meta = LEVEL_META[level];
  const display = Math.round(score);
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-mono font-semibold ${meta.cls} ${meta.pulse ? 'pulse-ring' : ''}`}>
      {display}
    </span>
  );
}
```

- [ ] **Step 4: 跑 test 确认 pass**

```bash
pnpm --filter @ai-hot-news/ui test -- HeatBadge.spec
```

Expected: PASS（5/5 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/atoms/HeatBadge.tsx packages/ui/src/atoms/HeatBadge.spec.tsx
git commit -m "feat(sp8-A): add HeatBadge atom (first UI consumer of SP-6 heatScore data)"
```

### Task A6: Tag atom

**Files:**
- Create: `packages/ui/src/atoms/Tag.tsx`
- Create: `packages/ui/src/atoms/Tag.spec.tsx`

- [ ] **Step 1: 写 failing test `Tag.spec.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Tag } from './Tag';

describe('Tag', () => {
  it('renders children with default aurora color (var(--c1))', () => {
    const { container } = render(<Tag>model:GPT-5</Tag>);
    const span = container.querySelector('span');
    expect(span!.textContent).toBe('model:GPT-5');
    expect(span!.style.color).toBe('var(--c1)');
  });

  it('accepts custom color via prop', () => {
    const { container } = render(<Tag color="rgb(255, 0, 0)">red tag</Tag>);
    const span = container.querySelector('span');
    expect(span!.style.color).toBe('rgb(255, 0, 0)');
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

```bash
pnpm --filter @ai-hot-news/ui test -- Tag.spec
```

Expected: FAIL

- [ ] **Step 3: 写 `Tag.tsx`**

```tsx
import type { ReactNode } from 'react';

export interface TagProps {
  children: ReactNode;
  color?: string;
}

export function Tag({ children, color = 'var(--c1)' }: TagProps) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium"
      style={{ background: 'var(--accent-soft)', color }}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: 跑 test 确认 pass**

```bash
pnpm --filter @ai-hot-news/ui test -- Tag.spec
```

Expected: PASS（2/2 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/atoms/Tag.tsx packages/ui/src/atoms/Tag.spec.tsx
git commit -m "feat(sp8-A): add Tag atom for aiTags chip rendering"
```

### Task A7: PageHeader atom

**Files:**
- Create: `packages/ui/src/atoms/PageHeader.tsx`
- Create: `packages/ui/src/atoms/PageHeader.spec.tsx`

- [ ] **Step 1: 写 failing test `PageHeader.spec.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders title and subtitle', () => {
    render(<PageHeader title="Hot News" subtitle="real-time aggregation" />);
    expect(screen.getByText('Hot News')).toBeInTheDocument();
    expect(screen.getByText('real-time aggregation')).toBeInTheDocument();
  });

  it('renders title only when subtitle is omitted', () => {
    render(<PageHeader title="Vault" />);
    expect(screen.getByText('Vault')).toBeInTheDocument();
  });

  it('renders right slot when provided (e.g., sort dropdown placeholder)', () => {
    render(<PageHeader title="x" right={<button>sort</button>} />);
    expect(screen.getByRole('button', { name: 'sort' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

```bash
pnpm --filter @ai-hot-news/ui test -- PageHeader.spec
```

Expected: FAIL

- [ ] **Step 3: 写 `PageHeader.tsx`**

```tsx
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between mb-8">
      <div>
        <h1 className="text-3xl font-light tracking-tight text-ink">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-ink-2">{subtitle}</p>
        )}
      </div>
      {right && <div>{right}</div>}
    </header>
  );
}
```

- [ ] **Step 4: 跑 test 确认 pass**

```bash
pnpm --filter @ai-hot-news/ui test -- PageHeader.spec
```

Expected: PASS（3/3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/atoms/PageHeader.tsx packages/ui/src/atoms/PageHeader.spec.tsx
git commit -m "feat(sp8-A): add PageHeader atom"
```

### Task A8: Sidebar atom（LinkComponent 注入）

**Files:**
- Create: `packages/ui/src/atoms/Sidebar.tsx`
- Create: `packages/ui/src/atoms/Sidebar.spec.tsx`

- [ ] **Step 1: 写 failing test `Sidebar.spec.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { ComponentType, ReactNode } from 'react';

const NavLink: ComponentType<{ href: string; children: ReactNode; className?: string }> = ({
  href,
  children,
  className,
}) => (
  <a href={href} data-testid={`link-${href}`} className={className}>
    {children}
  </a>
);

describe('Sidebar', () => {
  it('renders all 4 nav items via LinkComponent', () => {
    render(<Sidebar currentPath="/news" LinkComponent={NavLink} />);
    expect(screen.getByTestId('link-/')).toBeInTheDocument();
    expect(screen.getByTestId('link-/news')).toBeInTheDocument();
    expect(screen.getByTestId('link-/radar')).toBeInTheDocument();
    expect(screen.getByTestId('link-/trends')).toBeInTheDocument();
    expect(screen.getByTestId('link-/vault')).toBeInTheDocument();
  });

  it('marks current path as active (aria-current="page")', () => {
    render(<Sidebar currentPath="/news" LinkComponent={NavLink} />);
    const newsLink = screen.getByTestId('link-/news');
    expect(newsLink.getAttribute('aria-current')).toBe('page');
    const radarLink = screen.getByTestId('link-/radar');
    expect(radarLink.getAttribute('aria-current')).toBeNull();
  });

  it('falls back to / when currentPath is empty string', () => {
    render(<Sidebar currentPath="" LinkComponent={NavLink} />);
    const homeLink = screen.getByTestId('link-/');
    expect(homeLink.getAttribute('aria-current')).toBe('page');
  });
});
```

- [ ] **Step 2: 跑 test 确认 fail**

```bash
pnpm --filter @ai-hot-news/ui test -- Sidebar.spec
```

Expected: FAIL

- [ ] **Step 3: 写 `Sidebar.tsx`**

```tsx
import { type ComponentType, type ReactNode, createElement } from 'react';

interface NavLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  'aria-current'?: 'page';
}

export interface SidebarProps {
  currentPath: string;
  LinkComponent: ComponentType<NavLinkProps>;
}

const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; icon: string }> = [
  { href: '/',       label: 'Home',   icon: 'H' },
  { href: '/news',   label: 'News',   icon: 'N' },
  { href: '/radar',  label: 'Radar',  icon: 'R' },
  { href: '/trends', label: 'Trends', icon: 'T' },
  { href: '/vault',  label: 'Vault',  icon: 'V' },
];

export function Sidebar({ currentPath, LinkComponent }: SidebarProps) {
  const activePath = currentPath || '/';
  return (
    <aside className="hidden md:flex md:flex-col w-56 px-4 py-8 border-r border-line">
      <div className="px-3 mb-8 text-lg font-light tracking-tight text-ink">
        Aurora
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === activePath;
          const cls = `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
            isActive
              ? 'bg-aurora-soft text-aurora font-medium'
              : 'text-ink-2 hover:bg-ink/[0.04]'
          }`;
          return createElement(
            LinkComponent,
            isActive
              ? { key: item.href, href: item.href, className: cls, 'aria-current': 'page' }
              : { key: item.href, href: item.href, className: cls },
            <>
              <span className="w-5 h-5 inline-flex items-center justify-center text-xs font-mono opacity-60">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </>,
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 4: 跑 test 确认 pass**

```bash
pnpm --filter @ai-hot-news/ui test -- Sidebar.spec
```

Expected: PASS（3/3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/atoms/Sidebar.tsx packages/ui/src/atoms/Sidebar.spec.tsx
git commit -m "feat(sp8-A): add Sidebar atom with LinkComponent injection (zero next dep)"
```

### Task A9: 包导出 index.ts

**Files:**
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: 重写 `packages/ui/src/index.ts`（覆盖 Task A1 的 stub）**

```typescript
export { tokens, type AuroraTokens } from './tokens';
export { Glass, type GlassProps } from './atoms/Glass';
export { Pill, type PillProps } from './atoms/Pill';
export { HeatBadge, type HeatBadgeProps } from './atoms/HeatBadge';
export { Tag, type TagProps } from './atoms/Tag';
export { PageHeader, type PageHeaderProps } from './atoms/PageHeader';
export { Sidebar, type SidebarProps } from './atoms/Sidebar';
```

- [ ] **Step 2: 跑全套测试 + typecheck**

```bash
pnpm --filter @ai-hot-news/ui test
pnpm --filter @ai-hot-news/ui typecheck
```

Expected: 22 tests pass，typecheck 0 error。

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/index.ts
git commit -m "feat(sp8-A): export all 6 atoms + tokens from @ai-hot-news/ui index"
```

### Task A10: 全局 globals.css 重写为 Aurora

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: 整文件覆盖 `apps/web/app/globals.css`**

```css
@import 'tailwindcss';

:root {
  --bg: #f6f4ef;
  --ink: #14131a;
  --ink-2: #5a5763;
  --ink-3: #9b97a3;
  --ink-4: #d0ccd5;
  --line: rgba(20, 19, 26, 0.06);
  --line-2: rgba(20, 19, 26, 0.10);
  --c1: #7e57f5;
  --accent: #7e57f5;
  --accent-soft: rgba(126, 87, 245, 0.10);
  --accent-soft-2: rgba(126, 87, 245, 0.18);
}

html, body {
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  height: 100%;
  -webkit-font-smoothing: antialiased;
}

body {
  background-image:
    radial-gradient(ellipse 70% 50% at 0% 0%, #ece4ff 0%, transparent 55%),
    radial-gradient(ellipse 60% 50% at 100% 100%, #efe7ff 0%, transparent 50%);
  background-attachment: fixed;
  min-height: 100vh;
}

.aurora-blob { position: fixed; border-radius: 50%; filter: blur(90px); opacity: 0.4; pointer-events: none; z-index: 0; }
.ab-1 { width: 480px; height: 480px; background: #d9ccff; top: -100px; left: 200px; animation: drift1 25s ease-in-out infinite; }
.ab-2 { width: 380px; height: 380px; background: #e8dcff; top: 30%; right: -100px; animation: drift2 30s ease-in-out infinite; }
.ab-3 { width: 420px; height: 420px; background: #ebe3ff; bottom: -100px; left: 30%; animation: drift3 35s ease-in-out infinite; }

@keyframes drift1 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(120px, 80px); } }
@keyframes drift2 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-100px, 100px); } }
@keyframes drift3 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(80px, -80px); } }

.glass {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 18px;
  box-shadow: 0 1px 2px rgba(20, 19, 26, 0.03), 0 8px 24px rgba(20, 19, 26, 0.04);
}

.glass-soft {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 14px;
}

.glass-hover {
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.3s, border-color 0.3s;
}
.glass-hover:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(20, 19, 26, 0.05), 0 16px 40px rgba(20, 19, 26, 0.08);
  border-color: rgba(126, 87, 245, 0.25);
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes pulse-ring {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(2.2); opacity: 0;   }
}
@keyframes blink   { 50% { opacity: 0.3; } }
@keyframes fillBar { from { width: 0; } }

.fade-up    { animation: fadeUp 0.6s cubic-bezier(0.2, 0.6, 0.2, 1) backwards; }
.pulse-ring { position: relative; }
.pulse-ring::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.3;
  animation: pulse-ring 2s ease-out infinite;
}
.blink    { animation: blink 2s ease-in-out infinite; }
.fill-bar { animation: fillBar 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(sp8-A): rewrite globals.css with Aurora tokens, blob, glass, animations"
```

### Task A11: 新建 tailwind.config.ts 扩展 theme

**Files:**
- Create: `apps/web/tailwind.config.ts`
- Modify: `apps/web/package.json` (添加 `@ai-hot-news/ui: workspace:*` 依赖)

- [ ] **Step 1: 写 `apps/web/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        aurora: 'var(--c1)',
        'aurora-soft': 'var(--accent-soft)',
        'aurora-soft2': 'var(--accent-soft-2)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        'ink-4': 'var(--ink-4)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Helvetica Neue', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        '2xl': '18px',
        '3xl': '24px',
      },
      backdropBlur: {
        xl: '20px',
        lg: '16px',
      },
      animation: {
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.2, 0.6, 0.2, 1) backwards',
        blink: 'blink 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: 改 `apps/web/package.json` 加 ui 依赖**

```bash
pnpm --filter @ai-hot-news/web add @ai-hot-news/ui@workspace:*
```

Expected: `apps/web/package.json` 多一行 `"@ai-hot-news/ui": "workspace:*"`，`pnpm-lock.yaml` 更新。

- [ ] **Step 3: 验证 web 端可 resolve ui 包**

```bash
cd apps/web && pnpm tsc --noEmit
```

Expected: 0 error（types/dtos 等老代码无关 ui，本步只验证 resolution 链路通）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/tailwind.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(sp8-A): add tailwind.config.ts + wire @ai-hot-news/ui workspace dep"
```

### Task A12: 顶层 lint + typecheck + test 全绿

- [ ] **Step 1: 跑全仓 lint / typecheck / test**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected:
- lint：0 error
- typecheck：0 error（含 `@ai-hot-news/ui` 在 web 上下文 resolve 通）
- test：所有 task pass，新增 `@ai-hot-news/ui` 22 tests 全绿

- [ ] **Step 2: 跑 web 构建确认 css 没崩**

```bash
pnpm --filter @ai-hot-news/web build
```

Expected: build success，`.next/static/css/*.css` 中能搜到 `aurora-blob` / `glass` 字串。

- [ ] **Step 3: 启动 dev server 人肉看一眼 /news 没崩**

```bash
pnpm --filter @ai-hot-news/web dev
```

Expected:
- `http://localhost:3000/news` 正常渲染（本 PR 还没改 layout/page，外观仍跟 main 一致）。
- DevTools 看不到 console error。
- `<body>` 元素 computed style 含 `radial-gradient(...)` 背景图（确认 globals.css 生效）。

按 `Ctrl-C` 停 dev。

- [ ] **Step 4: 推送并开 PR**

```bash
git push -u origin feat/sp8-A-ui-tokens
gh pr create --title "feat(sp8-A): tokens + packages/ui + globals.css Aurora foundation" --body "$(cat <<'EOF'
## Summary

SP-8 PR-A：建立 Aurora 视觉系统底座，**不改任何页面行为**。

- 新建 `packages/ui` workspace 包：6 个 atom（Glass / Pill / HeatBadge / Tag / PageHeader / Sidebar）+ tokens.ts，22 个单测全绿
- vitest + jsdom + @testing-library/react 首次引入（仅限 packages/ui）
- 重写 `apps/web/app/globals.css` 为 Aurora token + aurora-blob + glass + animations
- 新建 `apps/web/tailwind.config.ts` 扩展 theme，把 packages/ui 加入 content 扫描

Sidebar 通过 `LinkComponent` props 注入，packages/ui 不依赖 next。

## Test plan

- [x] `pnpm --filter @ai-hot-news/ui test` 22/22 pass
- [x] `pnpm typecheck` 0 error
- [x] `pnpm lint` 0 error
- [x] `pnpm --filter @ai-hot-news/web build` success
- [x] dev server `/news` 视觉跟 main 一致（无回归），body 有 radial-gradient 背景

## Spec & Plan

- Spec: `docs/superpowers/specs/2026-05-16-sp8-aurora-visual-system-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-sp8-aurora-visual-system-plan.md`
EOF
)"
```

Expected: PR 创建成功，CI 跑通。

- [ ] **Step 5: Merge PR-A**

PR-A merge 后再开 PR-B 分支。

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
```

---

## PR-B: layout + middleware + 4 mockup 路由

**分支：`feat/sp8-B-routes-mockups`**

**目标：** 重写 `app/layout.tsx` 为 Aurora 框架（持久 Sidebar + aurora-blob + middleware 注入 x-pathname）；新增 4 个 mockup 路由（`/`、`/radar`、`/trends`、`/vault`），全部带 MockupBanner 标识假数据。`/news` 暂不动（PR-C 处理）。

**估算：~1.5 天**

### Task B1: 创建分支 + middleware

**Files:**
- Create: `apps/web/middleware.ts`

- [ ] **Step 1: 创建分支**

```bash
git checkout -b feat/sp8-B-routes-mockups
```

- [ ] **Step 2: 写 `apps/web/middleware.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
```

- [ ] **Step 3: typecheck**

```bash
pnpm --filter @ai-hot-news/web typecheck
```

Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(sp8-B): add middleware to inject x-pathname header for RSC layout"
```

### Task B2: MockupBanner 组件

**Files:**
- Create: `apps/web/app/_components/MockupBanner.tsx`

- [ ] **Step 1: 写 `MockupBanner.tsx`**

```tsx
export interface MockupBannerProps {
  targetSp: string;
}

export function MockupBanner({ targetSp }: MockupBannerProps) {
  return (
    <div className="mb-6 flex items-center gap-2 rounded-md border border-red-300 bg-red-50/80 px-3 py-2 text-xs text-red-700">
      <span className="font-mono font-bold">MOCKUP</span>
      <span>·</span>
      <span>本页数据是静态示例，真实数据待 {targetSp} 接入</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/_components/MockupBanner.tsx
git commit -m "feat(sp8-B): add MockupBanner for placeholder routes"
```

### Task B3: 重写 RootLayout 为 Aurora 框架

**Files:**
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: 整文件覆盖 `apps/web/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { Sidebar } from '@ai-hot-news/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Hot News',
  description: 'AI 圈实时热点 · 跨平台聚合',
};

interface NavLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  'aria-current'?: 'page';
}

const NextLinkAdapter: ComponentType<NavLinkProps> = ({ href, children, className, ...rest }) => (
  <Link href={href} className={className} {...rest}>
    {children}
  </Link>
);

export default async function RootLayout({ children }: { children: ReactNode }) {
  const hdrs = await headers();
  const currentPath = hdrs.get('x-pathname') ?? '/';

  return (
    <html lang="zh-CN">
      <body>
        <div className="aurora-blob ab-1" aria-hidden="true" />
        <div className="aurora-blob ab-2" aria-hidden="true" />
        <div className="aurora-blob ab-3" aria-hidden="true" />
        <div className="relative z-10 flex min-h-screen">
          <Sidebar currentPath={currentPath} LinkComponent={NextLinkAdapter} />
          <main className="flex-1 px-6 py-8 md:px-10 md:py-12">
            <div className="max-w-6xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @ai-hot-news/web typecheck
```

Expected: 0 error。

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat(sp8-B): rewrite RootLayout with persistent Sidebar + aurora-blob + x-pathname"
```

### Task B4: HomePage mockup（/）

**Files:**
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: 整文件覆盖 `apps/web/app/page.tsx`**

```tsx
import Link from 'next/link';
import { Glass, PageHeader } from '@ai-hot-news/ui';
import { MockupBanner } from './_components/MockupBanner';

export default function HomePage() {
  return (
    <>
      <MockupBanner targetSp="SP-8 V1（HomePage 真数据接入留给 V2）" />
      <PageHeader
        title="Aurora"
        subtitle="AI 圈热点聚合 · 实时雷达 · 趋势观察"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 fade-up">
        <Glass variant="hover" as="article">
          <Link href="/news" className="block p-6">
            <div className="text-aurora text-sm font-medium mb-2">News</div>
            <div className="text-2xl font-light tracking-tight text-ink mb-2">
              热点列表
            </div>
            <p className="text-sm text-ink-2">
              HN / Reddit / RSS 跨平台合并 · 24h 滚动 · heatScore 排序
            </p>
          </Link>
        </Glass>
        <Glass variant="hover" as="article">
          <Link href="/radar" className="block p-6">
            <div className="text-aurora text-sm font-medium mb-2">Radar</div>
            <div className="text-2xl font-light tracking-tight text-ink mb-2">
              新冒头雷达
            </div>
            <p className="text-sm text-ink-2">
              抓取&lt;3h 的新议题 · 跨平台首发追踪 · Mockup
            </p>
          </Link>
        </Glass>
        <Glass variant="hover" as="article">
          <Link href="/trends" className="block p-6">
            <div className="text-aurora text-sm font-medium mb-2">Trends</div>
            <div className="text-2xl font-light tracking-tight text-ink mb-2">
              趋势观察
            </div>
            <p className="text-sm text-ink-2">
              7d / 30d 关键词热度曲线 · aiTags 维度切片 · Mockup
            </p>
          </Link>
        </Glass>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(sp8-B): rewrite / as Aurora HomePage mockup with 3 entry cards"
```

### Task B5: /radar mockup

**Files:**
- Create: `apps/web/app/radar/page.tsx`

- [ ] **Step 1: 写 `radar/page.tsx`**

```tsx
import { Glass, PageHeader, Pill, Tag } from '@ai-hot-news/ui';
import { MockupBanner } from '../_components/MockupBanner';

const MOCK_RADAR_ITEMS = [
  {
    id: 'r1',
    title: 'Anthropic releases Claude Sonnet 4.7 with extended thinking on by default',
    titleZh: 'Anthropic 发布 Claude Sonnet 4.7 默认启用扩展思考',
    platform: 'HACKERNEWS' as const,
    age: '47m',
    tags: ['model:Claude', 'company:Anthropic'],
  },
  {
    id: 'r2',
    title: 'Show HN: A local-first vector DB written in Rust',
    titleZh: 'Show HN：用 Rust 写的本地优先向量数据库',
    platform: 'HACKERNEWS' as const,
    age: '1h 12m',
    tags: ['lib:Rust', 'topic:VectorDB'],
  },
  {
    id: 'r3',
    title: 'r/MachineLearning: GPT-5 system card leaked screenshots',
    titleZh: 'r/MachineLearning：GPT-5 system card 截图疑似泄露',
    platform: 'REDDIT' as const,
    age: '2h 5m',
    tags: ['model:GPT-5', 'topic:Safety'],
  },
];

export default function RadarPage() {
  return (
    <>
      <MockupBanner targetSp="SP-9（Radar 真实数据接入）" />
      <PageHeader
        title="Radar"
        subtitle="抓取 < 3h 的新冒头议题 · 跨平台首发追踪"
      />
      <div className="space-y-3 fade-up">
        {MOCK_RADAR_ITEMS.map((item) => (
          <Glass key={item.id} variant="hover" as="article">
            <div className="p-5">
              <div className="flex items-center gap-2 mb-2 text-xs text-ink-3">
                <Pill platform={item.platform} />
                <span className="text-aurora font-mono font-medium">{item.age}</span>
                <span className="blink">·</span>
                <span>new</span>
              </div>
              <h3 className="text-base font-medium text-ink mb-1">
                {item.titleZh ?? item.title}
              </h3>
              {item.titleZh && (
                <p className="text-xs text-ink-3 mb-3">{item.title}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>
          </Glass>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/radar/page.tsx
git commit -m "feat(sp8-B): add /radar mockup with hard-coded items"
```

### Task B6: /trends mockup

**Files:**
- Create: `apps/web/app/trends/page.tsx`

- [ ] **Step 1: 写 `trends/page.tsx`**

```tsx
import { Glass, PageHeader, Tag } from '@ai-hot-news/ui';
import { MockupBanner } from '../_components/MockupBanner';

const MOCK_TRENDS = [
  { tag: 'model:Claude',     count: 47, delta: '+18', cls: 'w-[88%]' },
  { tag: 'model:GPT-5',      count: 39, delta: '+22', cls: 'w-[78%]' },
  { tag: 'company:OpenAI',   count: 35, delta: '+5',  cls: 'w-[70%]' },
  { tag: 'topic:Agent',      count: 28, delta: '+11', cls: 'w-[58%]' },
  { tag: 'lib:LangChain',    count: 19, delta: '-3',  cls: 'w-[42%]' },
  { tag: 'topic:Eval',       count: 14, delta: '+7',  cls: 'w-[32%]' },
];

export default function TrendsPage() {
  return (
    <>
      <MockupBanner targetSp="SP-12（aiTags 时间序列聚合）" />
      <PageHeader
        title="Trends"
        subtitle="7d aiTags 热度排行 · delta = 相比前 7d"
      />
      <Glass>
        <div className="p-6 fade-up">
          <ul className="space-y-4">
            {MOCK_TRENDS.map((row) => (
              <li key={row.tag}>
                <div className="flex items-center justify-between mb-1.5">
                  <Tag>{row.tag}</Tag>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-ink-2">{row.count}</span>
                    <span className={row.delta.startsWith('-') ? 'text-ink-3' : 'text-aurora'}>
                      {row.delta}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-ink/[0.04] rounded-full overflow-hidden">
                  <div className={`h-full bg-aurora rounded-full fill-bar ${row.cls}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Glass>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/trends/page.tsx
git commit -m "feat(sp8-B): add /trends mockup with aiTags hot list"
```

### Task B7: /vault mockup

**Files:**
- Create: `apps/web/app/vault/page.tsx`

- [ ] **Step 1: 写 `vault/page.tsx`**

```tsx
import { Glass, PageHeader, Tag } from '@ai-hot-news/ui';
import { MockupBanner } from '../_components/MockupBanner';

const MOCK_VAULT = [
  {
    id: 'v1',
    title: '为什么大模型 RAG 在生产环境表现总不如预期',
    summary: '从 chunk 策略 / embedding 选型 / rerank 三个维度盘点常见坑，附 6 个开源 baseline 对比。',
    savedAt: '2026-05-12',
    tags: ['topic:RAG', 'topic:Eval'],
  },
  {
    id: 'v2',
    title: 'Cursor 0.50 内置 AI 安全审查的工程拆解',
    summary: '从 prompt injection 防御到 tool call 沙箱化，3 层架构的工程取舍记录。',
    savedAt: '2026-05-08',
    tags: ['product:Cursor', 'topic:Safety'],
  },
];

export default function VaultPage() {
  return (
    <>
      <MockupBanner targetSp="SP-15（用户收藏 & 笔记）" />
      <PageHeader
        title="Vault"
        subtitle="收藏 · 笔记 · 私人知识库"
      />
      <div className="space-y-3 fade-up">
        {MOCK_VAULT.map((item) => (
          <Glass key={item.id} variant="hover" as="article">
            <div className="p-6">
              <div className="text-xs text-ink-3 font-mono mb-2">{item.savedAt}</div>
              <h3 className="text-lg font-medium text-ink mb-2">{item.title}</h3>
              <p className="text-sm text-ink-2 mb-3 leading-relaxed">{item.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>
          </Glass>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/vault/page.tsx
git commit -m "feat(sp8-B): add /vault mockup with hard-coded saved items"
```

### Task B8: 全栈验证 + PR

- [ ] **Step 1: 全仓 lint + typecheck + test**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: 全绿。

- [ ] **Step 2: 启动 dev server 人肉看 5 路由**

```bash
pnpm --filter @ai-hot-news/web dev
```

Expected:
- `/` 渲染 Aurora HomePage（3 个入口卡片 + MockupBanner），Sidebar 高亮 Home
- `/radar` 渲染 3 条 mock 雷达项 + MockupBanner，Sidebar 高亮 Radar
- `/trends` 渲染 6 条 aiTags 热度条 + MockupBanner，Sidebar 高亮 Trends
- `/vault` 渲染 2 条收藏 mock + MockupBanner，Sidebar 高亮 Vault
- `/news` 仍是旧灰白页面（PR-C 才升级），但顶部 Sidebar 已经是 Aurora 框架，Sidebar 高亮 News
- 切换页面 Sidebar persistent（不重新挂载）
- 4 个 mockup 路由都有红色 MockupBanner

按 `Ctrl-C` 停 dev。

- [ ] **Step 3: web build 通过**

```bash
pnpm --filter @ai-hot-news/web build
```

Expected: build success，5 个路由都被 next 静态收集到。

- [ ] **Step 4: 推送 + 开 PR**

```bash
git push -u origin feat/sp8-B-routes-mockups
gh pr create --title "feat(sp8-B): persistent layout + 4 mockup routes (HomePage/Radar/Trends/Vault)" --body "$(cat <<'EOF'
## Summary

SP-8 PR-B：建立 Aurora 路由框架。

- 新建 `middleware.ts` 注入 `x-pathname` header，layout.tsx 用它高亮当前 Sidebar 项
- 重写 `layout.tsx` 为持久 Sidebar + aurora-blob + main 区
- 新建 4 个路由：`/`、`/radar`、`/trends`、`/vault`，全部带 MockupBanner 标识假数据
- `/news` 暂不动（PR-C 处理）

## Test plan

- [x] `pnpm lint && pnpm typecheck && pnpm test` 全绿
- [x] dev server 5 路由都能渲染
- [x] Sidebar 在 5 个路由间 persistent，aria-current 正确切换
- [x] 4 个 mockup 路由都有红色 MockupBanner
- [x] `/news` 仍跟 main 视觉一致（仅 Sidebar 升级，卡片仍灰白）
- [x] `pnpm --filter @ai-hot-news/web build` success

## Spec & Plan

- Spec: `docs/superpowers/specs/2026-05-16-sp8-aurora-visual-system-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-sp8-aurora-visual-system-plan.md`
EOF
)"
```

- [ ] **Step 5: Merge PR-B**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
```

---

## PR-C: /news Aurora 化（保留 SP-7 全部行为）

**分支：`feat/sp8-C-news-aurora-skin`**

**目标：** 把 `/news` 路由的 4 个组件（page.tsx / news-item.tsx / feed-tabs.tsx / list-header.tsx）从灰白默认配色升级到 Aurora 视觉，**严格保留**：

- `fetchHotNewsList` 数据流不动
- FeedTabs `?tab=community|media` 路由参数行为不动
- NewsItem `formatByline` / `formatCrossPlatformBadge` / `<details>` 折叠不动
- titleZh fallback / crossPlatformBadge tooltip 不动
- byline 区单独渲染 `r/<sub>` 不并入 Pill（SP-7-E 契约）

新增：

- 卡片左侧 `<HeatBadge>` 接 SP-6 真实 heatScore/heatLevel 数据
- aiTags 用 `<Tag>` 渲染（之前没渲染过）
- 顶部加 `<PageHeader>`

**估算：~1.5 天**

### Task C1: 创建分支

- [ ] **Step 1: 创建分支**

```bash
git checkout -b feat/sp8-C-news-aurora-skin
```

### Task C2: 升级 FeedTabs 配色

**Files:**
- Modify: `apps/web/app/news/_components/feed-tabs.tsx`

- [ ] **Step 1: 重写 `feed-tabs.tsx`**

```tsx
import Link from 'next/link';

export type FeedTab = 'community' | 'media';

const TABS: Array<{ key: FeedTab; label: string }> = [
  { key: 'community', label: '社区热点 · 48h' },
  { key: 'media', label: '权威媒体 · 7d' },
];

export function parseTab(raw: string | undefined): FeedTab {
  return raw === 'media' ? 'media' : 'community';
}

export function FeedTabs({ active }: { active: FeedTab }) {
  return (
    <nav className="mb-6 flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/news?tab=${t.key}`}
            className={
              'border-b-2 px-4 py-2.5 text-sm transition-colors ' +
              (isActive
                ? 'border-aurora font-medium text-aurora'
                : 'border-transparent text-ink-2 hover:text-ink')
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/news/_components/feed-tabs.tsx
git commit -m "feat(sp8-C): refresh FeedTabs to Aurora palette (logic unchanged)"
```

### Task C3: 升级 ListHeader 为 glass-soft

**Files:**
- Modify: `apps/web/app/news/_components/list-header.tsx`

- [ ] **Step 1: 重写 `list-header.tsx`**

```tsx
import { Glass } from '@ai-hot-news/ui';
import { LocalTime } from './local-time';

export function ListHeader({
  total,
  latestCrawledAt,
}: {
  total: number;
  latestCrawledAt: string | undefined;
}) {
  return (
    <Glass variant="soft">
      <div className="px-4 py-3 text-sm text-ink-2">
        共 <span className="font-semibold text-ink">{total}</span> 条 · 最近抓取于{' '}
        {latestCrawledAt ? <LocalTime iso={latestCrawledAt} /> : '尚无数据'}
      </div>
    </Glass>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/news/_components/list-header.tsx
git commit -m "feat(sp8-C): wrap ListHeader in Glass soft variant"
```

### Task C4: 升级 EmptyState / ErrorState 配色

**Files:**
- Modify: `apps/web/app/news/_components/empty-state.tsx`
- Modify: `apps/web/app/news/_components/error-state.tsx`

- [ ] **Step 1: 看现状**

```bash
cat apps/web/app/news/_components/empty-state.tsx apps/web/app/news/_components/error-state.tsx
```

- [ ] **Step 2: 重写 `empty-state.tsx`**（保留 props 不变，只改 className）

```tsx
import { Glass } from '@ai-hot-news/ui';

export function EmptyState() {
  return (
    <Glass variant="soft">
      <div className="px-6 py-12 text-center">
        <div className="text-base text-ink-2 mb-2">还没有数据</div>
        <p className="text-xs text-ink-3">
          worker 正在抓取，稍后刷新看看
        </p>
      </div>
    </Glass>
  );
}
```

- [ ] **Step 3: 重写 `error-state.tsx`**

```tsx
import { Glass } from '@ai-hot-news/ui';

export function ErrorState({ message }: { message: string }) {
  return (
    <Glass variant="soft">
      <div className="px-6 py-8">
        <div className="text-sm font-medium text-red-700 mb-1">加载失败</div>
        <p className="text-xs text-ink-2 break-all">{message}</p>
      </div>
    </Glass>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/news/_components/empty-state.tsx apps/web/app/news/_components/error-state.tsx
git commit -m "feat(sp8-C): refresh EmptyState/ErrorState to Aurora glass surfaces"
```

### Task C5: 重写 NewsItem 卡片为 Aurora（保留 SP-7 行为）

**Files:**
- Modify: `apps/web/app/news/_components/news-item.tsx`

- [ ] **Step 1: 整文件覆盖 `news-item.tsx`**

```tsx
import type { HotNewsListItemDto } from '@ai-hot-news/types';
import { Glass, HeatBadge, Pill, Tag } from '@ai-hot-news/ui';
import { LocalTime } from './local-time';

const PLATFORM_LABEL: Record<string, string> = {
  RSS: 'RSS',
  HACKERNEWS: 'HN',
  REDDIT: 'Reddit',
  TWITTER: 'X',
};

/** Build the cross-platform badge label, e.g. "🔗 12 篇 · Reddit 10 / HN 2".
 *  Falls back to "🔗 N 篇" when only one platform contributed (this can happen
 *  when SP-7 grouped multiple posts from the same platform — most often Reddit
 *  cross-subreddit reposts). Returns null when there's nothing to render
 *  (singleton / size <= 1). */
function formatCrossPlatformBadge(
  groupSize: number,
  groupPlatforms: Partial<Record<string, number>>,
): string | null {
  if (groupSize <= 1) return null;
  const entries = Object.entries(groupPlatforms)
    .filter((kv): kv is [string, number] => typeof kv[1] === 'number' && kv[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length <= 1) {
    return `🔗 ${groupSize} 篇相关报道`;
  }
  const breakdown = entries
    .map(([p, n]) => `${PLATFORM_LABEL[p] ?? p} ${n}`)
    .join(' / ');
  return `🔗 ${groupSize} 篇 · ${breakdown}`;
}

/** SP-7-E (2026-05-16): build the "byline" prefix shown before the
 *  platform badge. For Reddit rows we surface `r/<sub>` instead of the
 *  Reddit username — the user is browsing by sub value, not by user.
 *  HN / RSS / X behavior is unchanged. */
function formatByline(
  platform: string,
  author: string | null,
  subreddit: string | null,
): string {
  if (platform === 'REDDIT' && subreddit) return `r/${subreddit}`;
  return author ?? '匿名';
}

export function NewsItem({ item }: { item: HotNewsListItemDto }) {
  const displayTitle = item.titleZh ?? item.title;
  const tooltip = item.titleZh && item.titleZh !== item.title ? item.title : undefined;
  const crossPlatformBadge = formatCrossPlatformBadge(item.groupSize, item.groupPlatforms);
  const hasMembers = item.groupMembers.length > 0;
  const byline = formatByline(item.sourcePlatform, item.author, item.subreddit);

  return (
    <Glass variant="hover" as="article">
      <div className="p-5 flex gap-4">
        <div className="flex-shrink-0 pt-0.5">
          <HeatBadge score={item.heatScore} level={item.heatLevel} />
        </div>
        <div className="flex-1 min-w-0">
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={tooltip}
            className="block text-base font-medium text-ink hover:text-aurora transition-colors"
          >
            {displayTitle}
          </a>
          {item.summary ? (
            <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-2 line-clamp-2">
              {item.summary}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <span
              className={
                item.sourcePlatform === 'REDDIT' && item.subreddit
                  ? 'font-medium text-aurora'
                  : ''
              }
              title={
                item.sourcePlatform === 'REDDIT' && item.author
                  ? `posted by ${item.author}`
                  : undefined
              }
            >
              {byline}
            </span>
            <span>·</span>
            <Pill platform={item.sourcePlatform} />
            <span>·</span>
            <LocalTime iso={item.publishedAt} />
            {crossPlatformBadge ? (
              <>
                <span>·</span>
                <span
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium bg-aurora-soft text-aurora"
                  title="同一事件在多个来源被同时报道（基于 SP-7 跨平台聚类）"
                >
                  {crossPlatformBadge}
                </span>
              </>
            ) : null}
          </div>
          {item.aiTags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.aiTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          ) : null}
          {hasMembers ? (
            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs text-aurora hover:opacity-80 select-none list-none flex items-center gap-1">
                <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                <span>查看同组其它 {item.groupMembers.length} 篇</span>
              </summary>
              <ul className="mt-2 ml-4 space-y-2 border-l border-aurora-soft pl-3">
                {item.groupMembers.map((m) => {
                  const mTitle = m.titleZh ?? m.title;
                  const mTooltip = m.titleZh && m.titleZh !== m.title ? m.title : undefined;
                  const mByline = formatByline(m.sourcePlatform, m.author, m.subreddit);
                  return (
                    <li key={m.id} className="text-xs">
                      <a
                        href={m.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={mTooltip}
                        className="text-ink-2 hover:text-aurora transition-colors"
                      >
                        {mTitle}
                      </a>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
                        <span
                          className={
                            m.sourcePlatform === 'REDDIT' && m.subreddit
                              ? 'font-medium text-aurora'
                              : ''
                          }
                          title={
                            m.sourcePlatform === 'REDDIT' && m.author
                              ? `posted by ${m.author}`
                              : undefined
                          }
                        >
                          {mByline}
                        </span>
                        <span>·</span>
                        <Pill platform={m.sourcePlatform} />
                        <span>·</span>
                        <LocalTime iso={m.publishedAt} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </Glass>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @ai-hot-news/web typecheck
```

Expected: 0 error。

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/news/_components/news-item.tsx
git commit -m "feat(sp8-C): rewrite NewsItem as Glass+HeatBadge+Pill+Tag (SP-7 behaviors preserved)"
```

### Task C6: 升级 /news page.tsx — PageHeader + 列表布局

**Files:**
- Modify: `apps/web/app/news/page.tsx`

- [ ] **Step 1: 整文件覆盖 `apps/web/app/news/page.tsx`**

```tsx
import { PageHeader } from '@ai-hot-news/ui';
import { fetchHotNewsList, type FeedPlatform } from '@/lib/api';
import { ListHeader } from './_components/list-header';
import { NewsItem } from './_components/news-item';
import { Pagination } from './_components/pagination';
import { EmptyState } from './_components/empty-state';
import { ErrorState } from './_components/error-state';
import { FeedTabs, parseTab, type FeedTab } from './_components/feed-tabs';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string; tab?: string }>;
}

const TAB_PLATFORMS: Record<FeedTab, FeedPlatform[]> = {
  community: ['HACKERNEWS', 'REDDIT'],
  media: ['RSS'],
};

export default async function NewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const parsed = parseInt(sp.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const pageSize = 20;
  const tab = parseTab(sp.tab);
  const platforms = TAB_PLATFORMS[tab];

  let data;
  let errorMessage: string | null = null;
  try {
    data = await fetchHotNewsList(page, pageSize, platforms);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Unknown error';
  }

  return (
    <>
      <PageHeader
        title="News"
        subtitle="HN / Reddit / RSS 跨平台聚合 · SP-6 heatScore 排序"
      />
      <FeedTabs active={tab} />
      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : data && data.items.length === 0 ? (
        <EmptyState />
      ) : data ? (
        <>
          <ListHeader total={data.total} latestCrawledAt={data.items[0]?.crawledAt} />
          <div className="mt-4 space-y-3 fade-up">
            {data.items.map((item) => (
              <NewsItem key={item.id} item={item} />
            ))}
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} tab={tab} />
        </>
      ) : null}
    </>
  );
}
```

注意：
- 移除了原 `<main className="mx-auto max-w-3xl p-6">` 包装 — RootLayout 已经提供 main + max-width
- 列表从 `<ul>...divide-y</ul>` 改为 `<div className="space-y-3">` — Glass 卡片已经有自己的 border-radius，不需要 divide
- 加了 `fade-up` 入场动画

- [ ] **Step 2: 升级 Pagination 配色（如果需要）**

```bash
cat apps/web/app/news/_components/pagination.tsx
```

如果 Pagination 用的是 `text-blue-*` / `border-gray-*` 等老配色，把它改成 `text-aurora` / `border-line`。如果它已经是 ink 中性色，跳过这一步。

- [ ] **Step 3: typecheck + lint**

```bash
pnpm --filter @ai-hot-news/web typecheck
pnpm --filter @ai-hot-news/web lint
```

Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/news/page.tsx
git commit -m "feat(sp8-C): wrap /news with PageHeader, switch list layout to Glass cards"
```

### Task C7: 全栈 dev 人肉 smoke

- [ ] **Step 1: 启动 dev**

```bash
pnpm --filter @ai-hot-news/web dev
```

- [ ] **Step 2: 浏览器打开 `http://localhost:3000/news` 验收 checklist**

| 检查项 | 期望 |
|---|---|
| 顶部 `News` PageHeader 显示 | ✓ |
| FeedTabs 两个 tab，Community 默认激活（aurora 紫色下划线） | ✓ |
| ListHeader 显示「共 N 条 · 最近抓取于 ...」(glass-soft 卡) | ✓ |
| 卡片左侧有圆形 HeatBadge 显示 heatScore（BURST 有 pulse-ring 动画） | ✓ |
| Pill 平台标签：HN/Reddit/RSS/X 颜色分别是中性/aurora-soft/灰 ink/aurora-soft | ✓ |
| Reddit 行 byline 区显示 `r/<sub>`（aurora 紫色字），Pill 仍显示 `Reddit` | ✓ |
| 跨平台 badge `🔗 N 篇 · Reddit 10 / HN 2` 显示在时间右侧 | ✓ |
| aiTags 渲染为紫色 Tag chip 在 byline 行下方 | ✓ |
| `<details>` 折叠 `查看同组其它 N 篇` 可展开 | ✓ |
| 切到 Community / Media tab，列表正常切换 | ✓ |
| Pagination 翻页正常 | ✓ |
| 卡片 hover 有 -2px 上浮 + aurora 边框 | ✓ |
| 切到 `/`、`/radar`、`/trends`、`/vault`，Sidebar 高亮切换正确 | ✓ |
| Console 无 error / warning | ✓ |

按 `Ctrl-C` 停 dev。

- [ ] **Step 3: 跑全仓 lint + typecheck + test**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: 全绿。

- [ ] **Step 4: web build 通过**

```bash
pnpm --filter @ai-hot-news/web build
```

Expected: build success。

- [ ] **Step 5: 推送 + 开 PR**

```bash
git push -u origin feat/sp8-C-news-aurora-skin
gh pr create --title "feat(sp8-C): /news Aurora skin (HeatBadge/Pill/Tag wired, SP-7 behaviors preserved)" --body "$(cat <<'EOF'
## Summary

SP-8 PR-C：把 `/news` 路由的 4 个组件从灰白默认配色升级到 Aurora，**严格保留 SP-7 全部行为**。

新增可视化：

- 卡片左侧圆形 `HeatBadge` 接 SP-6 真实 heatScore/heatLevel 数据（首次 UI 展示）
- BURST 行有 pulse-ring 动画
- aiTags 用 Tag chip 渲染（之前没渲染过）
- 顶部 PageHeader 标题 / 副标题
- 卡片 hover 上浮 + aurora 边框

保留不动：

- `fetchHotNewsList` 数据流不动
- FeedTabs `?tab=community|media` 路由参数行为不动
- NewsItem `formatByline` / `formatCrossPlatformBadge` / `<details>` 折叠不动
- titleZh fallback / crossPlatformBadge tooltip 不动
- byline 区单独渲染 `r/<sub>` 不并入 Pill（SP-7-E 契约）

## Test plan

- [x] dev `/news` 完整 visual smoke checklist 全过（见 plan §C7 Step 2 表格）
- [x] `/`、`/radar`、`/trends`、`/vault` 仍正常（PR-B 行为不回归）
- [x] `pnpm lint && pnpm typecheck && pnpm test` 全绿
- [x] `pnpm --filter @ai-hot-news/web build` success

## Spec & Plan

- Spec: `docs/superpowers/specs/2026-05-16-sp8-aurora-visual-system-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-sp8-aurora-visual-system-plan.md`
EOF
)"
```

- [ ] **Step 6: Merge PR-C**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
```

PR-C merge 即 SP-8 V1 完成。

---

## SP-8 完工 checklist

- [ ] PR-A `feat/sp8-A-ui-tokens` merged + Deploy success
- [ ] PR-B `feat/sp8-B-routes-mockups` merged + Deploy success
- [ ] PR-C `feat/sp8-C-news-aurora-skin` merged + Deploy success
- [ ] Production `/news` Aurora 效果验证（`https://<domain>/news` 看到 HeatBadge / Pill / Tag）
- [ ] Production `/`、`/radar`、`/trends`、`/vault` mockup 都有 MockupBanner
- [ ] `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` 把 SP-8 状态从 in-progress 改为 completed（独立小 PR）

---

## Self-Review

按 writing-plans skill 自查：

**1. Spec coverage 核查（spec §1 In-scope 6 项）：**

| Spec 要求 | Plan 任务 |
|---|---|
| Aurora token / aurora-blob / glass / animations | A10（globals.css）+ A11（tailwind.config）|
| packages/ui 6 atoms | A2-A8（每个 atom 一个 task）+ A9（index 导出）|
| 5 路由 + persistent Sidebar + middleware | B1（middleware）+ B3（layout）+ B4-B7（4 mockup）+ C6（/news 加 PageHeader）|
| /news 接 SP-6 heatScore + 保留 SP-7 行为 | C5（NewsItem 重写，保留 formatByline/formatCrossPlatformBadge/details）+ C6（page）|
| MockupBanner 标识假数据 | B2（组件）+ B4-B7（4 处使用）|
| 22 单测 | A2(3)+A3(3)+A4(4)+A5(5)+A6(2)+A7(3)+A8(3) = 23 测试（spec 写 22 是粗略数字，多一个不算偏差）|

**2. Placeholder 扫描：** 整 plan 0 处 TBD/TODO/「按需补」/「类似 X」。每个有 code block 的 step 都给了完整 code。

**3. 类型一致性：** Pill 用的 `Platform` 类型在 Pill.spec 测了 4 个值（HN/Reddit/RSS/Twitter），HeatBadge 用的 `HeatLevel` 测了 4 levels（BURST/HOT/NORMAL/LOW + null），Sidebar 的 `LinkComponent` 在测试里用 `<a>` 适配，layout.tsx 用 `Link` 适配。types match spec §3。

**4. 契约约束都在 pre-flight 列了：** packages/ui 零 next 依赖、Pill 不接 subreddit、/news 数据流不动、mockup 必带 banner、3 PR 顺序部署 — 5 项都在 pre-flight「契约约束」段，且 PR-C Task C5 / Task B2-B7 / B3 都贯彻了。

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-05-16-sp8-aurora-visual-system-plan.md`. 两种执行选项：**

**1. Subagent-Driven（推荐）** — 每 task 派一个 fresh subagent，我在 task 之间 review，迭代快

**2. Inline Execution** — 在当前会话内顺序执行 task，按 PR 边界做 checkpoint review

**用哪种？**
