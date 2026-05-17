# SP-8 — Aurora 视觉系统 + App 骨架

- 状态：spec 待用户审阅
- 依赖：
  - SP-1（RSS 端到端）—— `apps/web/app/news` 当前灰白 Tailwind 样式由 SP-1 落地，本 SP 替换为 Aurora 卡片
  - SP-5 v3.4（titleZh + summary）—— `/news` 卡片渲染 `titleZh ?? title` 主显示
  - SP-5 titleZh-cjk-guard（PR #23, 2026-05-16）—— 19 条假翻译已清，UI 走干净 fallback
  - SP-6（heatScore + heatLevel）—— `HeatBadge` atom 首次渲染该数据（Aurora 之前 SP-6 数据已入库但 UI 不显示）
  - SP-7-B/C/D/E（groupId/groupSize + 折叠 + per-source breakdown + subreddit）—— `/news` 换肤时这些 UI 行为必须 1:1 保留
  - 一次性脚本范式（SP-4 §10 决策 11）—— 本 SP 不需要新建脚本
- **本文件**：`docs/superpowers/specs/2026-05-16-sp8-aurora-visual-system-design.md`
- **预计工作量**：~5 天（PR-A ~2d / PR-B ~2d / PR-C ~1d）
- **拆分**：3 个 PR（基础 → 应用 → 换肤）
- **PR-driven workflow**：与 SP-4.7 / SP-5 / SP-6 / SP-7 一致，每 PR 独立 review/deploy/回滚

---

## 0. 关键设计决策（已在 brainstorming 阶段拍板）

| #  | 维度 | 选择 | 理由 |
|----|----|----|----|
| Q1 | V1 范围边界 | **B：壳子 + /news 换肤** | A（严格壳子）会让 SP-8 完成后 /news 灰白与其他 Aurora 严重违和；C（含完整 HomePage 真数据）依赖 SP-9 stats API 越界 |
| Q2 | 视觉保真度 | **A 高保真复刻 + 系统字体替换 Inter Tight** | 完整保留米色 + aurora-blob 漂浮 + glass blur(20px) + drift/pulse-ring/blink/fadeUp 全套动画；用 `-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif` 替换 Google Font 省 +200KB / LCP |
| Q3 | PR 拆分 | **Z 三 PR**（tokens+ui → 路由壳子 → /news 换肤）| 与 SP-6 / SP-7 PR-driven workflow 一致；PR-A merge 后 ui 包暂时无消费者是合法 stage 状态（与 SP-7-A 同款）|
| Q4 | packages/ui 抽离粒度 | **Q：V1 真用 5 atoms + Glass wrapper（共 6 个）** | YAGNI；`MiniSpark / HeatCurve / Filter / Radar` 推到对应 SP（SP-9/10/15）启动时一起 brainstorm；HeatBadge 必抽以让 SP-6 入库的 heatScore 数据首次被 UI 消费 |
| Q5 | 路由 placeholder 内容 | **β：静态 mockup（Aurora HTML 假数据）+ 顶部红 banner** | α 空 placeholder 错失视觉系统在多页面验证一致性的机会；γ HomePage 接真热度榜会需要 stats API 配合，违反 SP-9 边界 |
| Q6 | 移动端策略 | **a：desktop-only，无 responsive 断点** | PRD 写明"个人自用"，桌面是主战场；Aurora 设计稿无移动端版本，做 b/c 等于现场出方案；真要时单独开 SP |
| Q7 | titleZh 偷懒清理 | **ii：独立 hotfix PR 先于 SP-8 PR-A**（已完成 PR #23）| 边界原则：titleZh 是 SP-5 摘要管线产物，不归 SP-8；SP-8 PR-A 启动时已有干净底座 |
| Q8 | 根路由 `/` 处理 | **ii：换 Aurora HomePage mockup（非 redirect 也非 placeholder）** | 与 Q5=β 一致：5 个路由全用 Aurora 静态 mockup，没理由 `/` 单独例外；未来 SP-9 落地时只需替换数据来源 |

---

## 1. 目标与硬验收标准

### 1.1 目标

让 `apps/web` 从 SP-1 灰白 Tailwind 默认样式升级到 Aurora 视觉系统，**5 个核心路由全部上线**，其中 `/news` 接真数据、其余 4 个用 hard-code mock data + MockupBanner 示意"待 SP-X 接入真数据"。建立 `packages/ui` 共享组件包供 SP-9~12 复用。

```
http://hotnews.shinpeionline.top/         → Aurora HomePage mockup（4 stats 卡 + 假热度榜 + 假 24h 曲线）
http://hotnews.shinpeionline.top/news     → Aurora FeedPage（真数据，HeatBadge 首次渲染 SP-6 数据）
http://hotnews.shinpeionline.top/radar    → Aurora RadarPage mockup（占位）
http://hotnews.shinpeionline.top/trends   → Aurora TrendsPage mockup（占位）
http://hotnews.shinpeionline.top/vault    → Aurora VaultPage mockup（占位）
```

### 1.2 In-scope

| 模块 | 新增/改动 |
|----|--------|
| `packages/ui/`（新建 workspace 包）| `atoms/{Glass,Pill,HeatBadge,Tag,PageHeader,Sidebar}.tsx` + `atoms/*.spec.tsx` + `tokens.ts` + `index.ts` + `package.json` + `tsconfig.json` + `vitest.config.ts` |
| `pnpm-workspace.yaml` | 加 `packages/ui` |
| `apps/web/package.json` | 加 `@ai-hot-news/ui: workspace:*` 依赖 |
| `apps/web/app/globals.css` | 重写：tokens（CSS 变量）+ aurora-blob 全局背景 + 3 keyframes（drift1/drift2/drift3）+ fadeUp/pulse-ring 动画 |
| `apps/web/app/layout.tsx` | 加 `<aside>` Sidebar（持久化 left rail，在所有路由可见）+ 3 个 `.aurora-blob` div + `<main>` 主区 wrapper |
| `apps/web/app/page.tsx` | / 改为 Aurora HomePage mockup（4 stats 卡 + 热度榜 + 24h 曲线 SVG + 信源分布 + 我的提醒）+ MockupBanner |
| `apps/web/app/news/page.tsx` | 保留现有 fetchHotNewsList + feed-tabs 数据流 0 改动；卡片样式改 Aurora |
| `apps/web/app/news/_components/news-item.tsx` | 改用 packages/ui 的 Glass/Pill/HeatBadge/Tag；保留现有 SP-7-D 折叠 / SP-7-E subreddit / SP-7-C per-source breakdown 逻辑 |
| `apps/web/app/news/_components/{feed-tabs,list-header,pagination,empty-state,error-state}.tsx` | 改用 PageHeader + Glass 包装 |
| `apps/web/app/{radar,trends,vault}/page.tsx`（新增 3 个）| Aurora HTML 同名页面搬过来 + hard-code mock data + MockupBanner |
| `apps/web/app/_components/MockupBanner.tsx`（新增）| 顶部红色横条"📊 Mockup · 数据为静态示例，将在 SP-X 接入真实数据" |
| `apps/web/tailwind.config.ts` | colors 扩展（aurora 紫色系）+ animation utility（fadeUp / pulseRing）+ fontFamily（系统栈）+ backdropBlur（glass 用）|

