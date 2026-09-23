import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ExecutedTradeForm } from '@/app/components/CockpitDetails';
import type { PortfolioView } from '@/app/lib/evidence-types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('records actual execution inputs, retries the same operation, and clears a successful trade', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Retry later' }, { status: 503 })).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const onSaved = vi.fn();
  render(<ExecutedTradeForm portfolio={{ holdings: [{ code: '1234', name: 'Example', shares: 10, avgCostSar: 30 }], cashSar: 500, proposal: null, confirmedAt: '2026-09-06T06:00:00Z', contributionMonth: null } as PortfolioView} onSaved={onSaved} />);
  expect((screen.getByLabelText('Executed shares') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Execution price (SAR)') as HTMLInputElement).value).toBe('');
  await userEvent.type(screen.getByLabelText('Stock code'), '1234');
  await userEvent.type(screen.getByLabelText('Executed shares'), '3');
  await userEvent.type(screen.getByLabelText('Execution price (SAR)'), '31.25');
  await userEvent.click(screen.getByRole('button', { name: 'Record executed trade' }));
  await screen.findByText('Retry later');
  await userEvent.click(screen.getByRole('button', { name: 'Record executed trade' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  const first = JSON.parse(fetcher.mock.calls[0][1].body);
  const second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(first.shares).toBe(3); expect(first.priceSar).toBe(31.25);
  expect(second.operationId).toBe(first.operationId);
  expect((screen.getByLabelText('Executed shares') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Execution price (SAR)') as HTMLInputElement).value).toBe('');
}, 15000);
