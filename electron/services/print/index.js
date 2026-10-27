'use strict';

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

function runPowerShell(script) {
  const source = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\ntry {\n" + script + "\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 30000, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim()));
        else resolve(stdout.trim());
      });
  });
}

async function listPrinters() {
  const { BrowserWindow } = require('electron');
  const window = BrowserWindow?.getAllWindows().find(window => !window.isDestroyed());
  if (window) {
    const printers = await window.webContents.getPrintersAsync();
    return printers.map(printer => ({ name: printer.name, driver: printer.options?.['printer-driver-name'] || '', port: printer.options?.['printer-port-name'] || '', isDefault: !!printer.isDefault }));
  }
  const output = await runPowerShell(
    "$defaultName = (Get-CimInstance Win32_Printer -Filter 'Default=TRUE' -ErrorAction SilentlyContinue).Name\n" +
    "$printers = @(Get-Printer | ForEach-Object {\n" +
    "[PSCustomObject]@{ name=$_.Name; driver=$_.DriverName; port=$_.PortName; isDefault=($_.Name -eq $defaultName) }\n" +
    "})\nConvertTo-Json -InputObject $printers -Compress");
  const printers = output ? JSON.parse(output.replace(/^\uFEFF/, '')) : [];
  return Array.isArray(printers) ? printers : [printers];
}

function assertFile(filePath, extensions) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('待打印文件不存在或不是绝对文件路径');
  }
  if (!extensions.includes(path.extname(filePath).toLowerCase())) throw new Error('此打印入口不支持该文件格式；OFD 请使用已安装的 OFD 阅读器打印');
}

function pdfPrintArgs(filePath, printerName) {
  return printerName ? ['-silent', '-print-to', printerName, filePath] : ['-silent', '-print-to-default', filePath];
}

async function printPdf(filePath, printerName = '') {
  assertFile(filePath, ['.pdf']);
  const candidates = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).map(dir => path.join(dir, 'SumatraPDF', 'SumatraPDF.exe'));
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) return printViaShell(filePath, printerName);
  await new Promise((resolve, reject) => {
    execFile(executable, pdfPrintArgs(filePath, printerName), { windowsHide: true, timeout: 60000 }, error => error ? reject(error) : resolve());
  });
  return { submitted: true, method: 'sumatra', printerName: printerName || null };
}

function psLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

function shellPrintScript(filePath, printerName) {
  if (printerName && /["\r\n\0]/.test(printerName)) throw new Error('打印机名称包含不支持的字符');
  const verb = printerName ? 'PrintTo' : 'Print';
  const args = printerName ? ' -ArgumentList ' + psLiteral('"' + printerName + '"') : '';
  return 'Start-Process -FilePath ' + psLiteral(filePath) + ' -Verb ' + verb + args + ' -WindowStyle Hidden -ErrorAction Stop';
}

async function printViaShell(filePath, printerName) {
  try { await runPowerShell(shellPrintScript(filePath, printerName)); }
  catch (error) { throw new Error('无法提交打印请求，请检查文件关联程序是否支持' + (printerName ? '指定打印机（PrintTo）' : '打印') + '：' + error.message); }
  return { submitted: true, method: 'shell', printerName: printerName || null };
}

function printImage(filePath, printerName = '') {
  assertFile(filePath, ['.png', '.jpg', '.jpeg', '.bmp', '.gif']);
  return printViaShell(filePath, printerName);
}

function printWord(filePath, printerName = '') {
  assertFile(filePath, ['.docx', '.doc']);
  return printViaShell(filePath, printerName);
}

module.exports = { listPrinters, printPdf, printImage, printWord, pdfPrintArgs, shellPrintScript };