### 1.3 Out-of-scope（明确不做）

- ❌ Stats API（`GET /stats/today` / `GET /stats/sources` / `GET /stats/heat-curve` / `GET /stats/trending-keywords`）→ SP-9
- ❌ FeedPage 三层 Filter dropdown 组件 → SP-10
- ❌ Detail 页 `/news/[id]` → SP-11
- ❌ 内容库搜索（PG fts 查询）→ SP-12
- ❌ Radar SVG（极坐标 + requestAnimationFrame 扫描线）→ SP-15
- ❌ Trends 折线 / Recharts → SP-20
- ❌ MiniSpark / HeatCurve / Filter / Radar 抽到 packages/ui → 推迟到对应 SP（YAGNI）
- ❌ 响应式 / 移动端断点 → 待真有需求单独开 SP
- ❌ 暗色模式 → V1 米色单主题
- ❌ Aurora HTML 中的 `useCountUp` 数字滚动动画 → mockup 数字静态，SP-9 接真数据时再加
- ❌ 通知 NotificationCenter → SP-17
- ❌ 用户认证 / 登录 → SP-13

### 1.4 硬验收标准

```bash
# 1. Local 全绿
pnpm turbo run lint typecheck test build
# 25+ 任务全绿；packages/ui 6 atoms 各 1-2 vitest 单测通过；apps/web typecheck 干净

# 2. Local 视觉验证（PR-A merge 后）
# packages/ui 成功 build，dist/ 输出 ESM + .d.ts；任一其他包 import { Glass } from '@ai-hot-news/ui' 通过 typecheck

# 3. Local 视觉验证（PR-B merge 后）
pnpm --filter @ai-hot-news/web dev
# 浏览器逐个访问 http://localhost:3000/{,, news, radar, trends, vault}：
# - / 显示 Aurora HomePage mockup（4 stats 卡 + 热度榜 + ...）+ 顶部红 banner
# - /news 仍是 SP-1 灰白样式（PR-C 才换肤）
# - /radar /trends /vault 显示 Aurora mockup + 顶部红 banner
# - 全部 5 路由共享同一个 Sidebar（持久化 left rail）
# - aurora-blob 在所有页面背景漂浮（drift 动画运行）

# 4. Local 视觉验证（PR-C merge 后）
pnpm --filter @ai-hot-news/web dev
# /news 现在显示 Aurora 卡片 + HeatBadge（接 SP-6 真数据）+ 保留 SP-7 所有功能：
# - groupSize > 1 折叠 + 展开按钮（SP-7-D）
# - Reddit 行显示 r/<subreddit>（SP-7-E）
# - 跨平台 group 显示 per-source breakdown（SP-7-C）

# 5. Prod smoke（3 PR 全部部署后）
curl -sS https://hotnews.shinpeionline.top/ | grep -oE 'class="[^"]*aurora-blob[^"]*"' | head -3
# 输出 3 个 aurora-blob class（验证 layout.tsx 注入）

curl -sS https://hotnews.shinpeionline.top/api/hot-news?platforms=HACKERNEWS,REDDIT&pageSize=5 | jq '.items[0] | {heatScore, heatLevel, titleZh, groupSize}'
# 验证 API 字段未变（DTO 0 改动）

# 6. Prod 视觉 smoke（人肉打开浏览器 5 个路由各看一眼）
# 在 §11 部署 checklist 详列
```

> **不变量**：Aurora 视觉系统改动 0 触及 API DTO / Prisma schema / worker / 数据库 — 纯前端 SP。任何改动如果跨出 `apps/web` + `packages/ui` 两个 boundary，必须升级为子 SP（如真有 stats API 需求 → SP-9）。

---

## 2. 视觉系统设计

### 2.1 设计 token（CSS 变量层）

锚定 Aurora HTML line 14-31 的 `:root` 块（用户已更新为米色单紫主题）：

```css
:root {
  /* 色板：背景 / 墨色 4 档 / 边线 2 档 */
  --bg: #f6f4ef;
  --ink: #14131a;
  --ink-2: #5a5763;
  --ink-3: #9b97a3;
  --ink-4: #d0ccd5;
  --line: rgba(20, 19, 26, 0.06);
  --line-2: rgba(20, 19, 26, 0.10);

  /* 主色：紫色系 + 软变体 */
  --c1: #7e57f5;        /* primary accent */
  --c2: #14131a;        /* 黑色作 secondary */
  --c3: #7e57f5;        /* legacy alias */
  --c4: #5a5763;
  --accent: #7e57f5;
  --accent-soft: rgba(126, 87, 245, 0.10);
  --accent-soft-2: rgba(126, 87, 245, 0.18);
  --grad: #14131a;
  --grad-soft: linear-gradient(135deg, #e9e1ff, #f0e8ff, #f6efff);
}
```

`packages/ui/src/tokens.ts` 暴露同款常量（Tailwind config 会 import 这个文件，避免 CSS 变量名漂移）：

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
```

### 2.2 全局背景（layout 层）

`apps/web/app/globals.css`：

```css
@import 'tailwindcss';

:root { /* tokens above */ }

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

