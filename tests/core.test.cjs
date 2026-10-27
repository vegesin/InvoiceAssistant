const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { parseFromText, sumLongScreenshot, OcrService } = require('../electron/services/ocr');
const { matchInvoiceToScreenshots } = require('../electron/services/match');
const { calcTotals } = require('../electron/services/ledger');

test('日期、时间、订单号和汇总行不混入支出', () => {
  const result = sumLongScreenshot('2026-10-27\n14:30:20\n订单号 2026102701234\n-16.00\n-4.50\n合计：20.50');
  assert.equal(result.total, 20.5);
  assert.equal(result.signedTotal, -20.5);
  assert.equal(result.items.length, 2);
  assert.equal(result.skipped.length, 4);
});
test('收入排除、退款扣除，使用分累计避免浮点误差', () => {
  const result = sumLongScreenshot('-0.10\n-0.20\n收入 +100.00\n退款 +0.05\n2.00');
  assert.equal(result.total, 2.25);
  assert.equal(result.incomeTotal, 100);
  assert.equal(result.refundTotal, 0.05);
});
test('同一行的日期可与真实支付金额区分', () => {
  assert.equal(sumLongScreenshot('2026-10-27 14:30 支付 -16.00元').total, 16);
  assert.equal(sumLongScreenshot('支付 ￥1,234.56\n2026/10/27').total, 1234.56);
  assert.equal(sumLongScreenshot('金额 12.345').items.length, 0);
  assert.equal(sumLongScreenshot('支付 10.00 20.00').items.length, 0);
});
test('单笔支付金额、日期、商户与渠道可解析', () => {
  const result = parseFromText('微信支付成功\n-285.00\n2026年10月27日\n商户名称：测试酒店');
  assert.equal(result.amount, 285);
  assert.equal(result.pay_date, '2026-10-27');
  assert.equal(result.merchant, '测试酒店');
  assert.equal(result.channel, 'wechat');
});
test('不把多笔支付或无效日期擅自识别为单笔记录', () => {
  assert.equal(parseFromText('-10\n-20').amount, null);
  assert.equal(parseFromText('2026-02-30\n-10').pay_date, null);
  assert.equal(parseFromText('-10\n-20\n合计：30').amount, 30);
  assert.equal(parseFromText('合计：30\n总计：30').amount, null);
});
test('OCR 使用内置本地引擎，缺失图片返回明确错误', async () => {
  const service = new OcrService();
  assert.equal((await service.recognizeAmount('synthetic.png')).amount, null);
  service.configure({ ocrMode: 'paddle' });
  assert.equal(service.mode, 'local');
  const result = await service.recognizeAmount('synthetic.png');
  assert.ok(result.error);
  service.configure({ ocrMode: 'local' });
  assert.equal(service.mode, 'local');
});
test('事件订阅只移除自己的监听器，取消订阅可重复调用', () => {
  const emitter = new EventEmitter();
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_key, value) => { api = value; } }, ipcRenderer: emitter }),
  });
  for (const [method, channel] of [['onMailFetchMail', 'mail:onMail'], ['onMailFetchInvoice', 'mail:onInvoice'], ['onScreenshotNew', 'screenshot:new'], ['onScreenshotError', 'screenshot:error']]) {
    let first = 0;
    let second = 0;
    const off = api[method](() => first++);
    const offSecond = api[method](() => second++);
    assert.equal(typeof off, 'function');
    emitter.emit(channel, {}, { id: 1 });
    off(); off();
    emitter.emit(channel, {}, { id: 2 });
    assert.equal(first, 1);
    assert.equal(second, 2);
    offSecond();
    assert.equal(emitter.listenerCount(channel), 0);
  }
});
test('补贴计算和多图配对保持原有结果', () => {
  assert.equal(calcTotals(333.56, 100, 3).grandTotal, 633.56);
  const result = matchInvoiceToScreenshots([{ id: 1, amount: 333.56 }], [{ id: 1, amount: 200 }, { id: 2, amount: 133.56 }]);
  assert.deepEqual(result[0].screenshotIds.sort(), [1, 2]);
});
