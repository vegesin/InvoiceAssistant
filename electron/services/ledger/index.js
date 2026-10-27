// 报销台账服务：报销单 CRUD、差旅闭环识别、补贴核算
'use strict';

/**
 * 差旅闭环识别：
 * 在有票报销中，识别"往返票成对 + 酒店"的完整闭环。
 * 判断依据：发票类型含"航空/铁路/客票/行程单"的至少两张 +
 *           一张"酒店"，视为闭环（往返配对）。
 * @param {Array} invoiceTypes 本次报销含的发票类型列表
 * @returns {boolean}
 */
function isTripClosed(invoiceTypes) {
  const types = (invoiceTypes || []).map(t => String(t || ''));
  const traffic = types.filter(t => /航空|铁路|客票|行程单|机票|火车|车票/.test(t)).length;
  const hotel = types.filter(t => /酒店|住宿|宾馆/.test(t)).length;
  return traffic >= 2 && hotel >= 1;
}

/**
 * 核算报销金额
 * @param {number} invoiceTotal 发票金额合计
 * @param {number} subsidyPerDay 补贴 N 元/天
 * @param {number} subsidyDays  出差天数
 * @returns {{subsidyTotal, grandTotal}}
 */
function calcTotals(invoiceTotal, subsidyPerDay, subsidyDays) {
  const sub = (subsidyPerDay || 0) * (subsidyDays || 0);
  const grand = (invoiceTotal || 0) + sub;
  return {
    subsidyTotal: Math.round(sub * 100) / 100,
    grandTotal: Math.round(grand * 100) / 100,
  };
}

module.exports = { isTripClosed, calcTotals };