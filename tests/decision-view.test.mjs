import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionView } from '../app/lib/decision-view.mjs';

const snapshot = {
  schemaVersion: 3, tradeDate: '2026-09-06', asOf: '2026-09-06T09:37:00Z', warnings: [], urgent: [], changed: [], qualified: [],
  portfolio: { holdings: [{code:'1303',name:'EIC',shares:4,avgCostSar:10},{code:'2320',name:'Al-Babtain',shares:2}], cashSar:0 },
  digestRecords: [{code:'1303',name:'EIC',kind:'holding',action:'HOLD',verified:true,price:12,unrealized_pct:20,delta:{price_pct:2},news:{ok:false},rules:[
    {rule:'stop_level',available:true,passed:false,plain:'Protective stop not crossed.'},
    {rule:'trim_level',available:true,passed:false,plain:'Trim level not crossed.'},
    {rule:'target_level',available:true,passed:false,plain:'Profit target not crossed.'},
  ]}],
  charts: [{code:'1303',status:'available',bars:Array.from({length:5},()=>({date:'2026-09-03',Close:12})),levels:{stop:9}}],
  leanStatus:{ok:false},
};

test('account prices use only that broker cost and cannot make a technical crossing actionable',()=>{
  const current={...snapshot,digestRecords:[{...snapshot.digestRecords[0],action:'SELL (STOP)'}]};
  const account={accountId:'al_rajhi',holdings:[{code:'1303',name:'EIC',shares:2,avgCostSar:8}]};
  let stock=buildDecisionView(current,'current',account).holdings[0];
  assert.equal(stock.label,'Company assessment pending');assert.equal(stock.needsAttention,false);assert.equal(stock.pnl,50);
  stock=buildDecisionView(current,'current',{...account,holdings:[{...account.holdings[0],avgCostSar:undefined}]}).holdings[0];
  assert.equal(stock.pnl,null);
  assert.equal(buildDecisionView(current,'stale',account).holdings[0].label,'Insufficient data');
});
test('every holding is visible and absent market data cannot imply Hold', () => {
  const view=buildDecisionView(snapshot,'current');
  assert.equal(view.holdings.length,2);
  assert.equal(view.holdings[0].label,'Hold');
  assert.equal(view.holdings[1].label,'Insufficient data');
  assert.equal(view.holdings[1].price,null);
  assert.equal(view.incomplete,true);
});
test('a newer confirmed ledger removes sold holdings without changing the saved daily artifact', () => {
  const live={holdings:[{code:'2320',name:'Al-Babtain',shares:2}],cashSar:50,confirmedAt:'2026-09-07T10:00:00Z'};
  const view=buildDecisionView(snapshot,'current',live);
  assert.deepEqual(view.holdings.map(({code})=>code),['2320']);
  assert.equal(view.holdings[0].label,'Insufficient data');
  assert.equal(snapshot.portfolio.holdings.length,2);
});
test('market date comes from the price bars, never the digest generation date', () => {
  const view=buildDecisionView(snapshot,'current');
  assert.equal(view.holdings[0].priceDate,'2026-09-03');
  assert.equal(view.priceDate,'2026-09-03');
});
test('stale data cannot show a reassuring Hold or actionable current price', () => {
  const view=buildDecisionView(snapshot,'stale');
  assert.equal(view.holdings[0].label,'Insufficient data');
  assert.match(view.holdings[0].reason,/last successful snapshot/i);
});
test('attention counts holdings crossing levels, not ordinary changed records', () => {
  const current={...snapshot,changed:[{code:'1303'}],digestRecords:[{...snapshot.digestRecords[0],action:'SELL (STOP)'}]};
  const view=buildDecisionView(current,'current');
  assert.equal(view.attention,1);
  assert.equal(view.holdings[0].label,'Review stop');
});
test('unknown action cannot imply a reassuring Hold',()=>{
  const view=buildDecisionView({...snapshot,digestRecords:[{...snapshot.digestRecords[0],action:'UNKNOWN'}]},'current');
  assert.equal(view.holdings[0].label,'Insufficient data');
});
test('a holding quote older than the expected previous session is unavailable',()=>{
  const old={...snapshot,tradeDate:'2026-09-08',digestRecords:[{
    ...snapshot.digestRecords[0],priceDate:'2026-09-06',
  }],charts:[{...snapshot.charts[0],bars:[{date:'2026-09-06',Close:12}]}]};
  const view=buildDecisionView(old,'current');
  assert.equal(view.holdings[0].label,'Insufficient data');
  assert.match(view.holdings[0].reason,/older than the expected previous session/i);
  assert.equal(view.incomplete,true);
});

test('a holding without sufficient chart history is unavailable',()=>{
  const input=structuredClone(snapshot);
  input.charts[0]={code:'1303',status:'unavailable',reason:'history failed',levels:{stop:9}};
  const view=buildDecisionView(input,'current');
  assert.equal(view.holdings[0].label,'Insufficient data');
  assert.equal(view.incomplete,true);
});
test('watchlist condition failure explains overbought accurately and keeps all candidates', () => {
  const current={...snapshot,digestRecords:[...snapshot.digestRecords,{code:'4016',name:'Avalon',kind:'watchlist',action:'WATCH',verified:true,price:67,rules:[{rule:'rsi_band',passed:false,actual:71,required:'25-60'}],rules_met:2,rules_total:3}],qualified:Array.from({length:5},(_,i)=>({code:String(i),name:`Candidate ${i}`,conditionsMet:2,relativeStrengthPct:15,squeeze:true}))};
  const view=buildDecisionView(current,'current');
  assert.match(view.watchlist[0].reason,/overbought/i);
  assert.equal(view.candidates.length,5);
  assert.equal(view.watchlist[0].conditionsMet,2);
});
