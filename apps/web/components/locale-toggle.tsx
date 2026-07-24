'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE } from '@/i18n/config';

// ponytail: labels are each locale's own native name, so they're intentionally
// not run through the message catalog — they must render the same regardless
// of the active locale (like "Deutsch"/"日本語" in a real language picker).
const OPTIONS = [
  { value: 'en', label: 'EN' },
  { value: 'ko', label: '한' },
] as const;

/** 사이드바 하단용 컴팩트 언어 토글 (ThemeToggle과 동일 톤). */
export function LocaleToggle() {
  const locale = useLocale();
  const router = useRouter();
  const set = (v: string) => {
    document.cookie = `${LOCALE_COOKIE}=${v}; path=/; max-age=31536000`;
    router.refresh();
  };
  return (
    <div role="radiogroup" aria-label="Language" className="flex gap-1 rounded-2xl bg-subtle p-1">
      {OPTIONS.map((opt) => {
        const selected = locale === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => set(opt.value)}
            className={`focusable flex flex-1 items-center justify-center rounded-xl px-2 py-2 text-sm transition-colors ${
              selected ? 'bg-card text-ink ring-1 ring-border-strong font-semibold' : 'text-muted hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
