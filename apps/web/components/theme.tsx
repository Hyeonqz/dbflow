'use client';

import { createContext, useContext, useEffect, useState, type ReactNode, type SVGProps } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from '@/components/icons';

export type Theme = 'light' | 'dark' | 'system';

type ThemeContextValue = { theme: Theme; setTheme: (t: Theme) => void };

const ThemeContext = createContext<ThemeContextValue>({ theme: 'system', setTheme: () => {} });

const STORAGE_KEY = 'theme';

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 선택된 theme을 실제 .dark 클래스로 반영. */
function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');

  // 마운트 시 저장값 로드 + 반영
  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  // system일 때만 OS 테마 변경을 실시간 반영
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

const OPTIONS: { value: Theme; label: string; Icon: (p: SVGProps<SVGSVGElement>) => JSX.Element }[] = [
  { value: 'light', label: '라이트', Icon: SunIcon },
  { value: 'dark', label: '다크', Icon: MoonIcon },
  { value: 'system', label: '시스템', Icon: MonitorIcon },
];

/** 사이드바 하단용 컴팩트 3-상태 토글. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="테마 선택"
      className="flex gap-1 rounded-2xl bg-subtle p-1"
    >
      {OPTIONS.map((opt) => {
        const selected = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className={`focusable flex flex-1 items-center justify-center rounded-xl px-2 py-2 text-sm transition-colors ${
              selected ? 'bg-card text-ink ring-1 ring-border-strong' : 'text-muted hover:text-ink'
            }`}
          >
            <opt.Icon width={18} height={18} />
          </button>
        );
      })}
    </div>
  );
}