/* aurora-blob 3 个 + drift 动画 */
.aurora-blob { position: fixed; border-radius: 50%; filter: blur(90px); opacity: 0.4; pointer-events: none; z-index: 0; }
.ab-1 { width: 480px; height: 480px; background: #d9ccff; top: -100px; left: 200px; animation: drift1 25s ease-in-out infinite; }
.ab-2 { width: 380px; height: 380px; background: #e8dcff; top: 30%; right: -100px; animation: drift2 30s ease-in-out infinite; }
.ab-3 { width: 420px; height: 420px; background: #ebe3ff; bottom: -100px; left: 30%; animation: drift3 35s ease-in-out infinite; }

@keyframes drift1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(120px, 80px); } }
@keyframes drift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-100px, 100px); } }
@keyframes drift3 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(80px, -80px); } }

/* glass 工具类（tailwind 之外的一次性 utility）*/
.glass {
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.8);
  border-radius: 18px;
  box-shadow: 0 1px 2px rgba(20,19,26,0.03), 0 8px 24px rgba(20,19,26,0.04);
}
.glass-soft {
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.7);
  border-radius: 14px;
}
.glass-hover { transition: transform .3s cubic-bezier(0.2,0.8,0.2,1), box-shadow .3s, border-color .3s; }
.glass-hover:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(20,19,26,0.05), 0 16px 40px rgba(20,19,26,0.08); border-color: rgba(126,87,245,0.25); }

/* 动画 utility */
@keyframes fadeUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
@keyframes pulse-ring { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(2.2); opacity: 0; } }
@keyframes blink { 50% { opacity: 0.3; } }
@keyframes fillBar { from { width: 0; } }

.fade-up { animation: fadeUp .6s cubic-bezier(0.2,0.6,0.2,1) backwards; }
.pulse-ring { position: relative; }
.pulse-ring::after { content:''; position: absolute; inset: 0; border-radius: 50%; background: currentColor; opacity: 0.3; animation: pulse-ring 2s ease-out infinite; }
.blink { animation: blink 2s ease-in-out infinite; }
.fill-bar { animation: fillBar 1.2s cubic-bezier(0.2,0.8,0.2,1) backwards; }
```

### 2.3 Tailwind 配置扩展

`apps/web/tailwind.config.ts`（Tailwind v4 使用 CSS 配置即可，但保留 ts 文件给类型提示）：

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',  // 让 Tailwind 扫 ui 包源码
  ],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#14131a', 2: '#5a5763', 3: '#9b97a3', 4: '#d0ccd5' },
        aurora: { DEFAULT: '#7e57f5', soft: 'rgba(126,87,245,0.10)', soft2: 'rgba(126,87,245,0.18)' },
        line: { DEFAULT: 'rgba(20,19,26,0.06)', 2: 'rgba(20,19,26,0.10)' },
        bg: '#f6f4ef',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Helvetica Neue"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      animation: {
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.2,0.6,0.2,1) backwards',
        'pulse-ring': 'pulse-ring 2s ease-out infinite',
        blink: 'blink 2s ease-in-out infinite',
      },
      backdropBlur: { glass: '20px', soft: '16px' },
      borderRadius: { glass: '18px', 'glass-soft': '14px' },
    },
  },
  plugins: [],
};

export default config;
```

> **Tailwind 版本注**：当前 `globals.css` 用 `@import 'tailwindcss'`（v4 写法）。本 SP 不升降版本；保持 v4 一致。

---

## 3. packages/ui 组件设计（6 个 atom）

### 3.1 Glass — 玻璃卡片包装

最高频的样式 wrapper，封装 backdrop-filter + border + shadow + border-radius，避免散落 5+ 处 hardcode 同款样式。

```tsx
// packages/ui/src/atoms/Glass.tsx
import { type HTMLAttributes, type ReactNode } from 'react';

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
  return (
    <Tag className={`${VARIANT_CLASSNAMES[variant]} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
```

**消费场景**：
- `/news` news-item 卡片 → `<Glass variant="hover" as="article">`
- HomePage stats 卡 → `<Glass variant="card">`
- Sidebar 容器 → `<Glass variant="soft" as="aside">`
- 各 mockup 页面占位区 → `<Glass variant="card">`

**单测**（Glass.spec.tsx）：3 个 case
- `variant="card"` 渲染 className 含 `glass` 不含 `glass-soft`
- `variant="hover"` 渲染 className 含 `glass glass-hover`
- `as="article"` 渲染 `<article>` 标签

### 3.2 Pill — 平台徽章

仅封装 4 个平台 label —— 单一职责。**SP-7-E 的 `r/<sub>` 显示不放在 Pill 里**，仍由 `news-item.tsx` 在 byline 位置单独渲染（保留现状：「r/OpenAI · Reddit · 5h」中 `r/OpenAI` 在 author 位、`Reddit` 在 Pill 位）。

```tsx
// packages/ui/src/atoms/Pill.tsx
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

**消费场景**：
- news-item 行内平台标签（byline 旁）
- 详情页（V2 SP-11）头部
- HomePage 信源分布卡片图例

**单测**（Pill.spec.tsx）：4 cases
- `HACKERNEWS` → 文本 "HN"
- `REDDIT` → "Reddit"
- `RSS` → "RSS"
- `TWITTER` → "X"

> **为什么不把 subreddit 塞进 Pill**：SP-7-E 的 byline `r/<sub>` 在 author 位、Pill 在 platform 位 —— 二者**不同语义维度**（byline 是「这帖谁发的」，Pill 是「这帖来自哪个平台」）。混进一个 atom 会让 Reddit 行只显示 1 个标签丢失「Reddit」品牌识别，且未来 Twitter/X 接入时 author 位的 `@username` 会有相同诉求 —— Pill 里加多个 platform-specific 字段会膨胀。保留 byline 单独渲染逻辑（spec §5.1）。

### 3.3 HeatBadge — 热度分徽章 ⭐ SP-6 数据首次渲染

`HotNewsListItemDto.heatScore: number | null` + `heatLevel: BURST|HOT|NORMAL|LOW|null` 在 SP-6 PR-B 已暴露但 UI 一直没渲染。本 atom 是接通点。

