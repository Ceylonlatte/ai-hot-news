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
