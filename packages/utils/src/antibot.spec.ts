import { describe, expect, it } from 'vitest';
import { detectAntiBotPage, isAntiBotPage } from './antibot';

describe('detectAntiBotPage', () => {
  it('detects classic Reddit network-security block page (real prod sample)', () => {
    const text =
      "You've been blocked by network security.\n\nTo continue, log in to your Reddit account or use your developer token";
    const v = detectAntiBotPage(text);
    expect(v.isAntiBot).toBe(true);
    expect(v.reason).toContain('blocked by network security');
  });

  it('detects Cloudflare "Just a moment..." challenge', () => {
    expect(isAntiBotPage('Just a moment...')).toBe(true);
    expect(isAntiBotPage('Checking your browser before accessing the site')).toBe(true);
  });

  it('detects Cloudflare ray-id footer', () => {
    expect(isAntiBotPage('Access denied. Cloudflare Ray ID: 8a1f9c2d')).toBe(true);
  });

  it('detects "verify you are human" challenge', () => {
    expect(isAntiBotPage('Please verify you are human to continue.')).toBe(true);
    expect(isAntiBotPage("Verify you're human by completing the action below.")).toBe(true);
  });

  it('detects access denied / 403', () => {
    expect(isAntiBotPage('Access denied')).toBe(true);
    expect(isAntiBotPage('403 Forbidden')).toBe(true);
  });

  it('detects login-wall short pages', () => {
    expect(isAntiBotPage('Log in to continue reading.')).toBe(true);
    expect(isAntiBotPage('Create a free account to read.')).toBe(true);
  });

  it('detects rate-limit short pages', () => {
    expect(isAntiBotPage('Rate limit exceeded. Try again later.')).toBe(true);
    expect(isAntiBotPage('Too many requests. Slow down.')).toBe(true);
  });

  it('does NOT flag a real article that mentions captcha in body', () => {
    const longArticle =
      'In this post, we benchmark CAPTCHA-solving accuracy of GPT-4o and Claude 3.5 against open-source vision models. ' +
      'a'.repeat(700);
    expect(isAntiBotPage(longArticle)).toBe(false);
  });

  it('does NOT flag a real article that mentions rate limit in body', () => {
    const longArticle =
      'OpenAI raised the rate limit ceiling on the GPT-4 endpoint last week, allowing developers to make 10x more calls. ' +
      'b'.repeat(700);
    expect(isAntiBotPage(longArticle)).toBe(false);
  });

  it('does NOT flag empty or null-ish input', () => {
    expect(isAntiBotPage('')).toBe(false);
    expect(isAntiBotPage('   ')).toBe(false);
    expect(isAntiBotPage(null as unknown as string)).toBe(false);
    expect(isAntiBotPage(undefined as unknown as string)).toBe(false);
  });

  it('does NOT flag a normal short summary that has no signature', () => {
    expect(isAntiBotPage('OpenAI 发布了 GPT-5，性能大幅提升。')).toBe(false);
  });

  it('returns reason as the matched regex source for debug logs', () => {
    const v = detectAntiBotPage('captcha required');
    expect(v.isAntiBot).toBe(true);
    expect(v.reason).toBeTruthy();
  });
});
