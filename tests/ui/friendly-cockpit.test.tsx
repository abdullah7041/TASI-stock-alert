import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ActionCockpit } from '@/app/components/ActionCockpit';
import type { DashboardPayload } from '@/app/lib/dashboard-types';
import saved from '../fixtures/friendly-dashboard.json';

const payload = { snapshot: saved, freshness:'current', alerts:[] } as unknown as DashboardPayload;
afterEach(()=>{ cleanup();vi.unstubAllGlobals(); });
function start(){vi.stubGlobal('fetch',vi.fn(async()=>Response.json(payload)));return render(<ActionCockpit dashboard={payload}/>);}
test('all holdings are visible on home, details and diagnostics stay one click away',async()=>{
  start();
  const holdings=screen.getByRole('region',{name:'My holdings'});
  expect(within(holdings).getByRole('button',{name:/EIC/})).toBeTruthy();
  expect(within(holdings).getByRole('button',{name:/Al-Babtain/})).toBeTruthy();
  expect(within(holdings).getByRole('button',{name:/Rasan/})).toBeTruthy();
  expect(screen.queryByText(/Everything else/)).toBeNull();
  expect(screen.queryByText(/no known provider/)).toBeNull();
  await userEvent.click(within(holdings).getByRole('button',{name:/EIC/}));
  const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByRole('img',{name:/3-month price/})).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:/Data status/}));
  expect(screen.getByRole('dialog').textContent).toMatch(/no known provider/);
});
test('unavailable checks are explicit and market date differs from generated time',()=>{
  start();
  expect(screen.getByText('Some checks unavailable')).toBeTruthy();
  expect(screen.getByText(/Prices through/)).toBeTruthy();
  expect(screen.queryByText(/Market observed/)).toBeNull();
});