```tsx
// packages/ui/src/atoms/HeatBadge.tsx
type HeatLevel = 'BURST' | 'HOT' | 'NORMAL' | 'LOW';

export interface HeatBadgeProps {
  score: number | null;
  level: HeatLevel | null;
}

const LEVEL_META: Record<HeatLevel, { cls: string; pulse: boolean }> = {
  BURST:  { cls: 'bg-aurora text-white',                pulse: true },   // 紫底白字 + pulse-ring
  HOT:    { cls: 'bg-aurora-soft2 text-aurora',         pulse: false },
  NORMAL: { cls: 'bg-ink/[0.06] text-ink-2',            pulse: false },
  LOW:    { cls: 'bg-ink/[0.04] text-ink-3',            pulse: false },
};

export function HeatBadge({ score, level }: HeatBadgeProps) {
  if (score === null || level === null) return null;  // null 行不渲染（worker 还未处理）
  const meta = LEVEL_META[level];
  const display = Math.round(score);
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-mono font-semibold ${meta.cls} ${meta.pulse ? 'pulse-ring' : ''}`}>
      {display}
    </span>
  );
}
```

**单测**（HeatBadge.spec.tsx）：5 cases
- `score=null, level=null` → 渲染 null
- `BURST` → 含 `pulse-ring` className
- `HOT` → 含 `bg-aurora-soft2` className
- `NORMAL` → 不含 `pulse-ring`
- `score=85.7` → 显示 "86"（rounded）

### 3.4 Tag — aiTags chip

```tsx
// packages/ui/src/atoms/Tag.tsx
import type { ReactNode } from 'react';

export interface TagProps {
  children: ReactNode;
  /** CSS 颜色字符串；默认 var(--c1) 主紫色 */
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

**消费场景**：
- news-item 行内 aiTags 渲染（已 prefix-encoded 如 `model:GPT-5`）
- HomePage "热门标签" 区
- 详情页（V2 SP-11）

**单测**（Tag.spec.tsx）：2 cases
- 默认 color → style 含 `var(--c1)`
- 自定义 color="red" → style 含 `red`

### 3.5 PageHeader — 页头

```tsx
// packages/ui/src/atoms/PageHeader.tsx
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** 顶部小写标记（如 "LIVE FEED"），可选 */
  kicker?: string;
  /** 主标题 */
  title: string;
  /** 副标题 / 描述，可选 */
  sub?: string;
  /** 右侧 action slot（如 sort toggle / refresh 按钮），可选 */
  action?: ReactNode;
}

export function PageHeader({ kicker, title, sub, action }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between mb-6 fade-up">
      <div>
        {kicker && (
          <div className="text-[11px] tracking-widest uppercase text-aurora font-semibold mb-2">
            {kicker}
          </div>
        )}
        <h1 className="text-2xl font-bold text-ink tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-ink-2 mt-1">{sub}</p>}
      </div>
      {action && <div>{action}</div>}
    </header>
  );
}
```

**单测**（PageHeader.spec.tsx）：3 cases
- 仅 title → 渲染 h1，无 kicker / sub / action 节点
- 全字段 → 渲染所有 4 个节点
- action slot 接受 ReactNode

### 3.6 Sidebar — 左侧持久导航

最复杂的一个 atom（包含路由高亮 + 通知徽标 + 5 个固定项 + Logo + 用户区）。

```tsx
// packages/ui/src/atoms/Sidebar.tsx
import type { ReactNode } from 'react';

export interface SidebarProps {
  /** Next.js usePathname() 当前路径，用于 active 高亮 */
  currentPath: string;
  /** Sidebar Radar 通知徽标计数（V1 占位 0；SP-17 接通真值）*/
  notifCount?: number;
  /** Next/Link 组件由 consumer 注入（避免 packages/ui 直接依赖 next）*/
  LinkComponent: (props: { href: string; children: ReactNode; className?: string }) => JSX.Element;
}

const ROUTES = [
  { path: '/',       label: '首页',   icon: '🏠' },
  { path: '/news',   label: '热点流', icon: '📰' },
  { path: '/radar',  label: '雷达',   icon: '📡' },
  { path: '/trends', label: '趋势',   icon: '📊' },
  { path: '/vault',  label: '内容库', icon: '📚' },
] as const;

export function Sidebar({ currentPath, notifCount = 0, LinkComponent }: SidebarProps) {
  return (
    <aside className="glass-soft fixed left-4 top-4 bottom-4 w-60 z-10 flex flex-col p-4 gap-2">
      <div className="px-2 py-3 mb-2">
        <div className="font-bold text-base text-ink">AI Hot News</div>
        <div className="text-[10px] text-ink-3 mt-0.5">v0.1 · Aurora</div>
      </div>
      <nav className="flex flex-col gap-1">
        {ROUTES.map((r) => {
          const active = currentPath === r.path || (r.path !== '/' && currentPath.startsWith(r.path));
          return (
            <LinkComponent
              key={r.path}
              href={r.path}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                active ? 'bg-ink text-white' : 'text-ink-2 hover:bg-ink/[0.04]'
              }`}
            >
              <span className="text-base">{r.icon}</span>
              <span className="flex-1">{r.label}</span>
              {r.path === '/radar' && notifCount > 0 && (
                <span className="bg-aurora text-white text-[10px] font-semibold rounded-full w-4 h-4 flex items-center justify-center pulse-ring">
                  {notifCount}
                </span>
              )}
            </LinkComponent>
          );
        })}
      </nav>
      <div className="mt-auto pt-4 border-t border-line text-[11px] text-ink-3">
        <div>Personal Feed</div>
      </div>
    </aside>
  );
}
```

**为什么 LinkComponent 由 consumer 注入**：避免 `packages/ui` 引入 `next` 作为依赖。同款做法见 React Aria / shadcn — 让 ui 包零框架依赖，便于将来 storybook / unit test。

**单测**（Sidebar.spec.tsx）：5 cases
- `currentPath="/news"` → 热点流项 className 含 `bg-ink text-white`，其他项不含
- `currentPath="/news/abc"` → 热点流项仍 active（startsWith 匹配子路径）
- `notifCount=0` → 无徽标节点
- `notifCount=3` → 徽标显示 "3" + 含 `pulse-ring` className
- `currentPath="/radar"` 且 `notifCount=2` → 徽标在 /radar 项内（不出现在其他项）

### 3.7 packages/ui 包结构

```
packages/ui/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── atoms/
    │   ├── Glass.tsx + Glass.spec.tsx
    │   ├── Pill.tsx + Pill.spec.tsx
    │   ├── HeatBadge.tsx + HeatBadge.spec.tsx
    │   ├── Tag.tsx + Tag.spec.tsx
    │   ├── PageHeader.tsx + PageHeader.spec.tsx
    │   └── Sidebar.tsx + Sidebar.spec.tsx
    ├── tokens.ts
    └── index.ts          ← 重导出所有 atoms + tokens
