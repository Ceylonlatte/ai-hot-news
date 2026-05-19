# SP-9 Dashboard Stats Implementation Plan

> **For agentic workers:** Execute task-by-task. Each task is self-contained (files / code skeleton / tests / commit). Three PR chain: PR-A (today + sources) → PR-B (heat-curve + trending) → PR-C (web rewire + ui atoms). Each PR independently deployed and smoked before next.

**Goal:** Land §7.2 M5 MVP by wiring the HomePage to real Stats API + adding 2 reusable `packages/ui` atoms.

**Architecture:** New `StatsModule` in `apps/api` (sibling to HotNewsModule) exposing 4 SSR-friendly endpoints under `/stats/*`. Web HomePage rewritten as RSC consuming these via `Promise.all`. `<CountUp>` (RAF tween) and `<HeatCurve>` (24-point SVG sparkline) extracted to `packages/ui` for reuse in SP-11/12.

**Tech Stack:** NestJS 11 / Prisma 6 (`$queryRaw` + `groupBy`) / Next 15 RSC / Tailwind 4 tokens / Vitest.

**Spec:** [docs/superpowers/specs/2026-05-19-sp9-dashboard-stats-design.md](../specs/2026-05-19-sp9-dashboard-stats-design.md)

---

## PR-A: `/stats/today` + `/stats/sources`

**Branch:** `feat/sp9-A-stats-today-sources`
**Diff target:** ~500 lines (api/src/stats/ + types/dtos + tests)
**Deploy gate:** prod `curl /api/stats/today` returns 4 non-error numbers; `/api/stats/sources` returns 4 platforms with pct sum ≈ 100.

### Task A1 — DTO contracts in `packages/types`

**Files:**
- Modify: `packages/types/src/dtos.ts`

- [ ] **Step A1.1: Add `StatsTodayDto` and `StatsSourcesDto` interfaces**

Append to end of `packages/types/src/dtos.ts`:

```typescript
export interface StatsTodayDto {
  aggregateCount: number;
  burstCount: number;
  taggedCount: number;
  sourceCount: number;
  windowStart: string;
  windowEnd: string;
}

export interface StatsSourcesDto {
  platforms: Array<{
    platform: 'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS';
    count: number;
    pct: number;
  }>;
  total: number;
  windowStart: string;
  windowEnd: string;
}
```

JSDoc comments inline (sourced from spec §2.1) — copy verbatim from spec to keep semantics in one place.

- [ ] **Step A1.2: Verify types build**

Run: `pnpm --filter @ai-hot-news/types build`
Expected: PASS

- [ ] **Step A1.3: Commit**

```bash
git add packages/types/src/dtos.ts
git commit -m "feat(sp9): add StatsTodayDto + StatsSourcesDto in types package"
```

### Task A2 — StatsService skeleton + `getToday()`

**Files:**
- Create: `apps/api/src/stats/stats.service.ts`
- Create: `apps/api/src/stats/stats.service.spec.ts`

- [ ] **Step A2.1: Write failing service spec for `getToday()`**

`apps/api/src/stats/stats.service.spec.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StatsService } from './stats.service';

const queryRaw = vi.fn();
const queryRawUnsafe = vi.fn();
vi.mock('@ai-hot-news/db', () => ({
  getPrisma: () => ({
    $queryRaw: queryRaw,
    $queryRawUnsafe: queryRawUnsafe,
  }),
}));

describe('StatsService.getToday', () => {
  let svc: StatsService;
  beforeEach(() => {
    queryRaw.mockReset();
    svc = new StatsService();
  });

  it('returns 4 counters with window range', async () => {
    queryRaw
      .mockResolvedValueOnce([{ aggregate_count: 234n, burst_count: 7n, tagged_count: 189n }])
      .mockResolvedValueOnce([{ source_count: 4n }]);
    const result = await svc.getToday();
    expect(result.aggregateCount).toBe(234);
    expect(result.burstCount).toBe(7);
    expect(result.taggedCount).toBe(189);
    expect(result.sourceCount).toBe(4);
    expect(Date.parse(result.windowStart)).toBeLessThan(Date.parse(result.windowEnd));
  });

  it('returns zeros when DB is empty', async () => {
    queryRaw
      .mockResolvedValueOnce([{ aggregate_count: 0n, burst_count: 0n, tagged_count: 0n }])
      .mockResolvedValueOnce([{ source_count: 0n }]);
    const result = await svc.getToday();
    expect(result.aggregateCount).toBe(0);
    expect(result.burstCount).toBe(0);
    expect(result.taggedCount).toBe(0);
    expect(result.sourceCount).toBe(0);
  });
});
```

- [ ] **Step A2.2: Run spec — expect FAIL ("StatsService not found")**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: FAIL

- [ ] **Step A2.3: Implement `StatsService.getToday()`**

`apps/api/src/stats/stats.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { getPrisma, Prisma } from '@ai-hot-news/db';
import type { StatsTodayDto, StatsSourcesDto } from '@ai-hot-news/types';

const WINDOW_HOURS = 24;

@Injectable()
export class StatsService {
  async getToday(): Promise<StatsTodayDto> {
    const prisma = getPrisma();
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

    type CountersRow = {
      aggregate_count: bigint;
      burst_count: bigint;
      tagged_count: bigint;
    };
    const countersResult = await prisma.$queryRaw<CountersRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'VISIBLE' AND "publishedAt" >= NOW() - INTERVAL '24 hours') AS aggregate_count,
        COUNT(*) FILTER (WHERE status = 'VISIBLE' AND "publishedAt" >= NOW() - INTERVAL '24 hours' AND "heatLevel" = 'BURST') AS burst_count,
        COUNT(*) FILTER (WHERE status = 'VISIBLE' AND "publishedAt" >= NOW() - INTERVAL '24 hours' AND array_length("aiTags", 1) > 0) AS tagged_count
      FROM hot_news
    `);
    const counters = countersResult[0] ?? { aggregate_count: 0n, burst_count: 0n, tagged_count: 0n };

    type SourceRow = { source_count: bigint };
    const sourceResult = await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT sc.id)::bigint AS source_count
      FROM source_configs sc
      INNER JOIN hot_news hn ON hn."sourcePlatform" = sc.platform
      WHERE sc.enabled = TRUE
        AND hn.status = 'VISIBLE'
        AND hn."publishedAt" >= NOW() - INTERVAL '24 hours'
    `);

    return {
      aggregateCount: Number(counters.aggregate_count),
      burstCount: Number(counters.burst_count),
      taggedCount: Number(counters.tagged_count),
      sourceCount: Number(sourceResult[0]?.source_count ?? 0n),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    };
  }

  async getSources(): Promise<StatsSourcesDto> {
    throw new Error('Not implemented yet — see Task A3');
  }
}
```

- [ ] **Step A2.4: Run spec — expect PASS**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: 2 PASS

- [ ] **Step A2.5: Commit**

```bash
git add apps/api/src/stats/stats.service.ts apps/api/src/stats/stats.service.spec.ts
git commit -m "feat(sp9): StatsService.getToday()"
```

### Task A3 — `getSources()` with pct rounding edge case

**Files:**
- Modify: `apps/api/src/stats/stats.service.ts`
- Modify: `apps/api/src/stats/stats.service.spec.ts`

- [ ] **Step A3.1: Append failing specs for `getSources()`**

Add to `stats.service.spec.ts`:

