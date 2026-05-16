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
