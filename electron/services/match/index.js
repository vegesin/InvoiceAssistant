// 配对引擎：把"发票"与"支付截图"按金额对齐
'use strict';

/**
 * 匹配策略（按优先级）：
 * 1. 金额精确相等：发票金额 === 单张截图金额
 * 2. 子集求和：一张发票金额 === 多张截图金额之和
 * 3. 日期相近 / 商户名辅助判决（对冲突金额）
 * 返回匹配结果，未命中的返回 null（交给人工拖拽兜底）
 */

const EPS = 0.005; // 金额浮点容差（分）

function closeTo(a, b) {
  return Math.abs(a - b) < EPS;
}

/**
 * 主匹配
 * @param {Array} invoices     发票记录 [{id, amount, invoice_type, seller, issue_date}]
 * @param {Array} screenshots  截图记录 [{id, amount, pay_date, merchant}]
 * @returns {Array<{invoiceId, screenshotIds: number[], amount, method: 'exact'|'subset', diff: number}>}
 */
function matchInvoiceToScreenshots(invoices, screenshots) {
  const matched = [];
  const usedShotIds = new Set();

  // 只处理有金额的发票和截图
  const invs = invoices.filter(i => i.amount != null);
  const shots = screenshots.filter(s => s.amount != null);

  for (const inv of invs) {
    const cand = shots.filter(s => !usedShotIds.has(s.id));

    // 1) 精确相等
    const exact = cand.find(s => closeTo(s.amount, inv.amount));
    if (exact) {
      matched.push({ invoiceId: inv.id, screenshotIds: [exact.id], amount: inv.amount, method: 'exact', diff: 0 });
      usedShotIds.add(exact.id);
      continue;
    }

    // 2) 子集求和（先试 2 张，再试 3 张，避免组合爆炸，限制在 4 张内）
    const subset = findSubset(cand, inv.amount, 4);
    if (subset) {
      matched.push({ invoiceId: inv.id, screenshotIds: subset.map(s => s.id), amount: inv.amount, method: 'subset', diff: 0 });
      subset.forEach(s => usedShotIds.add(s.id));
      continue;
    }
  }

  return matched;
}

// 在候选里找若干张金额之和 == target（组合搜索，限制最多 k 张）
function findSubset(cands, target, maxK) {
  cands = [...cands].sort((a, b) => b.amount - a.amount); // 从大到小有利于剪枝
  const result = [];
  function dfs(start, remaining, picked) {
    if (picked.length > maxK) return false;
    if (closeTo(remaining, 0) && picked.length > 0) {
      result.push(...picked);
      return true;
    }
    if (remaining < -EPS) return false;
    for (let i = start; i < cands.length; i++) {
      if (cands[i].amount > remaining + EPS) continue;
      if (dfs(i + 1, remaining - cands[i].amount, [...picked, cands[i]])) return true;
    }
    return false;
  }
  const ok = dfs(0, target, []);
  return ok ? result : null;
}

/**
 * 生成"未匹配提示"：发票无对应截图、截图无对应发票
 */
function unmatchedHints(invoices, screenshots, matched) {
  const matchedInv = new Set(matched.map(m => m.invoiceId));
  const matchedShot = new Set(matched.flatMap(m => m.screenshotIds));
  return {
    invoices: invoices.filter(i => !matchedInv.has(i.id)),
    screenshots: screenshots.filter(s => !matchedShot.has(s.id)),
  };
}

module.exports = { matchInvoiceToScreenshots, findSubset, unmatchedHints, closeTo };