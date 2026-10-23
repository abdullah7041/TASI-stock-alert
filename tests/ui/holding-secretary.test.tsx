import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,test,vi} from 'vitest';
import {CopilotRail} from '@/app/components/CopilotRail';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const profile={objective:'Preserve purchasing power',horizon:'Five years',contributions:'Only when confirmed',riskSettings:'Discuss risks first',constraints:'No borrowing',revision:1,confirmedAt:'2026-10-22T08:00:00Z',operationId:'profile-1'};
const company={symbol:'2320',name:'Al-Babtain',accounts:[{accountId:'al_rajhi',revision:2,shares:20},{accountId:'al_ahli',revision:4,shares:5}]};
const caseDraft={symbol:'2320',reasons:'Owner reason',supportingEvidence:'Latest report needs reading',risks:'Demand risk',reconsiderWhen:'Evidence contradicts the reason',sourceRefs:['https://www.saudiexchange.sa/report']};
const empty={profile:null,cases:[],caseHistory:[],reviews:[],acknowledgedReviewIds:[]};
const response=(secretary:unknown=empty,holdingCompanies:unknown[]=[company])=>({messages:[],decisions:[],secretary,holdingCompanies});

test('guides explicit profile and case confirmation using only confirmed holdings',async()=>{
  const bodies:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',async(_url:unknown,options?:RequestInit)=>{
    if(options?.method!=='POST')return Response.json(response());
    const body=JSON.parse(String(options.body));bodies.push(body);
    if(body.operation==='save_profile')return Response.json(response({...empty,profile:{...body.profile,...profile}}));
    if(body.operation==='draft_case')return Response.json({...response({...empty,profile}),caseDraft});
    return Response.json(response({...empty,profile,cases:[{...body.case,revision:1,profileRevision:1,operationId:body.operationId,confirmedAt:'2026-10-22T09:00:00Z'}],caseHistory:[{...body.case,revision:1,profileRevision:1,operationId:body.operationId,confirmedAt:'2026-10-22T09:00:00Z'}]}));
  });
  render(<CopilotRail/>);
  await screen.findByRole('heading',{name:'Holdings secretary'});
  expect(bodies).toHaveLength(0);
  expect((screen.getByLabelText('Confirmed holding') as HTMLSelectElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button',{name:'Confirm investor profile'}));
  await screen.findByText(/Profile revision 1/);
  await userEvent.selectOptions(screen.getByLabelText('Confirmed holding'),'2320');
  expect(screen.getByText(/Al Rajhi.*20 shares.*revision 2/)).toBeTruthy();
  expect(screen.getByText(/Al Ahli.*5 shares.*revision 4/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button',{name:'Draft company case'}));
  const reasons=await screen.findByLabelText('Reasons for holding');
  fireEvent.change(reasons,{target:{value:'My reviewed reason'}});
  expect(bodies.filter(b=>b.operation==='confirm_case')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button',{name:'Confirm company case'}));
  await screen.findByText('Case history (1)');
  expect(bodies.at(-1)).toMatchObject({operation:'confirm_case',case:{reasons:'My reviewed reason'},expectedRevision:0,profileRevision:1});
  expect(screen.queryByLabelText('Reasons for holding')).toBeNull();
});

test('preserves the exact profile operation after an uncertain response and replaces it after an edit',async()=>{
  const bodies:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',async(_url:unknown,options?:RequestInit)=>{
    if(options?.method!=='POST')return Response.json(response());
    bodies.push(JSON.parse(String(options.body)));
    throw new Error('Response lost');
  });
  render(<CopilotRail/>);
  await userEvent.click(await screen.findByRole('button',{name:'Confirm investor profile'}));
  await screen.findByText('Response lost');
  await userEvent.click(screen.getByRole('button',{name:'Confirm investor profile'}));
  await waitFor(()=>expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual(bodies[0]);
  fireEvent.change(screen.getByLabelText('Investment objective'),{target:{value:'Changed objective'}});
  await userEvent.click(screen.getByRole('button',{name:'Confirm investor profile'}));
  await waitFor(()=>expect(bodies).toHaveLength(3));
  expect(bodies[2].operationId).not.toBe(bodies[1].operationId);
  expect(bodies[2].profile).toMatchObject({objective:'Changed objective'});
});

test('a case revision conflict preserves the edited case and offers refresh before another confirmation',async()=>{
  const bodies:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',async(_url:unknown,options?:RequestInit)=>{
    if(options?.method!=='POST')return Response.json(response({...empty,profile}));
    const body=JSON.parse(String(options.body));bodies.push(body);
    if(body.operation==='draft_case')return Response.json({...response({...empty,profile}),caseDraft});
    return Response.json({error:'Case revision changed'},{status:409});
  });
  render(<CopilotRail/>);
  await userEvent.selectOptions(await screen.findByLabelText('Confirmed holding'),'2320');
  await userEvent.click(screen.getByRole('button',{name:'Draft company case'}));
  fireEvent.change(await screen.findByLabelText('Risks'),{target:{value:'My risk assessment'}});
  await userEvent.click(screen.getByRole('button',{name:'Confirm company case'}));
  expect((await screen.findByRole('alert')).textContent).toMatch(/refresh/i);
  expect((screen.getByLabelText('Risks') as HTMLTextAreaElement).value).toBe('My risk assessment');
  expect((screen.getByRole('button',{name:'Confirm company case'}) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button',{name:'Refresh saved context'}));
  expect((screen.getByLabelText('Risks') as HTMLTextAreaElement).value).toBe('My risk assessment');
  expect(bodies.filter(b=>b.operation==='confirm_case')).toHaveLength(1);
});

test('restores saved context and acknowledges a provisional review without changing its case',async()=>{
  const savedCase={...caseDraft,revision:2,profileRevision:1,confirmedAt:'2026-10-21T08:00:00Z',operationId:'case-2'};
  const review={id:'review-1',symbol:'2320',fingerprint:'fp',caseRevision:2,profileRevision:1,createdAt:'2026-10-22T12:30:00Z',status:'provisional',action:'RESEARCH_MORE',changed:'New disclosure title',supporting:'No full report checked',contrary:'Demand could weaken',implications:'Read the report',missing:'Full disclosure',questions:'Does demand remain intact?',sourceRefs:['https://www.saudiexchange.sa/report'],accounts:company.accounts};
  const view={...empty,profile,cases:[savedCase],caseHistory:[savedCase],reviews:[review]};
  const bodies:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',async(_url:unknown,options?:RequestInit)=>{
    if(options?.method!=='POST')return Response.json(response(view));
    bodies.push(JSON.parse(String(options.body)));
    return Response.json(response({...view,acknowledgedReviewIds:['review-1']}));
  });
  render(<CopilotRail/>);
  expect((await screen.findByLabelText('Investment objective') as HTMLTextAreaElement).value).toBe(profile.objective);
  const card=screen.getByRole('article',{name:'2320 review'});
  expect(within(card).getByText(/provisional/)).toBeTruthy();
  expect(within(card).getByText('2026-10-22T12:30:00Z',{selector:'time'})).toBeTruthy();
  expect(within(card).getByRole('link').getAttribute('href')).toBe('https://www.saudiexchange.sa/report');
  await userEvent.click(within(card).getByRole('button',{name:'Acknowledge review'}));
  await within(card).findByText('Acknowledged');
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({operation:'acknowledge_review',reviewId:'review-1'});
  expect(screen.getByText('Case history (1)')).toBeTruthy();
});