```

`package.json`：
```json
{
  "name": "@ai-hot-news/ui",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "echo 'no build needed (TS sources)'"
  },
  "peerDependencies": { "react": "^19", "react-dom": "^19" },
  "devDependencies": {
    "@testing-library/react": "^16",
    "@testing-library/jest-dom": "^6",
    "jsdom": "^26",
    "vitest": "^2",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

> **TS sources 而非 build dist**：与 `packages/types` 一致。`apps/web` 和未来 `apps/admin` 都直接 import TS 源码，避免增量 build 链复杂度。`packages/utils` 和 `packages/prompts` 因为被 worker(NestJS standalone) 消费才 build dist；ui 只被 Next.js 消费，Next 自带 TS transpile。

`tsconfig.json`（继承根 tsconfig + jsx 配置）：
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

`vitest.config.ts`：
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['@testing-library/jest-dom/vitest'],
  },
});
```

> **首次 jsdom 测试基础设施**：本 SP 是 monorepo 第一次给 React 组件加 vitest 测试。`@testing-library/react` + `jsdom` 是最小可行集；不引 storybook（YAGNI）；不引 axe-core / a11y 检测（YAGNI）。`apps/web` 仍不加 vitest（§11 决策日志记的 YAGNI 政策延续）—— web 端验收靠 PR-C 部署后人肉点开 5 路由。

---

## 4. apps/web 路由结构

### 4.1 layout.tsx — 持久 Sidebar + aurora-blob

```tsx
// apps/web/app/layout.tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { Sidebar } from '@ai-hot-news/ui';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Hot News',
  description: 'AI 热点信息聚合与监控平台',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const currentPath = h.get('x-pathname') ?? '/';   // middleware 注入（见下）

  return (
    <html lang="zh-CN">
      <body>
        <div className="aurora-blob ab-1" />
        <div className="aurora-blob ab-2" />
        <div className="aurora-blob ab-3" />
        <Sidebar currentPath={currentPath} notifCount={0} LinkComponent={Link as any} />
        <main className="ml-72 mr-8 my-8 relative z-1">
          {children}
        </main>
      </body>
    </html>
  );
}
```

**`x-pathname` middleware**（必需，因为 RSC 不能用 `usePathname()`）：

```typescript
// apps/web/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set('x-pathname', req.nextUrl.pathname);
  return res;
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico).*)'],
};
```

> **为什么不用 `usePathname()`**：Sidebar 在 layout.tsx 是 RSC，无法用 client hook。middleware 注入 `x-pathname` header 是 Next 14+ App Router 推荐的 SSR 方案。

### 4.2 5 个路由文件

| 路由 | 文件 | 数据来源 | 备注 |
|----|----|----|----|
| `/` | `app/page.tsx` | hard-code mock | HomePage：4 stats + 热度榜 + 24h 曲线 SVG + 信源分布 + 我的提醒占位；MockupBanner 顶部 |
| `/news` | `app/news/page.tsx` | **真数据**（`fetchHotNewsList`）| 保留 SP-7 全部行为；卡片样式换 Aurora；HeatBadge 首次渲染；无 MockupBanner |
| `/radar` | `app/radar/page.tsx`（新）| hard-code mock（KEYWORDS 假数据）| 雷达 SVG 用 Aurora HTML 同款（不抽到 ui 包）；MockupBanner |
| `/trends` | `app/trends/page.tsx`（新）| hard-code mock | 公司声量 fillBar + 折线占位 SVG；MockupBanner |
| `/vault` | `app/vault/page.tsx`（新）| hard-code mock | 搜索框 inactive + 推荐标签 + 序号列表；MockupBanner |

### 4.3 MockupBanner

```tsx
// apps/web/app/_components/MockupBanner.tsx
export function MockupBanner({ targetSp }: { targetSp: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-2 rounded-lg mb-6 flex items-center gap-2">
      <span className="text-base">📊</span>
      <span>
        <strong>Mockup</strong> · 数据为静态示例，将在 <strong>{targetSp}</strong> 接入真实数据
      </span>
    </div>
  );
}
```

每个 mockup 路由文件的 page.tsx 顶部首个组件就是 `<MockupBanner targetSp="SP-9" />` (或对应 SP)。

---

## 5. 数据流与 mock data

### 5.1 /news 数据流（保留 SP-1/4.5/5/6/7 现状）

`apps/web/app/news/page.tsx` 数据 fetch 0 改动：

```tsx
// 既有逻辑保留
const data = await fetchHotNewsList(page, pageSize, platforms);
// ↓ data.items 形态：
//   { id, sourceUrl, title, titleZh, summary, aiTags, sourcePlatform,
//     publishedAt, heatScore, heatLevel, groupId, groupSize,
//     interactionData, ...}
```

仅 `_components/news-item.tsx` 内部改动：

```tsx
// Before (SP-1 灰白样式)
<div className="border-b border-gray-200 py-4">
  <a href={item.sourceUrl}>...</a>
  <span className="bg-red-50 text-red-700 px-2 py-0.5">RD</span>
  ...
</div>

