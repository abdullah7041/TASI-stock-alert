import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPage } from '../app/lib/migration-export.mjs';
test('export preserves large cells exactly and includes schema and columns without interpreting content',async()=>{
  const large='x'.repeat(250000);
  const db={prepare(sql){return {bind(){return this;},async all(){return {results:sql.includes('sqlite_master')?[{sql:'CREATE TABLE agent_reports (id TEXT, report_json TEXT)'}]:sql.includes('table_info')?[{name:'id',pk:1},{name:'report_json',pk:0}]:[{id:'one',report_json:large}]};}};}};
  const page=await exportPage(db,'agent_reports',0);
  assert.equal(page.rows[0].report_json,large);assert.equal(page.nextOffset,null);assert.equal(page.schema.length,1);assert.deepEqual(page.columns.map((column)=>column.name),['id','report_json']);
});
test('only known user tables are exportable',async()=>{
  const db={prepare(){throw Error('query must not execute');}};
  await assert.rejects(exportPage(db,'sqlite_master',0),/table/i);
  await assert.rejects(exportPage(db,'portfolio_events; DROP TABLE agent_reports',0),/table/i);
  await assert.rejects(exportPage(db,'portfolio_events',-1),/offset/i);
});

test('account audit payloads can use the existing protected export without rewriting records',async()=>{
  const payload='{"kind":"opening_balance","cashSar":300}';
  const db={prepare(){return {bind(){return this;},async all(){return {results:[{operation_id:'open',payload_json:payload}]};}};}};
  const page=await exportPage(db,'portfolio_account_records');
  assert.equal(page.rows[0].payload_json,payload);
});
