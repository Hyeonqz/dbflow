import './globals.css';
import { ThemeProvider } from '@/components/theme';

export const metadata = { title: 'DBFlow', description: 'DB 변경 형상 관리' };

// FOUC 방지: 첫 페인트 전에 .dark 클래스를 선반영.
const themeScript = `
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || ((!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