// After (Aurora) —— byline 区 / cross-platform badge / details 折叠保留 SP-7 既有 JSX
<Glass variant="hover" as="article" className="p-5 mb-3 fade-up">
  <div className="flex items-start gap-4">
    <HeatBadge score={item.heatScore} level={item.heatLevel} />
    <div className="flex-1 min-w-0">
      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" title={tooltip}
         className="block text-base font-semibold text-ink hover:text-aurora line-clamp-2 transition">
        {displayTitle}
      </a>
      {item.summary && (
        <p className="text-sm text-ink-2 mt-2 whitespace-pre-line line-clamp-3">{item.summary}</p>
      )}
      {/* byline 区：byline · Pill · 时间 · 跨平台 badge —— SP-7-E 保留 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <span className={item.sourcePlatform === 'REDDIT' && item.subreddit ? 'font-medium text-aurora' : ''}>
          {byline}  {/* r/OpenAI 或 author */}
        </span>
        <span>·</span>
        <Pill platform={item.sourcePlatform} />
        <span>·</span>
        <LocalTime iso={item.publishedAt} />
        {crossPlatformBadge && (
          <>
            <span>·</span>
            <span className="rounded bg-aurora-soft px-1.5 py-0.5 text-[11px] font-medium text-aurora">
              {crossPlatformBadge}
            </span>
          </>
        )}
      </div>
      {/* aiTags */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.aiTags.slice(0, 4).map((t) => <Tag key={t}>{t}</Tag>)}
      </div>
      {/* SP-7-D 折叠：保留 <details> JSX，仅升级配色 */}
      {hasMembers && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs text-aurora hover:text-ink select-none list-none flex items-center gap-1">
            <span className="inline-block transition-transform group-open:rotate-90">▶</span>
            <span>查看同组其它 {item.groupMembers.length} 篇</span>
          </summary>
          {/* group members 列表，配色升级到 aurora soft，结构 0 改 */}
          ...
        </details>
      )}
    </div>
  </div>
</Glass>
```

**保留 SP-7 行为**（不可破坏 —— PR-C 必须 1:1 行为对齐）：
- SP-7-B：`groupId / groupSize` 字段消费不变
- SP-7-C：`crossPlatformBadge` 文本拼接函数 `formatCrossPlatformBadge` 保留 import 不动，仅 `<span>` className 改 `bg-aurora-soft text-aurora`
- SP-7-D：`<details>` 折叠 JSX 结构保留，仅 className 升级
- SP-7-E：`formatByline` 函数保留 import 不动，byline 区在 Pill 之外单独渲染（**Pill 不接 subreddit prop**，§3.2 决策）
- SP-5 v3.4 whitespace-pre-line：`summary` 偶发 1 个 `\n` 仍正确换行
- SP-5 titleZh-cjk-guard：`titleZh ?? title` fallback 保留

### 5.2 /radar/trends/vault mockup 数据

直接从 Aurora HTML line 95-113 搬来，hard-code 在各路由文件里：

```tsx
// apps/web/app/radar/page.tsx
const KEYWORDS = [
  { id:1, keyword:"Claude Code", platforms:["X","HN","RD"], freq:"30 分钟", on:true, today:127, week:843, last:"5 分钟前", trend:"up", score:94 },
  { id:2, keyword:"OpenAI", platforms:["X","RSS","HN"], freq:"15 分钟", on:true, today:384, week:2130, last:"2 分钟前", trend:"up", score:98 },
  // ... 共 6 行
] as const;

export default function RadarPage() {
  return (
    <>
      <MockupBanner targetSp="SP-15" />
      <PageHeader kicker="KEYWORD RADAR" title="关键词监控" sub="6 个监控项 · 通知频率 15-60 分钟" />
      {/* Aurora HTML line 636-836 RadarPage 主体搬过来 */}
    </>
  );
}
```

**hard-code 的合法性**：mockup 是为了视觉系统验证，数据本身不重要。等对应 SP（SP-15）启动 brainstorming 时再决定真数据 schema / API / fetch 策略。

### 5.3 / HomePage mockup 数据

```tsx
const STATS = {
  hotCount: 156,
  hotDelta: '+23',
  totalCount: 4892,
  totalDelta: '+891',
  hitRate: '7.4%',
  hitDelta: '+1.2%',
  alertCount: 12,
  alertDelta: '+5',
};

const TOP_NEWS = [/* 6 行 from Aurora HTML NEWS 数组 */];

const SOURCE_DISTRIBUTION = [
  { source: 'HackerNews', percent: 32, count: 1567 },
  { source: 'Reddit',     percent: 28, count: 1370 },
  { source: 'RSS 权威媒体', percent: 25, count: 1223 },
  { source: 'Twitter',    percent: 15, count: 732 },
];

const HEAT_CURVE = [/* 24 个 hour buckets，每个 score 0-100 */];

