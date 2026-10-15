import {cleanup,render,screen,fireEvent,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,test,vi} from 'vitest';
import {PortfolioAccounts} from '@/app/components/PortfolioAccounts';
import {buildPortfolioBook} from '@/app/lib/portfolio-core.mjs';
import type {AccountRecord} from '@/app/lib/evidence-types';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const records: AccountRecord[]=['al_rajhi','al_ahli'].map((accountId,i)=>({accountId,operationId:accountId,revision:1,recordedAt:'2026-10-08T08:00:00Z',kind:'event',payload:{kind:'opening_balance',cashSar:i?400:300,holdings:[],occurredAt:'2026-10-01T08:00:00Z',provenance:{source:'manual'}}})) as AccountRecord[];

test('correction targets identify the actual transaction and history shows the replacement details',async()=>{
 const activity:AccountRecord[]=[...records,...[25,40].map((cashSar,i)=>({accountId:'al_rajhi',operationId:`opaque-${i}`,revision:i+2,recordedAt:'2026-10-08T08:00:00Z',kind:'event',payload:{kind:'contribution',cashSar,occurredAt:`2026-10-0${i+2}T08:00:00Z`,provenance:{source:'manual'}}})) as AccountRecord[],
 {accountId:'al_rajhi',operationId:'opaque-correction',revision:4,recordedAt:'2026-10-08T08:00:00Z',kind:'correction',payload:{targetOperationId:'opaque-1',reason:'Corrected receipt amount',replacement:{kind:'contribution',cashSar:45,occurredAt:'2026-10-03T08:00:00Z',provenance:{source:'manual'}}}}];
 render(<PortfolioAccounts book={buildPortfolioBook(activity,[])} accountId="al_rajhi" onAccountChange={()=>{}} onSaved={()=>{}}/>);
 await userEvent.selectOptions(screen.getByLabelText('Activity'),'correction');
 const targets=screen.getByLabelText('Original event');
 expect(within(targets).getByRole('option',{name:/25.00 SAR.*2 Oct 2026.*Revision 2/})).toBeTruthy();
 expect(within(targets).getByRole('option',{name:/40.00 SAR.*3 Oct 2026.*Revision 3/})).toBeTruthy();
 await userEvent.selectOptions(targets,'opaque-1');
 expect((targets as HTMLSelectElement).value).toBe('opaque-1');
 await userEvent.click(screen.getByText('Al Rajhi activity history (4)'));
 expect(screen.getByText(/Correction.*45.00 SAR.*Corrected receipt amount/)).toBeTruthy();
});
test('combined reporting shows both brokers and requires explicit selection before any write',()=>{
 render(<PortfolioAccounts book={buildPortfolioBook(records,[])} accountId={null} onAccountChange={()=>{}} onSaved={()=>{}}/>);
 expect(screen.getByText('Select a broker account to record activity.')).toBeTruthy();
 expect(screen.getByText(/700.00 SAR.*reporting only/i)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Confirm record'})).toBeNull();
});
test('combined exposure aggregates the same company across independent brokers',()=>{
 const positions=structuredClone(records);
 positions.forEach((r,i)=>{if(r.kind==='event')r.payload.holdings=[{code:'2320',name:'Al-Babtain',shares:i?3:2}];});
 render(<PortfolioAccounts book={buildPortfolioBook(positions,[])} accountId={null} onAccountChange={()=>{}} onSaved={()=>{}} prices={[{code:'2320',price:10,asOf:'2026-10-08'}]}/>);
 const exposure=screen.getByText(/^Holding value:/).textContent;
 expect(exposure).toContain('2320: 50.00 SAR (2026-10-08) · 100.0%');
 expect(exposure?.match(/2320:/g)).toHaveLength(1);
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

test.each(['network','readback'])('an ambiguous %s save can retry the exact operation after a refresh advances the revision',async(failure)=>{
 const book=buildPortfolioBook(records,[]);
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({projected:{...book.accounts[0],cashSar:340}}))
 .mockImplementationOnce(()=>failure==='network'?Promise.reject(new Error('Response lost')):Promise.resolve(Response.json({error:'Response lost'},{status:503}))).mockResolvedValueOnce(Response.json({}));
 vi.stubGlobal('fetch',fetcher);
 const props={accountId:'al_rajhi' as const,onAccountChange:()=>{},onSaved:()=>{}};
 const view=render(<PortfolioAccounts book={book} {...props}/>);
 await userEvent.type(screen.getByLabelText('Amount (SAR)'),'40');
 fireEvent.change(screen.getByLabelText('Transaction time (Riyadh)'),{target:{value:'2026-10-08T12:00'}});
 await userEvent.click(screen.getByRole('button',{name:'Preview record'}));
 await userEvent.click(await screen.findByRole('button',{name:'Confirm record'}));
 await screen.findByText('Response lost');
 view.rerender(<PortfolioAccounts book={{...book,accounts:[{...book.accounts[0],revision:2,cashSar:340},book.accounts[1]]}} {...props}/>);
 await userEvent.click(screen.getByRole('button',{name:'Retry confirmation'}));
 await screen.findByText('Account record confirmed. No order was sent.');
 expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[1][1].body);
},20000);
