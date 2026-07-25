import type { Locale } from './locale';
import { DEFAULT_LOCALE } from './locale';

type Catalog = Record<string, string>;

const en: Catalog = {
  'changeRequest.notFound': 'Change request not found.',
  'changeRequest.submitRequiresAssignees': 'Submitting requires 1 reviewer and {required} approver(s).',
};

const ko: Catalog = {
  'changeRequest.notFound': '변경요청을 찾을 수 없습니다.',
  'changeRequest.submitRequiresAssignees': '제출하려면 검토자 1명과 결재자 {required}명을 지정해야 합니다.',
};

const MESSAGES: Record<Locale, Catalog> = { en, ko };

export function translate(key: string, locale: Locale, args?: Record<string, string | number>): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (!args) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (args[k] !== undefined ? String(args[k]) : `{${k}}`));
}

export { MESSAGES };
