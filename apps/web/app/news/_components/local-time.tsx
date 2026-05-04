'use client';

import { useEffect, useState } from 'react';

const SSR_FMT = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const CLIENT_FMT = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function ssrFallback(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${SSR_FMT.format(d)} UTC`;
  } catch {
    return iso;
  }
}

function localized(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return CLIENT_FMT.format(d);
  } catch {
    return iso;
  }
}

export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string>(() => ssrFallback(iso));

  useEffect(() => {
    setText(localized(iso));
  }, [iso]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
