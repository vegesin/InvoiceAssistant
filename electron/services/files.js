'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function contentHash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function saveContentFile(dir, originalName, data) {
  const hash = contentHash(data);
  const ext = path.extname(originalName).toLowerCase();
  const stem = path.parse(path.basename(originalName)).name.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 48) || 'file';
  fs.mkdirSync(dir, { recursive: true });
  let destination = path.join(dir, `${stem}${ext}`);
  if(fs.existsSync(destination)&&contentHash(fs.readFileSync(destination))!==hash)destination=path.join(dir,`${stem}_${hash.slice(0,8)}${ext}`);
  if (fs.existsSync(destination)) {
    if (contentHash(fs.readFileSync(destination)) !== hash) throw new Error(`已保存文件损坏，请检查：${destination}`);
    return { filePath: destination, hash };
  }
  const temporary = path.join(dir, `.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return { filePath: destination, hash };
}

module.exports = { contentHash, saveContentFile };
