'use strict';



const SUMMARY = /合计|总计|总额|小计|共计|总金额/;
const DATE = /(?:19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

// 只接受整行金额或带支付语义/货币符号的金额，避免日期、订单号混入。
function amountInLine(line, allowSummary = false) {
  const original = String(line).trim().replace(/[−–]/g, '-').replace(/，/g, ',');
  if (!original || (!allowSummary && SUMMARY.test(original))) return null;
  const clean = original.replace(DATE, '').replace(TIME, '').trim();
  if (/订单号|交易号|流水号|尾号|手机号|单号/.test(clean)) return null;
  const number = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?';
  const token = '([-+]?\\s*[¥￥]?\\s*' + number + ')\\s*(元)?';
  let match = clean.match(new RegExp('^' + token + '$'));
  if (!match) {
    if (!/支付|实付|付款|支出|消费|收入|退款|退回|金额|合计|总计|总额|小计|共计|¥|￥|元|[-+]\s*\d+\.\d{2}\s*$/.test(clean)) return null;
    const candidates = [...clean.matchAll(new RegExp('(?<![\\d.])' + token + '(?![\\d.])', 'g'))];
    if (candidates.length !== 1) return null;
    match = candidates[0];
  }
  const value = Number(match[1].replace(/[\s¥￥,]/g, ''));
  if (!Number.isFinite(value) || Math.abs(value) > 999999999) return null;
  return { value, line: original, refund: /退款|退回/.test(original), income: /收入|收款/.test(original) };
}

// 支出取正数；显式收入不计入报销；退款从支出中扣减。
function sumLongScreenshot(text) {
  const items = [];
  const skipped = [];
  let signedCents = 0;
  let expenseCents = 0;
  let incomeCents = 0;
  let refundCents = 0;
  let context = '';
  for (const line of String(text || '').split(/\r?\n/)) {
    const parsed = amountInLine(line);
    if (!parsed) { if (line.trim()) { skipped.push(line.trim()); if(!SUMMARY.test(line)&&!/(?:19|20)\d{2}[-/.年]/.test(line))context=line; } continue; }
    const cents = Math.round(Math.abs(parsed.value) * 100);
    signedCents += Math.round(parsed.value * 100);
    const kind = parsed.refund || /退款|退回/.test(context) ? 'refund' : parsed.income || /收入|收款/.test(context) || /^\s*\+/.test(line) ? 'income' : 'expense';
    if (kind === 'expense') expenseCents += cents;
    if (kind === 'income') incomeCents += cents;
    if (kind === 'refund') refundCents += cents;
    items.push({ line: context&&!parsed.line.includes(context)?context+' '+parsed.line:parsed.line, value: parsed.value, kind, amount: cents / 100 });
    context = '';
  }
  return {
    items, skipped, total: (expenseCents - refundCents) / 100,
    expenseTotal: expenseCents / 100, incomeTotal: incomeCents / 100,
    refundTotal: refundCents / 100, signedTotal: signedCents / 100,
  };
}

function parseFromText(text) {
  const raw_text = String(text || '');
  const lines = raw_text.split(/\r?\n/);
  const summary = lines.filter(line => SUMMARY.test(line)).map(line => amountInLine(line, true)).filter(Boolean);
  const details = sumLongScreenshot(raw_text);
  const date = raw_text.match(/((?:19|20)\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  const pay_date = date && validDate(+date[1], +date[2], +date[3])
    ? date[1] + '-' + date[2].padStart(2, '0') + '-' + date[3].padStart(2, '0') : null;
  const merchant = raw_text.match(/(?:商户(?:全称|名称)?|收款方|收款商家)\s*[:：]\s*([^\r\n]+)/)?.[1]?.trim() || null;
  const singleExpense = details.items.length === 1 && details.items[0].kind === 'expense';
  const total = summary.length === 1 && !summary[0].refund && !summary[0].income ? Math.abs(summary[0].value) : null;
  return {
    amount: total ?? (singleExpense ? details.items[0].amount : null),
    pay_date, merchant, items: details.items, total, raw_text,
    channel: /支付宝|alipay/i.test(raw_text) ? 'alipay' : /微信|wechat/i.test(raw_text) ? 'wechat' : null,
  };
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

class OcrService {
  constructor(opts={}){
    this.mode=opts.mode||'local';this.queue=Promise.resolve();
  }
  configure(settings){this.mode=settings.ocrMode==='text'?'text':'local';}
  async recognizeAmountFromText(text){return require('../documents/parse').parsePayment(text);}
  readText(file,onProgress){
    if(this.mode==='text')return Promise.resolve({text:'',lines:[]});
    const job=this.queue.then(()=>require('./local').readLocalText(file,onProgress));
    this.queue=job.catch(()=>{});
    return job;
  }
  async recognizeAmount(file){
    try{
      const result=await this.readText(file);
      const parsed=require('../documents/parse').parsePayment(result.text,result.lines);
      return {...parsed,ocr_lines:result.lines,recognition_source:'local-ocr'};
    }catch(error){return {amount:null,pay_date:null,merchant:null,raw_text:null,channel:'other',recognition_state:'failed',error:'本地识别失败：'+error.message};}
  }
}

module.exports = { OcrService, parseFromText, sumLongScreenshot, amountInLine };
