import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ResearchWorkspace } from '@/app/components/ResearchWorkspace';

afterEach(()=>{ cleanup();vi.unstubAllGlobals(); });

test('research controls load a cited report, label manual prices, chat in Arabic, and return',async()=>{
  const onClose=vi.fn();
  const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    if(url==='/api/research/report')return Response.json({report:{verdict:'WAIT',generatedAt:'2026-09-07T06:00:00Z',dataStatus:'delayed-daily',sections:[{title:'Company & News',body:'Official disclosure reviewed.',provenance:'research',citations:[{title:'Issuer disclosure',url:'https://example.com/disclosure'}]}]}});
    if(url==='/api/research/chat'){
      const body=JSON.parse(String(init?.body));
      expect(body).toMatchObject({symbol:'2290',text:'What is missing?',language:'Arabic',manualPrice:41.5});
      return Response.json({id:'answer-1',role:'assistant',text:'More evidence is needed.',citations:[]});
    }
    return Response.json({error:'unexpected request'},{status:500});
  });
  vi.stubGlobal('fetch',fetcher);
  render(<ResearchWorkspace candidate={{code:'2290',name:'Yansab',relativeStrengthPct:8.2,squeeze:true,conditionsMet:2}} onClose={onClose}/>);

  expect(await screen.findByText('Official disclosure reviewed.')).toBeTruthy();
  expect(screen.getByRole('link',{name:/Issuer disclosure/}).getAttribute('href')).toBe('https://example.com/disclosure');
  await userEvent.selectOptions(screen.getByLabelText('Reply language'),'Arabic');
  await userEvent.type(screen.getByLabelText('Optional live broker price'),'41.5');
  expect(screen.getByText(/User-supplied only/)).toBeTruthy();
  await userEvent.type(screen.getByLabelText('Ask about this stock'),'What is missing?');
  await userEvent.click(screen.getByRole('button',{name:'Ask agent'}));
  expect(await screen.findByText('More evidence is needed.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button',{name:/Back to cockpit/}));
  await waitFor(()=>expect(onClose).toHaveBeenCalledOnce());
});
