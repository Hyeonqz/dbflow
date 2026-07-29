import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

/**
 * 실제 en 카탈로그로 감싸 렌더한다.
 * - 스텁 메시지를 쓰면 t() 단언이 자기 픽스처를 검사하는 꼴이 되므로 실제 카탈로그를 쓴다.
 * - timeZone은 명시해야 한다. useTimeZone()은 미설정 시 throw하지 않고 undefined를
 *   반환하는데, 호출부가 non-null 단언을 하고 있어 조용히 Intl에 undefined가 들어간다.
 */
export function renderWithIntl(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Seoul">
      {ui}
    </NextIntlClientProvider>,
  );
}