export default function HomePage() {
  return (
    <>
      <MockupBanner targetSp="SP-9" />
      <PageHeader kicker="DASHBOARD" title="今日热点" sub={new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })} />
      {/* Aurora HTML line 261-396 HomePage 主体搬过来 */}
    </>
  );
}
```

---

## 6. 错误处理

### 6.1 packages/ui

纯展示组件，无数据 fetch，无错误处理需要。所有 props 用 TypeScript 类型约束；运行时 invalid 输入（如 `score: NaN`）由 React 自然兜底（NaN 渲染为空字符串）。

### 6.2 apps/web mockup 页面

mock data 是 `const`，不可能 fail。每个 mockup 路由文件无 try/catch / error boundary。

### 6.3 apps/web /news（PR-C）

保留现有错误处理：
- `fetch` 失败 → `error-state.tsx`（SP-1 已实现，本 SP 仅升级 className）
- 0 条数据 → `empty-state.tsx`（SP-1 已实现，本 SP 仅升级 className）
- HeatBadge 接收 null → 该 atom 内部已 `if (score === null) return null`，不抛错

### 6.4 layout.tsx

`headers().get('x-pathname')` 在某些 edge case（middleware 没跑到，如 Next dev mode 的 `_next/static`）可能为空 → fallback `'/'` 让 Sidebar 默认高亮首页。`as any` 转 LinkComponent 类型避免 next/link 类型与 ui 包定义不完全对齐。

---

## 7. 测试策略

### 7.1 packages/ui

| Atom | Spec 文件 | Cases | 工具 |
|----|----|----|----|
| Glass | Glass.spec.tsx | 3 | RTL + jsdom |
| Pill | Pill.spec.tsx | 4 | RTL + jsdom |
| HeatBadge | HeatBadge.spec.tsx | 5 | RTL + jsdom |
| Tag | Tag.spec.tsx | 2 | RTL + jsdom |
| PageHeader | PageHeader.spec.tsx | 3 | RTL + jsdom |
| Sidebar | Sidebar.spec.tsx | 5 | RTL + jsdom |

总 22 个新测试 case。

### 7.2 apps/web

仍**不**加 vitest（§11 决策日志 YAGNI 政策）。验收靠：
1. `pnpm typecheck` — 类型层面捕捉错误（如 Pill 的 platform prop 不接受 lowercase）
2. `pnpm build` — Next 生产构建跑通 5 路由静态页面
3. **PR-B / PR-C 部署后人肉视觉 smoke**（详见 §11 部署 checklist）

### 7.3 既有测试矩阵 0 改动

worker / api / db / utils / prompts 现有 ~250 测试无需任何修改（本 SP 是纯前端）。

### 7.4 Turbo 配置

`turbo.json` 已有的 `lint` / `typecheck` / `test` / `build` task 自动覆盖新加的 `packages/ui`，无需改 turbo 配置。

---

## 8. PR 拆分（Z 三 PR）

### 8.1 PR-A：tokens + ui 包 + 全局 CSS

**分支**：`feat/sp8-A-ui-tokens`

**改动文件**：
- 新建 `packages/ui/` 完整目录（package.json / tsconfig / vitest.config / src/* + spec）
- `pnpm-workspace.yaml` 加 `packages/ui`
- `apps/web/app/globals.css` 重写（tokens + aurora-blob + glass + animations）
- `apps/web/tailwind.config.ts` 扩展（colors / fontFamily / animation）
- `apps/web/package.json` 加 `@ai-hot-news/ui: workspace:*` 依赖

**验收**：
- 22 个 packages/ui 单测全绿
- `pnpm turbo run lint typecheck build` 全绿
- `apps/web` 仍跑老 SP-1 灰白样式（layout / page / news 全部不动），但 globals.css 已经升级

**Stage 状态**：ui 包暂时无消费者（合法，与 SP-7-A 同款）。

**估算**：~2d

### 8.2 PR-B：路由壳子 + Sidebar + 4 个 mockup

**分支**：`feat/sp8-B-routes-mockups`

**改动文件**：
- `apps/web/middleware.ts`（新建）
- `apps/web/app/layout.tsx` 重写（持久 Sidebar + aurora-blob 注入）
- `apps/web/app/page.tsx` 改为 HomePage mockup
- `apps/web/app/{radar,trends,vault}/page.tsx`（新增 3 个）
- `apps/web/app/_components/MockupBanner.tsx`（新增）

**验收**：
- 5 路由全部 typecheck 通过 + Next build 通过
- 浏览器逐个访问 5 路由：HomePage / Radar / Trends / Vault 显示 Aurora mockup + 红 banner；/news 仍是 SP-1 灰白（PR-C 处理）
- Sidebar 在所有路由持久可见，active 高亮跟随 url

**估算**：~2d

### 8.3 PR-C：/news 换肤

**分支**：`feat/sp8-C-news-aurora-skin`

**改动文件**：
- `apps/web/app/news/_components/news-item.tsx` 改用 Glass + Pill + HeatBadge + Tag
- `apps/web/app/news/_components/{feed-tabs,list-header,pagination,empty-state,error-state}.tsx` Aurora 化
- `apps/web/app/news/page.tsx` 顶部加 PageHeader（替换 list-header）

**验收**：
- /news 显示 Aurora 卡片 + HeatBadge 接 SP-6 真数据
- SP-7 全部行为保留（折叠 / subreddit / breakdown）
- 二三档 hover 效果正常（卡片 translateY + 紫色边框）

**估算**：~1d

### 8.4 总工期

~5d（不含 brainstorming + spec + plan 时间，仅实施）。

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|----|----|----|
| `backdrop-filter` 在 Safari iOS / 低端 Android 性能差 | 中 | desktop-only 已豁免；Safari macOS 已支持；真有手机访问需求时单独开 SP |
| Aurora HTML 用 React 18 inline JSX，搬运到 Next 14 RSC 会撞 client/server boundary | 中 | mockup 页面任何含 `useState/useEffect/useRef/onClick` 的 sub-component 必须 `'use client'`；page.tsx 主体保 RSC |
| `headers().get('x-pathname')` 在 dev 模式 fast-refresh 偶发 null | 低 | fallback `'/'`；上 prod 后 middleware 稳定运行 |
| Tailwind v4 配置兼容性（`@import 'tailwindcss'` 写法）| 低 | 当前已在用 v4，本 SP 不动版本；v3 配置语法（`@tailwind base; ...`）不引入 |
| packages/ui 直接 export TS 源码可能让 Next bundle 体积增加 | 低 | atoms 都是 < 50 行的纯 React 组件；Next tree-shaking 会自动 dead-code-eliminate 未消费的 |
| Sidebar 用 LinkComponent 注入模式 react/jsx-runtime 复杂度上升 | 低 | 类型 `(props: { href, children, className? }) => JSX.Element` 简单；consumer 直接传 `Link as any` 即可 |
| HeatBadge 用 SP-6 真数据后，BURST 行 pulse-ring 动画与 fadeUp 入场动画叠加可能视觉过载 | 低 | 单 atom 多动画可接受（Aurora HTML 原设计如此）；如果真过载，PR-C review 阶段单测可显示 BURST 行密度，调整 |

---

## 10. 升级钩子（V2 / 未来 SP 候选）

| 钩子 | 触发时机 | 改动 |
|----|----|----|
| MiniSpark / HeatCurve / Filter / Radar 抽到 packages/ui | SP-9 / SP-10 / SP-15 启动时 | 这些组件需要 props 设计 brainstorm；当前 mockup 内 inline 实现 |
| 暗色模式 | 用户提出 + V2 | tokens.ts 加 dark variant；globals.css 加 `[data-theme='dark']` 选择器 |
| 移动端断点 | 用户提出 + V2 | Sidebar 改 bottom nav；卡片间距压缩；单独 brainstorm session |
| Storybook | packages/ui 组件超 15 个时 | 现 6 个 YAGNI |
| useCountUp 数字滚动 | SP-9 stats 接真数据时 | 从 Aurora HTML line 123 搬过来 |
| 通用 Layout 组件 | 多个不同 layout 需求时 | 当前所有路由共享 layout.tsx，YAGNI |

---

## 11. 部署 checklist

### 11.1 PR-A 部署后

- CI 全绿 + Deploy 完成（worker/api/web 镜像 rolled，但 web 视觉无变化）
- 浏览器访问 https://hotnews.shinpeionline.top/news 仍是 SP-1 灰白样式 ✓（预期）
- View source → 检查 `<head>` 中的 globals.css 已含 `--c1: #7e57f5` ✓

### 11.2 PR-B 部署后

