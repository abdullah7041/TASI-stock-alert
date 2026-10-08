import {cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,test,vi} from 'vitest';
import {ExecutedTradeForm} from '@/app/components/CockpitDetails';
import {buildPortfolioBook} from '@/app/lib/portfolio-core.mjs';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
test('previews explicit account, actual fees and Riyadh time before confirmation and preserves an unchanged retry',async()=>{
 const account=buildPortfolioBook([],[]).accounts[0];
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({projected:{cashSar:40,holdings:[],discrepancies:[]}}))
 .mockResolvedValueOnce(Response.json({error:'Retry later'},{status:503})).mockResolvedValueOnce(Response.json({ok:true}));
 vi.stubGlobal('fetch',fetcher);const onSaved=vi.fn();
 render(<ExecutedTradeForm portfolio={account} onSaved={onSaved}/>);
 expect((screen.getByLabelText('Fees (SAR)') as HTMLInputElement).value).toBe('');
 await userEvent.type(screen.getByLabelText('Stock code'),'1303');await userEvent.type(screen.getByLabelText('Company name'),'EIC');
 await userEvent.type(screen.getByLabelText('Executed shares'),'3');await userEvent.type(screen.getByLabelText('Execution price (SAR)'),'31.25');
 await userEvent.type(screen.getByLabelText('Fees (SAR)'),'0');
 fireEvent.change(screen.getByLabelText('Transaction time (Riyadh)'),{target:{value:'2026-11-01T00:30'}});
 await userEvent.click(screen.getByRole('button',{name:'Preview record'}));
 await screen.findByRole('button',{name:'Confirm record'});expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('/api/portfolio/preview');
 const preview=JSON.parse(fetcher.mock.calls[0][1].body);expect(preview.accountId).toBe('al_rajhi');expect(preview.expectedRevision).toBe(0);
 expect(preview.record.payload.feesSar).toBe(0);expect(preview.record.payload.occurredAt).toBe('2026-10-31T21:30:00.000Z');
 await userEvent.click(screen.getByRole('button',{name:'Confirm record'}));await screen.findByText('Retry later');
 await userEvent.click(screen.getByRole('button',{name:'Confirm record'}));await waitFor(()=>expect(onSaved).toHaveBeenCalledTimes(1));
 expect(JSON.parse(fetcher.mock.calls[1][1].body).record.operationId).toBe(preview.record.operationId);
 expect(JSON.parse(fetcher.mock.calls[2][1].body).record.operationId).toBe(preview.record.operationId);
},20000);
