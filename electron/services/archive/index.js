// 归档服务：原始文件归档，随报销单可回溯
'use strict';

const fs = require('fs');
const path = require('path');
const { DIRS } = require('../../store');

/**
 * 归档一批文件到指定报销单目录。
 * 原始文件永远保留（本函数做的是"复制"归档，绝不移动原文件）。
 * @param {string} reimbursementTitle 报销单标题（用于目录名）
 * @param {Array} files 文件路径列表
 * @param {string} sub 子目录（如 'invoice' / 'screenshot'）
 * @returns {Array<string>} 归档后的路径
 */
function archiveFiles(reimbursementTitle, files, sub = 'invoice') {
  const base = path.join(DIRS.archive, safeDirName(reimbursementTitle), sub);
  fs.mkdirSync(base, { recursive: true });
  const results = [];
  for (const f of files) {
    if (!f || !fs.existsSync(f)) continue;
    const name = path.basename(f);
    let dest = path.join(base, name);
    // 重名时加序号
    let n = 1;
    while (fs.existsSync(dest)) {
      dest = path.join(base, `${path.parse(name).name}_${n}${path.extname(name)}`);
      n++;
    }
    fs.copyFileSync(f, dest);
    results.push(dest);
  }
  return results;
}

function safeDirName(s) {
  return String(s || '未命名报销单').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

module.exports = { archiveFiles, safeDirName };