- 浏览器访问 5 路由各看一眼：
  - [ ] `/` HomePage mockup 显示 4 stats 卡 + 热度榜 + 信源分布
  - [ ] `/news` 仍灰白（PR-C 才换）
  - [ ] `/radar` Radar mockup 显示 6 个关键词 + 雷达 SVG
  - [ ] `/trends` Trends mockup 显示进度条 + 折线
  - [ ] `/vault` Vault mockup 显示搜索框 + 推荐标签
- [ ] 每个页面顶部红 MockupBanner 显示（除 /news）
- [ ] 左侧 Sidebar 持久可见，5 项 + 当前路由高亮
- [ ] 背景 aurora-blob 漂浮（drift 动画运行）

### 11.3 PR-C 部署后

- [ ] /news 卡片样式 Aurora 化（glass + 紫色 hover）
- [ ] HeatBadge 在每行渲染 SP-6 数据（真值如 87 / 76 / 52 / 33）
- [ ] BURST 行徽章带 pulse-ring 动画
- [ ] Reddit 行 `r/<subreddit>` 显示（SP-7-E 行为保留）
- [ ] groupSize > 1 行可折叠 + 展开（SP-7-D 行为保留）
- [ ] 跨平台 group 显示真实 per-source breakdown（SP-7-C 行为保留）
- [ ] summary 偶发 `\n` 仍正确换行（SP-5 v3.4 whitespace-pre-line 保留）
- [ ] titleZh 为 null 行 fallback 显示原 title（SP-5 + cjk-guard 行为保留）

---

## 12. 决策日志（Decision Log）

| 日期 | 决策 | 替代 | 理由 |
|----|----|----|----|
| 2026-05-16 | V1 含 /news 换肤（B）而非严格壳子（A）| A 严格壳子 | 视觉系统在唯一真页面被实战验证；用户体感连贯 |
| 2026-05-16 | A 高保真 + 系统字体替换 Inter Tight | A 完全 1:1 / B 中等 / C 极简 | 字体差异主要影响英文标题，prod 大多 titleZh 中文标题；Google Font 引入 +200KB / LCP 损失大 |
| 2026-05-16 | Z 三 PR（tokens → routes → news skin）| 单 PR / 双 PR | 与 SP-6/SP-7 PR-driven workflow 一致；review 友好；中间状态可独立 deploy |
| 2026-05-16 | V1 真用 5 atoms + Glass（共 6 个），不抽 4 个未消费 atom | P 全 9 atoms / R 极简 4 | YAGNI；HeatBadge 必抽以接 SP-6；MiniSpark/HeatCurve/Filter/Radar 推到对应 SP |
| 2026-05-16 | 5 路由 placeholder 全 mockup（β）+ MockupBanner | α 空 placeholder / γ HomePage 接真热度榜 | 视觉系统在多页面验证一致性；γ 越界 SP-9 |
| 2026-05-16 | desktop-only，无 responsive 断点 | b 关键断点 / c 完整 responsive | PRD 个人自用；Aurora 无移动版设计稿；真要时单独开 SP |
| 2026-05-16 | titleZh CJK guard 独立 hotfix PR（PR #23）先于 SP-8 PR-A | 纳入 SP-8 Task 0 / 暂不做 | 边界原则：titleZh 是 SP-5 摘要管线产物，不归 SP-8 |
| 2026-05-16 | 根路由 / 换 Aurora HomePage mockup | 保留 SP-1 placeholder / redirect 到 /news | 与 β 一致：5 路由全 Aurora；未来 SP-9 替换数据来源 |
| 2026-05-16 | packages/ui 用 TS 源码而非 build dist | dist + esbuild bundle（同 utils/prompts）| Next 自带 transpile；与 packages/types 一致；省 build 链复杂度 |
| 2026-05-16 | Sidebar 用 LinkComponent 注入而非直接 import next/link | packages/ui 加 next 依赖 | 让 ui 包零框架依赖；便于将来 storybook / unit test |
| 2026-05-16 | apps/web 仍不加 vitest（YAGNI 政策延续）| 加 vitest+jsdom+RTL | 验收靠 typecheck + 部署后人肉点开 5 路由；真有 web 逻辑分支爆炸时单独开 SP |
| 2026-05-16 | 不引 Storybook | 引 Storybook | 6 atoms YAGNI；超 15 个 atom 时再开 SP |
| 2026-05-16 | x-pathname middleware 注入而非 client component | 整个 layout 改 client | RSC 性能 + Aurora 静态背景层不需要 client；middleware 是 Next 14+ 推荐方案 |

---

## 13. Errata（修订记录）

| 日期 | 来源 | 偏差 | 修复 PR |
|----|----|----|----|
| 2026-05-17 | PR-A §A7 实施 | PageHeader 实施漏了 spec §3.5 的 `kicker` prop、把 `sub`/`action` 字段名改成了 `subtitle`/`right`、字号字重从 `text-2xl font-bold` 偏到 `text-3xl font-light`、漏了 `fade-up` 入场动画 | fix/sp8-ui-spec-drift |
| 2026-05-17 | PR-A §A8 实施 | Sidebar 容器没用 `glass-soft`（用了普通 `border-r border-line`）、icon 用 H/N/R/T/V 字母而非设计稿的 ✦/◔/◈/◬/◎ 几何符号、logo block 简化成只 "Aurora" 单行（spec §3.6 要求 "AI Hot News" + "v0.1 · Aurora"）、标题字重字号偏离 spec、label 是 Home/News/Radar/Trends/Vault 英文而非中文 | fix/sp8-ui-spec-drift |

**V2 backlog**（设计稿超 SP-8 V1 scope，等后续 SP 接通）：

- Sidebar "系统状态卡"（数据抓取/AI 摘要/推送 + blink 灯）— 等 SP-25 observability
- Sidebar 底部"用户头像 + Pro 标签"— 等 SP-15 auth
- PageHeader 右侧 `✨ 生成今日日报` 按钮 — 等 SP-12 daily brief
- /news 双列网格布局 — V1 选了单列（列表阅读更舒服），V2 用户提需求再开
- Inter Tight / JetBrains Mono Google Font — V1 Q2 选系统字体保 LCP；若要切回需评估 LCP 回归
- Sidebar 移动端 bottom-nav — § 10 已列 V2



