'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Route } from 'next';

// SP-13 (2026-05-23): /login client form.
//
// Submits username+password to /api/auth/login (BFF → API). On 200 the
// Set-Cookie header from upstream (ahn_session=<JWT>) reaches the
// browser via proxyToApi's relay, then we router.refresh() to re-render
// any RSC that uses getCurrentUser() (sidebar / future protected pages).
//
// `next` query param honored: /login?next=/radar → after login push to /radar.
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError('用户名或密码错误');
        } else if (res.status === 400) {
          setError('输入格式不正确');
        } else {
          setError(`登录失败 (${res.status})`);
        }
        return;
      }
      // Success — Set-Cookie was already applied by the browser.
      // router.push + refresh re-renders RSC with the new cookie.
      // `as Route` cast needed: typedRoutes=true rejects raw strings
      // for dynamic next values (next can be any internal path).
      router.push((next || '/') as Route);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-ink-3 mb-1.5">
          用户名
        </label>
        <input
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={64}
          className="w-full px-3.5 py-2 rounded-lg bg-white/65 border border-line text-[14px] text-ink placeholder-ink-3 focus:outline-none focus:border-aurora focus:bg-white transition-all"
        />
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-ink-3 mb-1.5">
          密码
        </label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={200}
          className="w-full px-3.5 py-2 rounded-lg bg-white/65 border border-line text-[14px] text-ink focus:outline-none focus:border-aurora focus:bg-white transition-all"
        />
      </div>
      {error ? (
        <div className="text-[13px] text-red-600" role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={loading || password.length === 0}
        className="w-full px-4 py-2 rounded-lg text-white text-[14px] font-semibold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'var(--grad)' }}
      >
        {loading ? '登录中...' : '登录'}
      </button>
    </form>
  );
}
