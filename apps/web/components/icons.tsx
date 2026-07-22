import type { SVGProps } from 'react';

// Lucide 스타일 단색 라인 아이콘. 이모지(플랫폼별 렌더 불일치) 대체용.
// stroke=currentColor 이므로 text-* 색을 따라간다.
function Base({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Base>
);

export const ClipboardIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9V4Z" />
    <path d="M9 10h6M9 14h6M9 18h4" />
  </Base>
);

export const DiffIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M6 8.5v7" />
    <path d="M14 6h3a2 2 0 0 1 2 2v9" />
    <path d="m16.5 15 2.5 2.5 2.5-2.5" />
  </Base>
);

export const DatabaseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <ellipse cx="12" cy="5.5" rx="7" ry="2.75" />
    <path d="M5 5.5v6c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75v-6" />
    <path d="M5 11.5v6c0 1.5 3.1 2.75 7 2.75s7-1.25 7-2.75v-6" />
  </Base>
);

export const MenuIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Base>
);

export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Base>
);

export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Base>
);

export const MonitorIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Base>
);

export const UsersIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 4.5a3.25 3.25 0 0 1 0 6.5" />
    <path d="M17 13.3a5.5 5.5 0 0 1 3.5 5.1" />
  </Base>
);

export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.6 3 7.9 7 9 4-1.1 7-4.4 7-9V6l-7-2.5Z" />
    <path d="m9 12 2 2 4-4.5" />
  </Base>
);

export const ShieldCheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.6 3 7.9 7 9 4-1.1 7-4.4 7-9V6l-7-2.5Z" />
    <path d="M9 11.5h6M9 14.5h4" />
  </Base>
);

export const UsersCheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="m15.5 12.5 2 2 3.5-3.5" />
  </Base>
);

export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M8 3v4M16 3v4M3.5 9.5h17" />
    <path d="M8 13.5h8" />
  </Base>
);

export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M10.3 3.9 2.4 17a1.9 1.9 0 0 0 1.6 2.9h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Base>
);

export const UserSwitchIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="8" cy="8" r="3.25" />
    <path d="M2.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.5h5.5M19 3l2.5 2.5L19 8" />
    <path d="M21.5 13h-5.5M18.5 10.5 16 13l2.5 2.5" />
  </Base>
);