test('missing confirmed holdings are a setup gap and never become invented company options',async()=>{
  vi.stubGlobal('fetch',async()=>Response.json(response({...empty,profile},[])));
  render(<CopilotRail/>);
  expect((await screen.findByText(/Confirm a broker opening snapshot/)).textContent).toMatch(/unavailable/i);
  expect(screen.queryByRole('button',{name:'Draft company case'})).toBeNull();
});

test('case retries retain the same reviewed payload and multiline source edits create a new operation',async()=>{
  const bodies:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',async(_url:unknown,options?:RequestInit)=>{
    if(options?.method!=='POST')return Response.json(response({...empty,profile}));
    const body=JSON.parse(String(options.body));
    if(body.operation==='draft_case')return Response.json({...response({...empty,profile}),caseDraft});
    bodies.push(body);return Response.json({error:'Save response unavailable'},{status:503});
  });
  render(<CopilotRail/>);
  await userEvent.selectOptions(await screen.findByLabelText('Confirmed holding'),'2320');
  await userEvent.click(screen.getByRole('button',{name:'Draft company case'}));
  await userEvent.click(await screen.findByRole('button',{name:'Confirm company case'}));
  await screen.findByText('Save response unavailable');
  await userEvent.click(screen.getByRole('button',{name:'Confirm company case'}));
  await waitFor(()=>expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual(bodies[0]);
  const refs=screen.getByLabelText('Supporting source references (one per line)');
  fireEvent.change(refs,{target:{value:'https://www.saudiexchange.sa/report\n'}});
  await userEvent.type(refs,'https://www.saudiexchange.sa/second');
  await userEvent.click(screen.getByRole('button',{name:'Confirm company case'}));
  await waitFor(()=>expect(bodies).toHaveLength(3));
  expect(bodies[2].operationId).not.toBe(bodies[1].operationId);
  expect(bodies[2].case).toMatchObject({sourceRefs:['https://www.saudiexchange.sa/report','https://www.saudiexchange.sa/second']});
},10000);