```typescript
describe('StatsService.getSources', () => {
  let svc: StatsService;
  beforeEach(() => {
    queryRaw.mockReset();
    svc = new StatsService();
  });

  it('returns 4 platforms with pct summing ≈ 100', async () => {
    queryRaw.mockResolvedValueOnce([
      { platform: 'HACKERNEWS', count: 100n },
      { platform: 'REDDIT', count: 100n },
      { platform: 'RSS', count: 100n },
    ]);
    const result = await svc.getSources();
    expect(result.total).toBe(300);
    expect(result.platforms).toHaveLength(3);
    expect(result.platforms.map((p) => p.pct)).toEqual([33, 33, 34]); // rounding distributes last bucket
  });

  it('returns empty when no rows', async () => {
    queryRaw.mockResolvedValueOnce([]);
    const result = await svc.getSources();
    expect(result.total).toBe(0);
    expect(result.platforms).toEqual([]);
  });

  it('handles a single platform (100%)', async () => {
    queryRaw.mockResolvedValueOnce([{ platform: 'HACKERNEWS', count: 50n }]);
    const result = await svc.getSources();
    expect(result.platforms[0]).toEqual({ platform: 'HACKERNEWS', count: 50, pct: 100 });
  });
});
```

- [ ] **Step A3.2: Run — expect FAIL ("Not implemented yet")**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: 3 new FAIL

- [ ] **Step A3.3: Implement `getSources()`**

Replace `getSources` body in `stats.service.ts`:

