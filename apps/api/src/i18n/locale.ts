export type Locale = 'en' | 'ko';
export const LOCALES: Locale[] = ['en', 'ko'];
export const DEFAULT_LOCALE: Locale = 'en';

export function resolveLocale(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const primary = acceptLanguage.split(',')[0]?.trim().split('-')[0]?.toLowerCase();
  return (LOCALES as string[]).includes(primary ?? '') ? (primary as Locale) : DEFAULT_LOCALE;
}