test('review sources keep publication and retrieval dates separate and expose unknown provenance honestly',async()=>{
  const review={id:'dated-review',symbol:'2320',fingerprint:'fp',caseRevision:1,profileRevision:1,createdAt:'2026-10-22T12:30:00Z',status:'incomplete',action:'RESEARCH_MORE',changed:'Announcement title only',supporting:'',contrary:'',implications:'Read source first',missing:'Full disclosure content',questions:'What did the company publish?',sourceRefs:['https://www.saudiexchange.sa/report','https://www.saudiexchange.sa/undated'],accounts:company.accounts,sources:[{url:'https://www.saudiexchange.sa/report',publishedAt:'2026-10-20T10:00:00Z',retrievedAt:'2026-10-22T12:15:00Z',reviewedAt:null,kind:'announcement'}],evidenceRevisions:['evidence-rev-7'],collectionRunId:'collection-run-22'};
  vi.stubGlobal('fetch',async()=>Response.json(response({...empty,profile,reviews:[review]})));
  render(<CopilotRail/>);
  const card=await screen.findByRole('article',{name:'2320 review'});
  expect(within(card).getByText(/Published: 2026-10-20T10:00:00Z/)).toBeTruthy();
  expect(within(card).getByText(/Retrieved: 2026-10-22T12:15:00Z/)).toBeTruthy();
  expect(within(card).getAllByText(/Reviewed: unknown/)).toHaveLength(2);
  expect(within(card).getByText(/Published: unknown/)).toBeTruthy();
  expect(within(card).getByText(/Title only.*read.*source/i)).toBeTruthy();
  await userEvent.click(within(card).getByText('Review provenance'));
  expect(within(card).getByText(/collection-run-22/)).toBeTruthy();
  expect(within(card).getByText(/evidence-rev-7/)).toBeTruthy();
});

test('an unavailable assistant still permits the owner to write and explicitly confirm a company case',async()=>{
  let confirmed:Record<string,unknown>|null=null;
  vi.stubGlobal('fetch',async(_url:unknown,options?:RequestInit)=>{
    if(options?.method!=='POST')return Response.json(response({...empty,profile}));
    const body=JSON.parse(String(options.body));
    if(body.operation==='draft_case')return Response.json({error:'Assistant not configured'},{status:503});
    confirmed=body;
    return Response.json(response({...empty,profile}));
  });
  render(<CopilotRail/>);
  await userEvent.selectOptions(await screen.findByLabelText('Confirmed holding'),'2320');
  await userEvent.click(screen.getByRole('button',{name:'Draft company case'}));
  await screen.findByText('Assistant not configured');
  await userEvent.click(screen.getByRole('button',{name:'Write company case'}));
  for(const [label,value] of Object.entries({'Reasons for holding':'My own reason','Supporting evidence':'Evidence missing','Risks':'Known uncertainty','When to reconsider':'Evidence changes'}))fireEvent.change(screen.getByLabelText(label),{target:{value}});
  await userEvent.click(screen.getByRole('button',{name:'Confirm company case'}));
  await screen.findByText('Company case confirmed. Holdings were not changed.');
  expect(confirmed).toMatchObject({operation:'confirm_case',case:{symbol:'2320',reasons:'My own reason',sourceRefs:[]},expectedRevision:0,profileRevision:1});
});

test('refresh exposes a concurrently changed confirmed profile before rebinding an edited case to its revision',async()=>{
  const updatedProfile={...profile,revision:2,objective:'Preserve capital for a near-term purchase',constraints:'No additional contributions; retain each broker separately',operationId:'profile-2',confirmedAt:'2026-10-23T09:00:00Z'};
  let savedProfile=profile;
  const confirmations:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',async(_url:unknown,options?:RequestInit)=>{
    if(options?.method!=='POST')return Response.json(response({...empty,profile:savedProfile}));
    const body=JSON.parse(String(options.body));
    if(body.operation==='draft_case')return Response.json({...response({...empty,profile}),caseDraft});
    confirmations.push(body);
    if(confirmations.length===1){savedProfile=updatedProfile;return Response.json({error:'Profile revision changed'},{status:409});}
    return Response.json(response({...empty,profile:savedProfile}));
  });
  render(<CopilotRail/>);
  await userEvent.selectOptions(await screen.findByLabelText('Confirmed holding'),'2320');
  await userEvent.click(screen.getByRole('button',{name:'Draft company case'}));
  fireEvent.change(await screen.findByLabelText('Reasons for holding'),{target:{value:'My preserved case assessment'}});
  await userEvent.click(screen.getByRole('button',{name:'Confirm company case'}));
  await screen.findByText(/Profile revision changed/);
  await userEvent.click(screen.getByRole('button',{name:'Refresh saved context'}));
  const confirmed=await screen.findByRole('region',{name:'Confirmed investor profile'});
  expect(within(confirmed).getByText(updatedProfile.objective)).toBeTruthy();
  expect(within(confirmed).getByText(updatedProfile.constraints)).toBeTruthy();
  expect(within(confirmed).getByText(/revision 2/)).toBeTruthy();
  expect((screen.getByLabelText('Investment objective') as HTMLTextAreaElement).value).toBe(profile.objective);
  expect((screen.getByLabelText('Reasons for holding') as HTMLTextAreaElement).value).toBe('My preserved case assessment');
  await userEvent.click(screen.getByRole('button',{name:'Confirm company case'}));
  await screen.findByText('Company case confirmed. Holdings were not changed.');
  expect(confirmations[1]).toMatchObject({operation:'confirm_case',profileRevision:2,case:{reasons:'My preserved case assessment'}});
});