```typescript
async getSources(): Promise<StatsSourcesDto> {
  const prisma = getPrisma();
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  type Row = { platform: 'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS'; count: bigint };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT "sourcePlatform"::text AS platform, COUNT(*)::bigint AS count
    FROM hot_news
    WHERE status = 'VISIBLE' AND "publishedAt" >= NOW() - INTERVAL '24 hours'
    GROUP BY "sourcePlatform"
    ORDER BY count DESC
  `);

  const counts = rows.map((r) => ({ platform: r.platform, count: Number(r.count) }));
  const total = counts.reduce((s, c) => s + c.count, 0);

  const platforms = distributePct(counts, total);

  return {
    platforms,
    total,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

// Hare quota: round all to floor pct, then assign the residual rounding error
// to the *last* bucket (one with smallest count). Guarantees sum === 100 when
// total > 0 and all counts > 0. When total == 0, returns [] from caller.
function distributePct(
  counts: Array<{ platform: 'TWITTER' | 'HACKERNEWS' | 'REDDIT' | 'RSS'; count: number }>,
  total: number,
): StatsSourcesDto['platforms'] {
  if (total === 0 || counts.length === 0) return [];
  const floored = counts.map((c) => ({ ...c, pct: Math.floor((c.count / total) * 100) }));
  const residual = 100 - floored.reduce((s, p) => s + p.pct, 0);
  if (residual !== 0 && floored.length > 0) {
    // Add residual to last (smallest-count) row to keep visible card stable
    floored[floored.length - 1].pct += residual;
  }
  return floored;
}
```

- [ ] **Step A3.4: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: 5 PASS

- [ ] **Step A3.5: Commit**

```bash
git add apps/api/src/stats/stats.service.ts apps/api/src/stats/stats.service.spec.ts
git commit -m "feat(sp9): StatsService.getSources() with pct hare-quota rounding"
```

### Task A4 — Controller + Module wiring

**Files:**
- Create: `apps/api/src/stats/stats.controller.ts`
- Create: `apps/api/src/stats/stats.controller.spec.ts`
- Create: `apps/api/src/stats/stats.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step A4.1: Write failing controller spec**

`apps/api/src/stats/stats.controller.spec.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

describe('StatsController', () => {
  const mkSvc = (overrides: Partial<StatsService> = {}) =>
    ({ getToday: vi.fn(), getSources: vi.fn(), ...overrides }) as unknown as StatsService;

  it('GET /stats/today delegates to service.getToday', async () => {
    const expected = { aggregateCount: 1, burstCount: 2, taggedCount: 3, sourceCount: 4, windowStart: 'a', windowEnd: 'b' };
    const svc = mkSvc({ getToday: vi.fn().mockResolvedValue(expected) });
    const ctrl = new StatsController(svc);
    expect(await ctrl.today()).toEqual(expected);
    expect(svc.getToday).toHaveBeenCalled();
  });

  it('GET /stats/sources delegates to service.getSources', async () => {
    const expected = { platforms: [], total: 0, windowStart: 'a', windowEnd: 'b' };
    const svc = mkSvc({ getSources: vi.fn().mockResolvedValue(expected) });
    const ctrl = new StatsController(svc);
    expect(await ctrl.sources()).toEqual(expected);
  });
});
```

- [ ] **Step A4.2: Run — expect FAIL**

Run: `pnpm --filter @ai-hot-news/api test -- stats.controller.spec`
Expected: FAIL

- [ ] **Step A4.3: Implement controller**

`apps/api/src/stats/stats.controller.ts`:

```typescript
import { Controller, Get } from '@nestjs/common';
import { StatsService } from './stats.service';
import type { StatsSourcesDto, StatsTodayDto } from '@ai-hot-news/types';

@Controller('stats')
export class StatsController {
  constructor(private readonly service: StatsService) {}

  @Get('today')
  today(): Promise<StatsTodayDto> {
    return this.service.getToday();
  }

  @Get('sources')
  sources(): Promise<StatsSourcesDto> {
    return this.service.getSources();
  }
}
```

`apps/api/src/stats/stats.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
```

- [ ] **Step A4.4: Register in app.module**

`apps/api/src/app.module.ts` — add `StatsModule` to imports:

```typescript
import { StatsModule } from './stats/stats.module';
// ...
imports: [
  ConfigModule.forRoot({ isGlobal: true, envFilePath: [APP_ENV, ROOT_ENV] }),
  HealthModule,
  HotNewsModule,
  StatsModule,  // <-- new
],
```

- [ ] **Step A4.5: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/api test`
Expected: ALL PASS (existing 6 + new 5 + new 2 = 13)

- [ ] **Step A4.6: Local smoke**

Run: `pnpm dev` (in another shell), then:

```bash
curl -s http://localhost:3001/stats/today | jq
curl -s http://localhost:3001/stats/sources | jq
```

Expected: Both return valid JSON shapes.

- [ ] **Step A4.7: Commit**

```bash
git add apps/api/src/stats/stats.controller.ts apps/api/src/stats/stats.controller.spec.ts apps/api/src/stats/stats.module.ts apps/api/src/app.module.ts
git commit -m "feat(sp9): wire StatsController + StatsModule under /stats"
```

### Task A5 — PR-A submission + smoke

- [ ] **Step A5.1: Run full test + lint + typecheck**

```bash
pnpm turbo run lint typecheck test --concurrency=1
```
Expected: ALL PASS

- [ ] **Step A5.2: Open PR-A**

```bash
git push -u origin feat/sp9-A-stats-today-sources
gh pr create --title "feat(sp9-A): /stats/today + /stats/sources API" --body "$(cat <<'EOF'
Lands the first two of SP-9's 4 stat endpoints.

## Scope
- `GET /stats/today` — 24h aggregate / burst / tagged / source counters
- `GET /stats/sources` — 24h platform distribution with hare-quota pct rounding
- New `StatsModule` sibling to HotNewsModule

## Smoke check (post-deploy)
\`\`\`bash
curl -s https://hotnews.shinpeionline.top/api/stats/today | jq
# Expect: { aggregateCount: N, burstCount: N, taggedCount: N, sourceCount: 1-4, windowStart/End: ISO }
curl -s https://hotnews.shinpeionline.top/api/stats/sources | jq '.platforms | map(.pct) | add'
# Expect: ≈ 100 (99 or 101 tolerated by spec §2.1)
\`\`\`

Spec: docs/superpowers/specs/2026-05-19-sp9-dashboard-stats-design.md §0 Q7, §2, §4 PR-A
Plan: docs/superpowers/plans/2026-05-19-sp9-dashboard-stats-plan.md
EOF
)"
```

- [ ] **Step A5.3: Wait for CI + auto-merge + deploy**

Watch CI; once green, merge to main; wait for deploy.yml to finish; then run smoke curl from A5.2 against prod URL.

- [ ] **Step A5.4: Update spec §11 with PR-A completion entry**

Append to decomposition design `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` §11 with PR link + commit range. (Match SP-6/SP-7 row format.)

---

## PR-B: `/stats/heat-curve` + `/stats/trending-keywords`

**Branch:** `feat/sp9-B-heat-curve-trending`
**Diff target:** ~600 lines (service + dto + tag-label utility + tests)
**Deploy gate:** `curl /api/stats/heat-curve | jq '.buckets | length'` = 24; `curl /api/stats/trending-keywords?limit=5 | jq '.items | length'` ≤ 5.

### Task B1 — DTO + tag-label utility

**Files:**
- Modify: `packages/types/src/dtos.ts` (add 2 more DTOs)
- Create: `packages/utils/src/tag-label.ts`
- Create: `packages/utils/src/tag-label.spec.ts`
- Modify: `packages/utils/src/index.ts` (re-export)

- [ ] **Step B1.1: Add `HeatCurveDto` + `TrendingKeywordsDto`**

Append to `packages/types/src/dtos.ts`:

```typescript
export interface HeatCurveDto {
  buckets: number[];
  hourLabels: string[];
  windowStart: string;
  windowEnd: string;
}

export interface TrendingKeywordsDto {
  items: Array<{
    tag: string;
    label: string;
    count24h: number;
    countPrior24h: number;
    growthPct: number;
  }>;
  windowStart: string;
  windowEnd: string;
}
```

Copy JSDoc from spec §2.1.

- [ ] **Step B1.2: Write failing tag-label spec**

`packages/utils/src/tag-label.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { stripTagLabel } from './tag-label';

describe('stripTagLabel', () => {
  it('strips company: prefix and Title-cases', () => {
    expect(stripTagLabel('company:openai')).toBe('OpenAI');
    expect(stripTagLabel('company:google')).toBe('Google');
  });

  it('handles multi-word kebab-case', () => {
    expect(stripTagLabel('model:claude-4')).toBe('Claude 4');
    expect(stripTagLabel('model:llama-3')).toBe('Llama 3');
    expect(stripTagLabel('category:code-generation')).toBe('Code Generation');
  });

  it('preserves known acronyms in uppercase', () => {
    expect(stripTagLabel('tech:rag')).toBe('RAG');
    expect(stripTagLabel('tech:llm')).toBe('LLM');
    expect(stripTagLabel('tech:gpu')).toBe('GPU');
    expect(stripTagLabel('tech:sdk')).toBe('SDK');
    expect(stripTagLabel('tech:mcp')).toBe('MCP');
  });

  it('handles compound acronym + word', () => {
    expect(stripTagLabel('tech:rag-system')).toBe('RAG System');
  });

  it('keeps already-uppercase as-is', () => {
    expect(stripTagLabel('company:OpenAI')).toBe('OpenAI');
  });

  it('returns original on missing prefix', () => {
    expect(stripTagLabel('weird')).toBe('weird');
  });

  it('returns "OpenAI" for company:openai not "Openai"', () => {
    // Capitalize-each-word should produce "Openai" naively; we want OpenAI special-case
    expect(stripTagLabel('company:openai')).toBe('OpenAI');
  });
});
```

- [ ] **Step B1.3: Run — expect FAIL**

Run: `pnpm --filter @ai-hot-news/utils test -- tag-label`
Expected: FAIL

- [ ] **Step B1.4: Implement `stripTagLabel()`**

`packages/utils/src/tag-label.ts`:

```typescript
// SP-9 (2026-05-19): Map prefix-encoded aiTag back to display label for
// UI. See spec §2.1 + §4 PR-B label transformation rules. Pure function,
// no I/O, deterministic — safe for both server (StatsService) and client
// callers.

const KNOWN_ACRONYMS = new Set([
  'rag', 'llm', 'ai', 'gpu', 'api', 'sdk', 'mcp', 'cli', 'tts', 'stt',
  'vlm', 'rl', 'ml', 'nlp', 'cv', 'gan', 'vae',
]);

// Brands whose canonical mixed-case form must be preserved (cannot be
// inferred from kebab segments).
const BRAND_OVERRIDES: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  hugingface: 'HuggingFace',
  huggingface: 'HuggingFace',
  github: 'GitHub',
  langchain: 'LangChain',
  langgraph: 'LangGraph',
  pytorch: 'PyTorch',
  tensorflow: 'TensorFlow',
  llama: 'Llama',
};

export function stripTagLabel(tag: string): string {
  const colonIdx = tag.indexOf(':');
  const raw = colonIdx === -1 ? tag : tag.slice(colonIdx + 1);
  if (!raw) return tag;

  return raw
    .split(/[-_]/)
    .map((part) => {
      const lower = part.toLowerCase();
      if (BRAND_OVERRIDES[lower]) return BRAND_OVERRIDES[lower];
      if (KNOWN_ACRONYMS.has(lower)) return lower.toUpperCase();
      // If the input is already mixed-case (e.g. "OpenAI"), preserve it
      if (part !== lower && part !== part.toUpperCase()) return part;
      // Default: Title-case
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}
```

- [ ] **Step B1.5: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/utils test -- tag-label`
Expected: 7 PASS

- [ ] **Step B1.6: Re-export from utils index**

`packages/utils/src/index.ts` — append:

```typescript
export { stripTagLabel } from './tag-label.js';
```

- [ ] **Step B1.7: Run utils build**

Run: `pnpm --filter @ai-hot-news/utils build`
Expected: PASS (esbuild bundle picks up new file)

- [ ] **Step B1.8: Commit**

```bash
git add packages/types/src/dtos.ts packages/utils/src/tag-label.ts packages/utils/src/tag-label.spec.ts packages/utils/src/index.ts
git commit -m "feat(sp9): HeatCurveDto + TrendingKeywordsDto + stripTagLabel utility"
```

### Task B2 — `getHeatCurve()` with 24-bucket generate_series

**Files:**
- Modify: `apps/api/src/stats/stats.service.ts`
- Modify: `apps/api/src/stats/stats.service.spec.ts`

- [ ] **Step B2.1: Write failing spec**

Append to `stats.service.spec.ts`:

```typescript
describe('StatsService.getHeatCurve', () => {
  let svc: StatsService;
  beforeEach(() => {
    queryRaw.mockReset();
    svc = new StatsService();
  });

  it('returns 24 buckets', async () => {
    queryRaw.mockResolvedValueOnce(
      Array.from({ length: 24 }, (_, i) => ({ h: i, max_heat: i * 2 })),
    );
    const result = await svc.getHeatCurve();
    expect(result.buckets).toHaveLength(24);
    expect(result.hourLabels).toHaveLength(24);
  });

  it('zeros for empty buckets', async () => {
    queryRaw.mockResolvedValueOnce(
      Array.from({ length: 24 }, (_, i) => ({ h: i, max_heat: 0 })),
    );
    const result = await svc.getHeatCurve();
    expect(result.buckets).toEqual(new Array(24).fill(0));
  });

  it('hourLabels are "HH:00" format', async () => {
    queryRaw.mockResolvedValueOnce(
      Array.from({ length: 24 }, (_, i) => ({ h: i, max_heat: 0 })),
    );
    const result = await svc.getHeatCurve();
    result.hourLabels.forEach((label) => {
      expect(label).toMatch(/^\d{2}:00$/);
    });
  });
});
```

- [ ] **Step B2.2: Run — expect FAIL**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: 3 new FAIL

- [ ] **Step B2.3: Implement `getHeatCurve()`**

In `stats.service.ts`, add method:

```typescript
async getHeatCurve(): Promise<HeatCurveDto> {
  const prisma = getPrisma();
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  type Row = { h: number; max_heat: number };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH hours AS (SELECT generate_series(0, 23) AS h)
    SELECT h::int, COALESCE(MAX(hn."heatScore"), 0)::float AS max_heat
    FROM hours
    LEFT JOIN hot_news hn
      ON hn.status = 'VISIBLE'
      AND hn."sourcePlatform" != 'RSS'
      AND hn."publishedAt" >= date_trunc('hour', NOW()) - INTERVAL '23 hours' + (h * INTERVAL '1 hour')
      AND hn."publishedAt" <  date_trunc('hour', NOW()) - INTERVAL '23 hours' + ((h + 1) * INTERVAL '1 hour')
    GROUP BY h
    ORDER BY h ASC
  `);

  const buckets = rows.map((r) => Number(r.max_heat));
  // Generate "HH:00" labels for each bucket. bucket[0] is 23h ago (truncated
  // to the hour); bucket[23] is the current (partial) hour.
  const startHour = new Date(Math.floor(windowEnd.getTime() / (60 * 60 * 1000)) * 60 * 60 * 1000 - 23 * 60 * 60 * 1000);
  const hourLabels = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(startHour.getTime() + i * 60 * 60 * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  });

  return {
    buckets,
    hourLabels,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}
```

Don't forget to add `import type { HeatCurveDto, TrendingKeywordsDto } from '@ai-hot-news/types';` at top.

- [ ] **Step B2.4: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: 8 PASS (5 prior + 3 new)

- [ ] **Step B2.5: Commit**

```bash
git add apps/api/src/stats/stats.service.ts apps/api/src/stats/stats.service.spec.ts
git commit -m "feat(sp9): StatsService.getHeatCurve() with generate_series 24-bucket LEFT JOIN"
```

### Task B3 — `getTrendingKeywords()` with prefix strip + growth ranking

**Files:**
- Modify: `apps/api/src/stats/stats.service.ts`
- Modify: `apps/api/src/stats/stats.service.spec.ts`

- [ ] **Step B3.1: Write failing spec**

Append to `stats.service.spec.ts`:

```typescript
describe('StatsService.getTrendingKeywords', () => {
  let svc: StatsService;
  beforeEach(() => {
    queryRaw.mockReset();
    svc = new StatsService();
  });

  it('uses 9999 sentinel for prior=0 case', async () => {
    queryRaw.mockResolvedValueOnce([
      { tag: 'company:openai', cur: 5n, prior: 0n, growth_pct: 9999 },
    ]);
    const result = await svc.getTrendingKeywords(8);
    expect(result.items[0]).toEqual({
      tag: 'company:openai',
      label: 'OpenAI',
      count24h: 5,
      countPrior24h: 0,
      growthPct: 9999,
    });
  });

  it('computes growth percentages', async () => {
    queryRaw.mockResolvedValueOnce([
      { tag: 'model:claude-4', cur: 15n, prior: 10n, growth_pct: 50 },
      { tag: 'category:research', cur: 5n, prior: 10n, growth_pct: -50 },
    ]);
    const result = await svc.getTrendingKeywords(8);
    expect(result.items.map((i) => i.growthPct)).toEqual([50, -50]);
    expect(result.items.map((i) => i.label)).toEqual(['Claude 4', 'Research']);
  });

  it('clamps limit to 20', async () => {
    queryRaw.mockResolvedValueOnce([]);
    await svc.getTrendingKeywords(100);
    // The mock captures the call; we just verify it didn't throw.
    expect(queryRaw).toHaveBeenCalled();
  });

  it('clamps limit to ≥ 1', async () => {
    queryRaw.mockResolvedValueOnce([]);
    await svc.getTrendingKeywords(0);
    expect(queryRaw).toHaveBeenCalled();
  });

  it('returns empty on no matches', async () => {
    queryRaw.mockResolvedValueOnce([]);
    const result = await svc.getTrendingKeywords(8);
    expect(result.items).toEqual([]);
  });
});
```

- [ ] **Step B3.2: Run — expect FAIL**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: 5 new FAIL

- [ ] **Step B3.3: Implement `getTrendingKeywords()`**

In `stats.service.ts`:

```typescript
import { stripTagLabel } from '@ai-hot-news/utils';

// ... in class:

async getTrendingKeywords(limit: number): Promise<TrendingKeywordsDto> {
  const prisma = getPrisma();
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit) || 8));

  type Row = { tag: string; cur: bigint; prior: bigint; growth_pct: number };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH unnested AS (
      SELECT unnest("aiTags") AS tag, "publishedAt"
      FROM hot_news
      WHERE status = 'VISIBLE'
        AND "publishedAt" >= NOW() - INTERVAL '48 hours'
        AND array_length("aiTags", 1) > 0
    ),
    buckets AS (
      SELECT
        tag,
        COUNT(*) FILTER (WHERE "publishedAt" >= NOW() - INTERVAL '24 hours')::bigint AS cur,
        COUNT(*) FILTER (WHERE "publishedAt" <  NOW() - INTERVAL '24 hours')::bigint AS prior
      FROM unnested
      GROUP BY tag
    )
    SELECT tag, cur, prior,
      CASE
        WHEN prior = 0 AND cur > 0 THEN 9999
        WHEN prior > 0 THEN ROUND(((cur::float - prior) / prior) * 100)::int
        ELSE 0
      END AS growth_pct
    FROM buckets
    WHERE cur > 0
    ORDER BY growth_pct DESC, cur DESC, tag ASC
    LIMIT ${safeLimit}
  `);

  return {
    items: rows.map((r) => ({
      tag: r.tag,
      label: stripTagLabel(r.tag),
      count24h: Number(r.cur),
      countPrior24h: Number(r.prior),
      growthPct: r.growth_pct,
    })),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}
```

- [ ] **Step B3.4: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/api test -- stats.service.spec`
Expected: 13 PASS (8 prior + 5 new)

- [ ] **Step B3.5: Commit**

```bash
git add apps/api/src/stats/stats.service.ts apps/api/src/stats/stats.service.spec.ts
git commit -m "feat(sp9): StatsService.getTrendingKeywords() with 24h-vs-prior delta"
```

### Task B4 — Controller endpoints + spec

**Files:**
- Modify: `apps/api/src/stats/stats.controller.ts`
- Modify: `apps/api/src/stats/stats.controller.spec.ts`

- [ ] **Step B4.1: Write failing controller specs**

Append to `stats.controller.spec.ts`:

```typescript
it('GET /stats/heat-curve delegates to service.getHeatCurve', async () => {
  const expected = { buckets: new Array(24).fill(0), hourLabels: new Array(24).fill('00:00'), windowStart: 'a', windowEnd: 'b' };
  const svc = mkSvc({ getHeatCurve: vi.fn().mockResolvedValue(expected) });
  const ctrl = new StatsController(svc);
  expect(await ctrl.heatCurve()).toEqual(expected);
});

it('GET /stats/trending-keywords delegates with default limit=8', async () => {
  const expected = { items: [], windowStart: 'a', windowEnd: 'b' };
  const getTrending = vi.fn().mockResolvedValue(expected);
  const svc = mkSvc({ getTrendingKeywords: getTrending });
  const ctrl = new StatsController(svc);
  expect(await ctrl.trendingKeywords()).toEqual(expected);
  expect(getTrending).toHaveBeenCalledWith(8);
});

it('GET /stats/trending-keywords passes limit query param', async () => {
  const expected = { items: [], windowStart: 'a', windowEnd: 'b' };
  const getTrending = vi.fn().mockResolvedValue(expected);
  const svc = mkSvc({ getTrendingKeywords: getTrending });
  const ctrl = new StatsController(svc);
  await ctrl.trendingKeywords('5');
  expect(getTrending).toHaveBeenCalledWith(5);
});
```

Update `mkSvc` factory to include `getHeatCurve` and `getTrendingKeywords` defaults.

- [ ] **Step B4.2: Run — expect FAIL**

Run: `pnpm --filter @ai-hot-news/api test -- stats.controller.spec`
Expected: 3 new FAIL

- [ ] **Step B4.3: Implement controller endpoints**

Update `stats.controller.ts`:

```typescript
import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { StatsService } from './stats.service';
import type {
  HeatCurveDto,
  StatsSourcesDto,
  StatsTodayDto,
  TrendingKeywordsDto,
} from '@ai-hot-news/types';

@Controller('stats')
export class StatsController {
  constructor(private readonly service: StatsService) {}

  @Get('today')
  today(): Promise<StatsTodayDto> { return this.service.getToday(); }

  @Get('sources')
  sources(): Promise<StatsSourcesDto> { return this.service.getSources(); }

  @Get('heat-curve')
  heatCurve(): Promise<HeatCurveDto> { return this.service.getHeatCurve(); }

  @Get('trending-keywords')
  trendingKeywords(
    @Query('limit', new DefaultValuePipe('8')) limit: string,
  ): Promise<TrendingKeywordsDto> {
    return this.service.getTrendingKeywords(parseInt(limit, 10));
  }
}
```

> Note: `DefaultValuePipe('8')` works with string source; we parseInt at the service boundary. Avoids `BadRequestException` on missing param (which `ParseIntPipe` alone would throw on `undefined`).

- [ ] **Step B4.4: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/api test`
Expected: ALL PASS (≥ 16 stats tests)

- [ ] **Step B4.5: Local smoke**

```bash
curl -s http://localhost:3001/stats/heat-curve | jq '.buckets | length'
# Expect: 24
curl -s 'http://localhost:3001/stats/trending-keywords?limit=3' | jq
# Expect: items array with ≤3 entries
```

- [ ] **Step B4.6: Commit**

```bash
git add apps/api/src/stats/stats.controller.ts apps/api/src/stats/stats.controller.spec.ts
git commit -m "feat(sp9): wire heat-curve + trending-keywords controller endpoints"
```

### Task B5 — PR-B submission + smoke

- [ ] **Step B5.1: Run full test/lint/typecheck**

```bash
pnpm turbo run lint typecheck test --concurrency=1
```
Expected: ALL PASS

- [ ] **Step B5.2: Open PR-B**

```bash
git push -u origin feat/sp9-B-heat-curve-trending
gh pr create --title "feat(sp9-B): /stats/heat-curve + /stats/trending-keywords API" --body "$(cat <<'EOF'
Lands the last two of SP-9's 4 stat endpoints.

## Scope
- \`GET /stats/heat-curve\` — 24 hourly MAX(heatScore) buckets via PG generate_series LEFT JOIN, RSS excluded
- \`GET /stats/trending-keywords?limit=N\` — 24h-vs-prior-24h aiTag delta ranking, with 9999 NEW sentinel for prior=0
- New \`stripTagLabel\` utility in \`packages/utils\` mapping prefix-encoded tags to display labels (handles brand overrides + acronym preserve)

## Smoke check (post-deploy)
\`\`\`bash
curl -s https://hotnews.shinpeionline.top/api/stats/heat-curve | jq '.buckets | length'
# Expect: 24
curl -s 'https://hotnews.shinpeionline.top/api/stats/trending-keywords?limit=5' | jq '.items[0]'
# Expect: { tag: "company:X", label: "X", count24h: N, countPrior24h: M, growthPct: K }
\`\`\`

Spec: docs/superpowers/specs/2026-05-19-sp9-dashboard-stats-design.md §0 Q4/Q5, §2.1, §4 PR-B
Plan: docs/superpowers/plans/2026-05-19-sp9-dashboard-stats-plan.md
EOF
)"
```

- [ ] **Step B5.3: CI + merge + deploy + smoke**

Same flow as A5.3.

- [ ] **Step B5.4: Update spec §11 with PR-B completion entry**

---

## PR-C: Web HomePage rewire + CountUp + HeatCurve atoms

**Branch:** `feat/sp9-C-homepage-real-data`
**Diff target:** ~800 lines (2 ui atoms + 1 page rewrite + 4 fetchers + tests)
**Deploy gate:** Browser visit `/` shows real data; MockupBanner removed; no console errors.

### Task C1 — `<CountUp>` atom in `packages/ui`

**Files:**
- Create: `packages/ui/src/atoms/CountUp.tsx`
- Create: `packages/ui/src/atoms/CountUp.spec.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step C1.1: Write failing spec**

`packages/ui/src/atoms/CountUp.spec.tsx`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { CountUp } from './CountUp';

describe('<CountUp>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0 and ramps to target', () => {
    const { getByText, rerender } = render(<CountUp value={100} duration={1000} />);
    expect(getByText('0')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    rerender(<CountUp value={100} duration={1000} />);
    expect(getByText('100')).toBeTruthy();
  });

  it('does not re-tween when value prop changes (first-mount only)', () => {
    const { getByText, rerender } = render(<CountUp value={100} duration={1000} />);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    rerender(<CountUp value={500} duration={1000} />);
    // Should stay at 100 (first-mount only contract)
    expect(getByText('100')).toBeTruthy();
  });

  it('formats with thousand-separator commas', () => {
    const { getByText } = render(<CountUp value={2847} duration={0} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(getByText('2,847')).toBeTruthy();
  });
});
```

- [ ] **Step C1.2: Run — expect FAIL**

Run: `pnpm --filter @ai-hot-news/ui test -- CountUp`
Expected: FAIL

- [ ] **Step C1.3: Implement `<CountUp>`**

`packages/ui/src/atoms/CountUp.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';

interface CountUpProps {
  value: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// SP-9 (2026-05-19): RAF-tweened integer counter for HomePage stat cards.
// Contract: first-mount only — subsequent `value` prop changes are ignored
// after the initial tween completes. This avoids re-running the animation
// every time the parent RSC re-renders (e.g. on Next router refresh after
// data revalidation). See spec §3.3 + §0 Q10.
export function CountUp({ value, duration = 1500, className, style }: CountUpProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const initial = 0;
    const delta = value - initial;
    let raf: number;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(t);
      setDisplay(Math.round(initial + delta * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // first-mount only by design

  return (
    <span className={className} style={style}>
      {display.toLocaleString('en-US')}
    </span>
  );
}
```

- [ ] **Step C1.4: Re-export**

`packages/ui/src/index.ts` — add:

```typescript
export { CountUp } from './atoms/CountUp.js';
```

- [ ] **Step C1.5: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/ui test -- CountUp`
Expected: 3 PASS

- [ ] **Step C1.6: Commit**

```bash
git add packages/ui/src/atoms/CountUp.tsx packages/ui/src/atoms/CountUp.spec.tsx packages/ui/src/index.ts
git commit -m "feat(sp9): <CountUp> atom — RAF tween, first-mount only"
```

### Task C2 — `<HeatCurve>` atom in `packages/ui`

**Files:**
- Create: `packages/ui/src/atoms/HeatCurve.tsx`
- Create: `packages/ui/src/atoms/HeatCurve.spec.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step C2.1: Write failing spec**

`packages/ui/src/atoms/HeatCurve.spec.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HeatCurve } from './HeatCurve';

describe('<HeatCurve>', () => {
  it('renders an SVG with polyline matching data length', () => {
    const data = [10, 20, 30, 40, 50, 60, 70, 80];
    const { container } = render(<HeatCurve data={data} />);
    const polyline = container.querySelector('polyline');
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute('points')!.trim().split(/\s+/);
    expect(points).toHaveLength(data.length);
  });

  it('renders hourLabels when provided', () => {
    const data = new Array(24).fill(0);
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    const { container } = render(<HeatCurve data={data} labels={labels} />);
    expect(container.textContent).toContain('00:00');
    expect(container.textContent).toContain('23:00');
  });

  it('does not crash on empty data', () => {
    const { container } = render(<HeatCurve data={[]} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('clamps values to maxY', () => {
    const { container } = render(<HeatCurve data={[200, 150]} maxY={100} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
```

- [ ] **Step C2.2: Run — expect FAIL**

Run: `pnpm --filter @ai-hot-news/ui test -- HeatCurve`
Expected: FAIL

- [ ] **Step C2.3: Implement `<HeatCurve>`**

`packages/ui/src/atoms/HeatCurve.tsx`:

```typescript
interface HeatCurveProps {
  data: number[];
  labels?: string[];
  maxY?: number;
  width?: number;
  height?: number;
  className?: string;
}

// SP-9 (2026-05-19): 24-point sparkline SVG. Extracted from inline
// HomePage mockup (apps/web/app/page.tsx) so SP-11 detail page heat-history
// can reuse. Token-driven gradient (var(--c1)/var(--c2)) instead of
// hardcoded purple. See spec §3.3.
export function HeatCurve({
  data,
  labels,
  maxY = 100,
  width = 1000,
  height = 120,
  className,
}: HeatCurveProps) {
  if (data.length === 0) {
    return <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className={className} />;
  }

  const clampedMax = Math.max(maxY, ...data);
  const denom = data.length > 1 ? data.length - 1 : 1;
  const pts = data.map((v, i) => {
    const x = i * (width / denom);
    const y = height - (Math.min(v, clampedMax) / clampedMax) * height * 0.85 - height * 0.075;
    return `${x},${y}`;
  });

  // Marker dots: prefer labels length when provided, otherwise every 4th
  const markerStep = labels ? Math.max(1, Math.floor(data.length / labels.length)) : 4;

  // Label tick decoration: show first / mid / last when labels provided.
  // Mockup used 6h interval (00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00 / 现在);
  // we follow the same density when labels.length === 24.
  const tickIndices = labels
    ? labels.length === 24
      ? [0, 4, 8, 12, 16, 20, 23]
      : labels.map((_, i) => i)
    : [];

  return (
    <div className={className}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="hc-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="var(--c1)" />
            <stop offset="50%" stopColor="var(--c2)" />
            <stop offset="100%" stopColor="var(--c1)" />
          </linearGradient>
          <linearGradient id="hc-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--c1)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--c1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')} L${width},${height} L0,${height} Z`} fill="url(#hc-fill)" />
        <polyline points={pts.join(' ')} fill="none" stroke="url(#hc-line)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => {
          if (i % markerStep !== 0 && i !== pts.length - 1) return null;
          const [x, y] = p.split(',');
          return <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke="var(--c1)" strokeWidth="1.5" />;
        })}
      </svg>
      {labels && (
        <div className="flex justify-between mt-2 font-mono">
          {tickIndices.map((idx) => (
            <span key={idx} className={`text-[10px] ${idx === labels.length - 1 ? 'text-ink font-semibold' : 'text-ink-3'}`}>
              {idx === labels.length - 1 && labels.length === 24 ? '现在' : labels[idx]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step C2.4: Re-export**

`packages/ui/src/index.ts` — add:

```typescript
export { HeatCurve } from './atoms/HeatCurve.js';
```

- [ ] **Step C2.5: Run — expect PASS**

Run: `pnpm --filter @ai-hot-news/ui test -- HeatCurve`
Expected: 4 PASS

- [ ] **Step C2.6: Commit**

```bash
git add packages/ui/src/atoms/HeatCurve.tsx packages/ui/src/atoms/HeatCurve.spec.tsx packages/ui/src/index.ts
git commit -m "feat(sp9): <HeatCurve> atom — 24-point SVG sparkline, token-driven gradient"
```

### Task C3 — Web API fetchers

**Files:**
- Modify: `apps/web/lib/api.ts`

- [ ] **Step C3.1: Add 4 fetchers**

Append to `apps/web/lib/api.ts`:

```typescript
import type {
  HotNewsListResponseDto,
  StatsTodayDto,
  StatsSourcesDto,
  HeatCurveDto,
  TrendingKeywordsDto,
} from '@ai-hot-news/types';

// (existing fetchHotNewsList stays)

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status} (${path}): ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchStatsToday(): Promise<StatsTodayDto> {
  return fetchJson<StatsTodayDto>('/stats/today');
}

export function fetchStatsSources(): Promise<StatsSourcesDto> {
  return fetchJson<StatsSourcesDto>('/stats/sources');
}

export function fetchHeatCurve(): Promise<HeatCurveDto> {
  return fetchJson<HeatCurveDto>('/stats/heat-curve');
}

export function fetchTrendingKeywords(limit = 8): Promise<TrendingKeywordsDto> {
  return fetchJson<TrendingKeywordsDto>(`/stats/trending-keywords?limit=${limit}`);
}
```

Refactor `fetchHotNewsList` to use `fetchJson` (optional cleanup; safe DRY).

- [ ] **Step C3.2: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(sp9): web fetchers for /stats/* + shared fetchJson helper"
```

### Task C4 — HomePage rewrite (RSC)

**Files:**
- Modify: `apps/web/app/page.tsx` (full rewrite)

- [ ] **Step C4.1: Rewrite as RSC consuming real data**

Replace the entire content of `apps/web/app/page.tsx`:

```typescript
import { Glass, PageHeader, Pill, HeatBadge, CountUp, HeatCurve } from '@ai-hot-news/ui';
import {
  fetchStatsToday,
  fetchStatsSources,
  fetchHeatCurve,
  fetchTrendingKeywords,
  fetchHotNewsList,
} from '@/lib/api';
import type { Platform } from '@ai-hot-news/types';

const PLATFORM_COLOR: Record<Platform, string> = {
  HACKERNEWS: '#14131a',
  REDDIT: '#7e57f5',
  RSS: '#5a5763',
  TWITTER: '#7e57f5',
};

// Card color cycle: purple / ink / purple / muted (matches Aurora HTML)
const STAT_COLORS = ['#7e57f5', '#14131a', '#7e57f5', '#5a5763'];

export default async function HomePage() {
  const [today, sources, heatCurve, trending, hotList] = await Promise.all([
    fetchStatsToday(),
    fetchStatsSources(),
    fetchHeatCurve(),
    fetchTrendingKeywords(5),
    fetchHotNewsList(1, 6, undefined, 'heat'),
  ]);

  const stats = [
    { l: '今日聚合', v: today.aggregateCount, d: '过去 24 小时', icon: '📥' },
    { l: '爆发事件', v: today.burstCount, d: '过去 24 小时', icon: '🔥' },
    { l: '标签覆盖', v: today.taggedCount, d: '已打 AI 标签 · 等 SP-14 改为关键词命中', icon: '🎯' },
    { l: '活跃信源', v: today.sourceCount, d: `${today.sourceCount > 0 ? '今日抓到' : '今日空载'}`, icon: '🌐' },
  ];

  const todayLabel = new Date(today.windowEnd).toISOString().slice(0, 10).replace(/-/g, '.');
  const subText = `过去 24 小时已聚合 ${today.aggregateCount} 条内容 · ${today.burstCount} 个爆发事件 · ${today.taggedCount} 个 AI 标签覆盖`;

  return (
    <>
      <div className="px-9 pt-7 pb-3">
        <PageHeader
          kicker={`Today · ${todayLabel}`}
          title="今天的"
          gradTitle="AI 信号潮汐"
          sub={subText}
          action={
            <button
              type="button"
              disabled
              title="等 SP-21 AI 日报上线"
              className="px-5 py-2.5 rounded-full text-white text-[13px] font-semibold flex items-center gap-2 cursor-not-allowed opacity-60"
              style={{ background: 'var(--grad)', boxShadow: '0 4px 16px rgba(20,19,26,0.21)' }}
            >
              ✨ 生成今日日报
            </button>
          }
        />
      </div>

      <div className="flex-1 overflow-auto px-9 pb-9">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3.5 mb-6">
          {stats.map((s, i) => (
            <Glass key={s.l} variant="hover" className="fade-up" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="px-5 py-4">
                <div className="flex justify-between items-center mb-3.5">
                  <span className="text-[12px] text-ink-2 font-medium">{s.l}</span>
                  <span className="text-[18px]" aria-hidden="true">{s.icon}</span>
                </div>
                <div
                  className="font-bold leading-none"
                  style={{ fontSize: 36, letterSpacing: '-0.03em', color: STAT_COLORS[i] }}
                >
                  <CountUp value={s.v} />
                </div>
                <div className="text-[11px] text-ink-3 mt-2">{s.d}</div>
              </div>
            </Glass>
          ))}
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
          {/* Hot list (reuses /hot-news?sort=heat&groupMode=fold) */}
          <div>
            <div className="flex justify-between items-center mb-3.5">
              <h2 className="text-[20px] font-bold tracking-tight">🌊 热度榜单</h2>
              <a href="/news" className="text-[13px] text-aurora font-medium">查看全部 →</a>
            </div>
            <div className="flex flex-col gap-2.5">
              {hotList.items.map((n, i) => {
                const platformsToShow: Platform[] = Array.from(
                  new Set<Platform>([n.sourcePlatform, ...Object.keys(n.groupPlatforms) as Platform[]]),
                );
                return (
                  <Glass key={n.id} variant="hover" className="fade-up" style={{ animationDelay: `${i * 0.05}s` }}>
                    <div className="flex gap-3.5 items-center" style={{ padding: '16px 18px' }}>
                      <div
                        className="font-extrabold leading-none text-ink"
                        style={{ width: 36, fontSize: 28, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold mb-1.5 truncate">
                          {n.titleZh ?? n.title}
                        </div>
                        <div className="flex gap-1.5 items-center flex-wrap">
                          {platformsToShow.map((p) => <Pill key={p} platform={p} />)}
                          <span className="text-[11px] text-ink-3">· {relativeTime(n.publishedAt)}</span>
                        </div>
                      </div>
                      {n.heatScore != null && n.heatLevel != null && (
                        <HeatBadge score={Math.round(n.heatScore)} level={n.heatLevel} />
                      )}
                    </div>
                  </Glass>
                );
              })}
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-4">
            {/* Trending */}
            <Glass className="fade-up" style={{ animationDelay: '0.2s' }}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-[15px] font-bold tracking-tight">📈 增速最快</h3>
                  <span className="text-[10px] text-ink-3 font-mono">过去 24 小时</span>
                </div>
                {trending.items.length === 0 ? (
                  <div className="text-[12px] text-ink-3 py-3">暂无足够数据</div>
                ) : (
                  trending.items.map((k, i) => {
                    const color = i % 2 === 0 ? '#7e57f5' : '#14131a';
                    const isNew = k.growthPct >= 9999;
                    const widthPct = Math.min((isNew ? 100 : Math.max(k.growthPct, 0)) / 3.5, 100);
                    return (
                      <div
                        key={k.tag}
                        className="py-2 flex items-center gap-3 fade-up"
                        style={{ animationDelay: `${0.3 + i * 0.05}s` }}
                      >
                        <span className="text-[11px] text-ink-3 w-[18px]">#{i + 1}</span>
                        <span className="flex-1 text-[13px] font-medium">{k.label}</span>
                        <div className="flex-[1.2] h-[5px] bg-aurora-soft rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full fill-bar"
                            style={{ width: `${widthPct}%`, background: color, animationDelay: `${0.5 + i * 0.08}s` }}
                          />
                        </div>
                        <span
                          className="font-mono text-[12px] font-bold text-right"
                          style={{ width: 54, color }}
                        >
                          {isNew ? 'NEW' : `${k.growthPct >= 0 ? '+' : ''}${k.growthPct}%`}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </Glass>

            {/* Source distribution */}
            <Glass className="fade-up" style={{ animationDelay: '0.3s' }}>
              <div className="px-5 py-4">
                <h3 className="text-[15px] font-bold tracking-tight mb-3.5">🌐 信源分布</h3>
                {sources.platforms.length === 0 ? (
                  <div className="text-[12px] text-ink-3 py-3">暂无数据</div>
                ) : (
                  sources.platforms.map((s, i) => (
                    <div key={s.platform} className="mb-3">
                      <div className="flex justify-between items-center mb-1.5">
                        <Pill platform={s.platform as Platform} />
                        <span className="font-mono text-[11px] text-ink-2 font-semibold">{s.pct}%</span>
                      </div>
                      <div className="h-1.5 bg-aurora-soft/60 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full fill-bar"
                          style={{
                            width: `${s.pct}%`,
                            background: `linear-gradient(90deg, ${PLATFORM_COLOR[s.platform as Platform]}, ${PLATFORM_COLOR[s.platform as Platform]}aa)`,
                            animationDelay: `${0.4 + i * 0.08}s`,
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Glass>

            {/* My alerts placeholder (SP-17) */}
            <Glass className="fade-up" style={{ animationDelay: '0.4s' }}>
              <div className="px-5 py-4">
                <div className="flex justify-between items-center mb-3.5">
                  <h3 className="text-[15px] font-bold tracking-tight">🔔 我的提醒</h3>
                  <span className="text-[10px] text-ink-3 font-mono">等 SP-17 接通</span>
                </div>
                <div className="text-[12px] text-ink-3 py-6 text-center">
                  关键词监控功能即将上线
                  <br />
                  <button
                    type="button"
                    disabled
                    className="mt-3 px-3 py-1.5 text-[11px] rounded-full border border-line text-ink-3 cursor-not-allowed opacity-60"
                  >
                    管理监控
                  </button>
                </div>
              </div>
            </Glass>
          </div>
        </div>

        {/* Heat curve */}
        <Glass className="fade-up mt-5" style={{ animationDelay: '0.5s' }}>
          <div className="px-6 py-5">
            <div className="flex justify-between items-baseline mb-4">
              <h3 className="text-[16px] font-bold tracking-tight">🌊 今日热度波形</h3>
              <span className="font-mono text-[11px] text-ink-3">每小时聚合 · 24 小时</span>
            </div>
            <HeatCurve data={heatCurve.buckets} labels={heatCurve.hourLabels} />
          </div>
        </Glass>
      </div>
    </>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${Math.max(1, min)} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}
```

> Important: this DELETES the previous `STATS / TOP_NEWS / TRENDING_KEYWORDS / SOURCE_DISTRIBUTION / ALERTS / HEAT_CURVE` arrays and the inline `HeatCurve` + `MiniSpark` functions. Also removes `<MockupBanner targetSp="SP-9 (HomePage 真数据)" />`.

- [ ] **Step C4.2: Local smoke**

Run: `pnpm dev`

Visit `http://localhost:3000/` in browser:
- Stats cards animate from 0 to real numbers
- Hot list 6 rows real data with HeatBadge
- Trending keywords with stripped labels (no `company:` prefix shown)
- Sources distribution sums to ≈ 100%
- "我的提醒" card shows placeholder + disabled button
- Heat curve renders 24 points
- No MockupBanner anywhere
- No console errors

- [ ] **Step C4.3: Commit**

```bash
git add apps/web/app/page.tsx
git commit -m "feat(sp9): rewire HomePage RSC consuming real Stats API"
```

### Task C5 — Verify lint / typecheck / build

- [ ] **Step C5.1: Run turbo lint + typecheck + test + build**

```bash
pnpm turbo run lint typecheck test build --concurrency=1
```
Expected: ALL PASS

- [ ] **Step C5.2: If any failure, fix inline and re-run**

Common pitfalls:
- Type narrowing for `Platform` cast in `groupPlatforms` keys — already handled with `Object.keys(...) as Platform[]`
- `useEffect` exhaustive-deps lint warning on CountUp — already disabled with eslint comment
- `packages/ui` test infra — already set up (RTL + jsdom from PR #25)

### Task C6 — PR-C submission + final smoke

- [ ] **Step C6.1: Open PR-C**

```bash
git push -u origin feat/sp9-C-homepage-real-data
gh pr create --title "feat(sp9-C): HomePage real data + <CountUp> + <HeatCurve> atoms" --body "$(cat <<'EOF'
Lands SP-9's final piece — HomePage no longer a mockup. Achieves §7.2 M5 MVP milestone (personal-use read-only site).

## Scope
- 2 new \`packages/ui\` atoms: \`<CountUp>\` (RAF tween, first-mount only) and \`<HeatCurve>\` (24-point SVG sparkline, token-driven)
- HomePage (\`apps/web/app/page.tsx\`) rewritten as RSC consuming 4 stat endpoints + reused hot-news heat-sort list, all 5 fetches in parallel
- Removes all 6 mockup arrays + inline HeatCurve/MiniSpark functions
- Removes \`<MockupBanner>\` from /
- \`✨ 生成今日日报\` button disabled with tooltip until SP-21
- \`🔔 我的提醒\` card shows placeholder + disabled button until SP-17

## Smoke check (post-deploy)
- [ ] Visit https://hotnews.shinpeionline.top/ — MockupBanner gone
- [ ] 4 stat cards animate 0→target via RAF
- [ ] Hot list 6 rows real titleZh + HeatBadge colors match heatLevel
- [ ] Trending Top 5 with stripped labels (\`OpenAI\` not \`company:openai\`)
- [ ] Sources distribution sums ≈ 100% across ≤ 4 platforms
- [ ] "我的提醒" card shows placeholder card (no fake MiniSpark)
- [ ] Heat curve renders 24 points; last point is current partial hour
- [ ] PageHeader sub line shows real aggregate / burst / tagged numbers
- [ ] DevTools network: 5 requests to /stats/* + /hot-news, p95 < 200ms total

Spec: docs/superpowers/specs/2026-05-19-sp9-dashboard-stats-design.md
Plan: docs/superpowers/plans/2026-05-19-sp9-dashboard-stats-plan.md PR-C
EOF
)"
```

- [ ] **Step C6.2: CI + merge + deploy**

Watch CI; merge; wait for deploy; run all C6 smoke checks against prod.

- [ ] **Step C6.3: Update decomposition spec §11 with SP-9 row**

Add row to `docs/superpowers/specs/2026-05-01-ai-hot-news-decomposition-design.md` §11 following SP-8 row format:
- date, PR range (PR-A + B + C numbers from gh)
- key outputs (4 endpoints + 2 atoms + HomePage rewire)
- contract impacts (`/stats/*` namespace established; CountUp + HeatCurve usable by SP-11/12)

- [ ] **Step C6.4: Update §13 推进路线提示 with SP-9 completion**

Add a "推进路线提示（更新于 SP-9 完成 YYYY-MM-DD）" section at the end of §13 stating M5 MVP achieved + next is SP-10 (Filter) or SP-11 (detail).

---

## Self-Review Checklist (done after writing this plan)

**1. Spec coverage:**
- §1.1 V1 范围全 5 项（4 API + HomePage + 2 atoms）→ PR-A (today/sources) ✓ / PR-B (heat-curve/trending) ✓ / PR-C (HomePage + CountUp + HeatCurve) ✓
- §0 Q1-Q16 决策 → all referenced in task code blocks (Q4 algorithm in B3, Q5 in B2, Q10 in C1, Q11 in C2, etc.)
- §5 风险 → CountUp first-mount only contract codified in C1 test C1.1 case 2; growthPct 9999 sentinel handled in C4 with "NEW" label

**2. Placeholder scan:** No "TBD" / "TODO" / "fill in later" remain. All code blocks complete.

**3. Type consistency:**
- `StatsTodayDto` field names match: A1.1 declares, A2.1 / A2.3 consumes — ✓
- `StatsSourcesDto.platforms[i].pct` is `number` everywhere — ✓
- `HeatCurveDto.buckets: number[]` consumed as such in C4 — ✓
- `TrendingKeywordsDto.items[i].growthPct` sentinel 9999 — UI threshold C4 uses `>= 9999` ✓
- `<CountUp value={s.v} />` where `s.v` is `number` from StatsTodayDto fields — ✓
- `<HeatCurve data={heatCurve.buckets} labels={heatCurve.hourLabels} />` — types align ✓

All checks pass. Ready to execute.
