import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,test,vi} from 'vitest';
import {PortfolioAccounts} from '@/app/components/PortfolioAccounts';
import {buildPortfolioBook} from '@/app/lib/portfolio-core.mjs';
import type {AccountRecord} from '@/app/lib/evidence-types';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const records: AccountRecord[]=['al_rajhi','al_ahli'].map((accountId,i)=>({accountId,operationId:accountId,revision:1,recordedAt:'2026-10-08T08:00:00Z',kind:'event',payload:{kind:'opening_balance',cashSar:i?400:300,holdings:[],occurredAt:'2026-10-01T08:00:00Z',provenance:{source:'manual'}}})) as AccountRecord[];
test('combined reporting shows both brokers and requires explicit selection before any write',()=>{
 render(<PortfolioAccounts book={buildPortfolioBook(records,[])} accountId={null} onAccountChange={()=>{}} onSaved={()=>{}}/>);
 expect(screen.getByText('Select a broker account to record activity.')).toBeTruthy();
 expect(screen.getByText(/700.00 SAR.*reporting only/i)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Confirm record'})).toBeNull();
});
test('a revision conflict retains the draft, requires another preview, and changed fields get a new operation',async()=>{
 const book=buildPortfolioBook(records,[]);
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({projected:{...book.accounts[0],cashSar:340}}))
 .mockResolvedValueOnce(Response.json({error:'Refresh and preview again'},{status:409}))
 .mockResolvedValueOnce(Response.json({projected:{...book.accounts[0],cashSar:341}}));vi.stubGlobal('fetch',fetcher);
 render(<PortfolioAccounts book={book} accountId="al_rajhi" onAccountChange={()=>{}} onSaved={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Activity'),{target:{value:'contribution'}});
 await userEvent.type(screen.getByLabelText('Amount (SAR)'),'40');
 fireEvent.change(screen.getByLabelText('Transaction time (Riyadh)'),{target:{value:'2026-10-08T12:00'}});
 await userEvent.click(screen.getByRole('button',{name:'Preview record'}));await screen.findByRole('button',{name:'Confirm record'});
 await userEvent.click(screen.getByRole('button',{name:'Confirm record'}));await screen.findByText('Refresh and preview again');
 expect((screen.getByLabelText('Amount (SAR)') as HTMLInputElement).value).toBe('40');expect(screen.queryByRole('button',{name:'Confirm record'})).toBeNull();
 await userEvent.type(screen.getByLabelText('Amount (SAR)'),'1');await userEvent.click(screen.getByRole('button',{name:'Preview record'}));await screen.findByRole('button',{name:'Confirm record'});
 expect(JSON.parse(fetcher.mock.calls[0][1].body).record.operationId).not.toBe(JSON.parse(fetcher.mock.calls[2][1].body).record.operationId);
},20000);
