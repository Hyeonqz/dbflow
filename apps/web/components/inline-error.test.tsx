import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { InlineError } from '@/components/inline-error';
import { renderWithIntl } from '@/test/render-with-intl';

describe('InlineError', () => {
  it('renders nothing when there is no message', () => {
    const { container } = renderWithIntl(<InlineError message="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces an error assertively', () => {
    renderWithIntl(<InlineError message="Apply failed." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Apply failed.');
  });

  it('announces a notice politely', () => {
    renderWithIntl(<InlineError message="Backups unavailable." tone="notice" />);
    expect(screen.getByRole('status')).toHaveTextContent('Backups unavailable.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('exposes an id so a field can describe itself with it', () => {
    renderWithIntl(<InlineError message="Reason required." id="reject-error" />);
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'reject-error');
  });
});
