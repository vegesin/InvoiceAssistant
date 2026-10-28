'use strict';
const materials=require('./index');
function selectedFamilies(store,values,deleted){
 if(!Array.isArray(values)||!values.length||values.length>200)throw new Error('请选择 1 至 200 张发票');
 const ids=values.map(materials.id);if(new Set(ids).size!==ids.length)throw new Error('发票不能重复选择');
 const selected=ids.map(id=>materials.getMaterial(store,'invoice',id,true));
 for(const row of selected){
  if(row.duplicate_of)throw new Error('发票已合并，请操作主发票');
  if(Boolean(row.deleted_at)!==deleted)throw new Error(deleted?'发票未删除，无需恢复':'发票已删除，请刷新列表');
 }
 const family=new Set(ids),rows=store.db.prepare('SELECT id,duplicate_of FROM invoices WHERE duplicate_of IS NOT NULL').all();
 let changed=true;while(changed){changed=false;for(const row of rows)if(family.has(row.duplicate_of)&&!family.has(row.id)){family.add(row.id);changed=true;}}
 return [...family];
}
function deleteInvoices(store,values){
 const ids=selectedFamilies(store,values,false);
 // Validate the entire selection before changing associations or deletion state.
 for(const id of ids){
  materials.assertEditable(store,'invoice',id);
  if(store.db.prepare("SELECT j.id FROM print_jobs j WHERE j.invoice_id=? AND EXISTS (SELECT 1 FROM print_jobs u WHERE u.batch_id=j.batch_id AND u.state IN ('submitting','uncertain')) LIMIT 1").get(id))throw new Error('打印任务状态不确定，请先检查队列并确认');
  if(store.db.prepare("SELECT id FROM reimbursement_items WHERE item_type='invoice' AND item_id=? LIMIT 1").get(id))throw new Error('发票仍被报销单引用，请先从报销单移除');
  const pair=store.db.prepare('SELECT screenshot_id FROM invoice_payments WHERE invoice_id=?').get(id);
  if(pair)materials.assertEditable(store,'screenshot',pair.screenshot_id);
 }
 store.db.transaction(()=>{
  for(const id of ids){
   const pair=store.db.prepare('SELECT screenshot_id FROM invoice_payments WHERE invoice_id=?').get(id);
   store.db.prepare('DELETE FROM invoice_payments WHERE invoice_id=?').run(id);
   if(pair)store.db.prepare("UPDATE screenshots SET status='new' WHERE id=?").run(pair.screenshot_id);
   store.db.prepare("UPDATE invoices SET deleted_at=datetime('now','localtime'),status='new' WHERE id=?").run(id);
  }
 });
 return {count:values.length};
}
function restoreInvoices(store,values){
 const ids=selectedFamilies(store,values,true);
 store.db.transaction(()=>{for(const id of ids)store.db.prepare('UPDATE invoices SET deleted_at=NULL WHERE id=?').run(id);});
 return {count:values.length};
}
module.exports={deleteInvoices,restoreInvoices};
