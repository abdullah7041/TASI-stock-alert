import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionView } from '../app/lib/decision-view.mjs';

const snapshot = {
  schemaVersion: 3, tradeDate: '2026-09-06', asOf: '2026-09-06T09:37:00Z', warnings: [], urgent: [], changed: [], qualified: [],
  portfolio: { holdings: [{code:'1303',name:'EIC',shares:4,avgCostSar:10},{code:'2320',name:'Al-Babtain',shares:2}], cashSar:0 },
  digestRecords: [{code:'1303',name:'EIC',kind:'holding',action:'HOLD',verified:true,price:12,unrealized_pct:20,delta:{price_pct:2},news:{ok:false}}],
  charts: [{code:'1303',status:'available',bars:[{date:'2026-09-03',Close:12}],levels:{stop:9}}],
  leanStatus:{ok:false},
};
test('every holding is visible and absent market data cannot imply Hold', () => {
  const view=buildDecisionView(snapshot,'current');
  assert.equal(view.holdings.length,2);
  assert.equal(view.holdings[0].label,'Hold');
  assert.equal(view.holdings[1].label,'Insufficient data');
  assert.equal(view.holdings[1].price,null);
  assert.equal(view.incomplete,true);
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
test('watchlist condition failure explains overbought accurately and keeps all candidates', () => {
  const current={...snapshot,digestRecords:[...snapshot.digestRecords,{code:'4016',name:'Avalon',kind:'watchlist',action:'WATCH',verified:true,price:67,rules:[{rule:'rsi_band',passed:false,actual:71,required:'25-60'}],rules_met:2,rules_total:3}],qualified:Array.from({length:5},(_,i)=>({code:String(i),name:`Candidate ${i}`,conditionsMet:2,relativeStrengthPct:15,squeeze:true}))};
  const view=buildDecisionView(current,'current');
  assert.match(view.watchlist[0].reason,/overbought/i);
  assert.equal(view.candidates.length,5);
  assert.equal(view.watchlist[0].conditionsMet,2);
});
