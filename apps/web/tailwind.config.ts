import type { Config } from 'tailwindcss';
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 시맨틱 토큰 (§12.2) — CSS 변수 참조. 라이트/다크 값은 globals.css에서 정의.
        bg: 'var(--bg)',
        card: 'var(--card)',
        subtle: 'var(--subtle)',
        border: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        primary: { DEFAULT: 'var(--primary)', dark: 'var(--primary-dark)' },
        code: { DEFAULT: 'var(--code)', fg: 'var(--code-fg)' },
        // 하위호환: 기존 bg-surface 사용처를 페이지 배경으로 유지
        surface: 'var(--bg)',
      },
      borderRadius: { '2xl': '20px' },
    },
  },
  plugins: [],
};
export default config;
