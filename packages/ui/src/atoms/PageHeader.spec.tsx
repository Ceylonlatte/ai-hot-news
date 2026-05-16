import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders title and subtitle', () => {
    render(<PageHeader title="Hot News" subtitle="real-time aggregation" />);
    expect(screen.getByText('Hot News')).toBeInTheDocument();
    expect(screen.getByText('real-time aggregation')).toBeInTheDocument();
  });

  it('renders title only when subtitle is omitted', () => {
    render(<PageHeader title="Vault" />);
    expect(screen.getByText('Vault')).toBeInTheDocument();
  });

  it('renders right slot when provided (e.g., sort dropdown placeholder)', () => {
    render(<PageHeader title="x" right={<button>sort</button>} />);
    expect(screen.getByRole('button', { name: 'sort' })).toBeInTheDocument();
  });
});
