import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { PageHeader } from '@/components/page-header';
import { renderWithIntl } from '@/test/render-with-intl';

describe('test infrastructure', () => {
  it('renders a component through the @/ alias with the JSX transform', () => {
    renderWithIntl(<PageHeader title="Add index" description="ops-42" />);
    expect(screen.getByRole('heading', { name: 'Add index' })).toBeInTheDocument();
    expect(screen.getByText('ops-42')).toBeInTheDocument();
  });
});
