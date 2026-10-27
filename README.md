# 发票报销助手 v0.4.0

Windows 10/11 x64 便携桌面工具。围绕两件事：把发票与实际付款截图配齐后一次打印；单独核算日常开销。

## 便携版

运行 `release/InvoiceAssistant-0.4.0-x64-Portable.exe`。本次只构建便携版本，无安装程序。
新用户默认使用 EXE 同级的“报销资料”，设置可迁移；已有用户继续沿用当前资料位置和邮箱配置。分发只需 EXE 和使用说明，不要复制个人资料库。
内置 PDF.js、中文 PP-OCRv4 模型和 ONNX Runtime，无需安装 Node、Python、OCR、Word 或 PDF 打印插件。

## 使用

1. 在“发票报销”批量导入 PDF/OFD、付款截图，支持系统文件拖放及粘贴图片；也可从配置的邮箱收取。
2. 卡片显示日期、商户、金额和两份材料预览，按开票日期从新到旧。点击图片核对并修改识别字段。
3. 将右侧付款截图拖到发票卡片，或查看金额、商户、日期推荐后确认关联。同金额有多笔时保留歧义。
4. 选中发票、选打印模式和打印机。“仅打印发票”无需配对或识别金额，提交 N 个单面 PDF 任务；“发票＋付款记录”提交 N+1 个单面任务。
5. “打印记录”可打开付款 Word、查看每项进度、续打未提交任务。状态不确定时先查看系统队列。
6. 日常账单或长截图在“日常开销”处理，支出减退款、收入排除；核对可编辑明细后保存合计，不进入付款 Word。

付款 Word 为 A4 横向，每页 2 或 3 张标准手机截图，完整等比例缩放。软件同时生成相同纸张和缩放尺寸的付款 PDF，由内置打印管线提交；无需用 Office 打印 Word。
N+1 指任务数，付款记录可有多页，原始发票也可能有多页。“已提交”表示 Windows 接收了任务，实际出纸仍需确认。

## 邮箱日期配置

`config/settings.json` 保存：

```json
{
  "firstLaunchDate": "2026-10-27",
  "mailReceivedFrom": "2026-10-27",
  "mailReceivedTo": null,
  "autoFetchWhenOpen": true,
  "wordPerPage": 3
}
```

首次默认从首次启动日持续收取。日期是邮件收到的日期，首尾当天包含；结束日期留空表示之后持续收取。
修改日期后重新收取会补扫范围并按内容去重，不会因旧 UID 游标漏掉历史邮件。软件打开期间每 5 分钟检查邮箱，退出后停止。
PDF 优先读正文，扫描图再本地 OCR；OFD 解析文字内容。同一票号的 PDF/OFD 归为一张，保留格式原件。支持 ZIP 邮件附件并在升级后按现有日期自动补扫；OFD 文字按模板和坐标重组，航空金额取合计，填开日期与行程日期区分。用车行程附件不另算发票。

## 文件位置和隐私

EXE 旁的 `InvoiceAssistant.private.json` 记录资料位置与首次启动日。所选资料目录内：

| 位置 | 内容 |
| --- | --- |
| config/settings.json | 日期筛选、排版设置 |
| config/accounts.private.json 与 .key | 独立加密邮箱配置与本地密钥 |
| db/app.db | 发票、关联、打印进度、核算记录 |
| inbox/月份/ | 发票原件，以日期、商户、金额命名；原始文件名保留在记录内 |
| screenshots/originals/ | 实际付款截图 |
| expenses/ | 日常开销图片 |
| incoming/ | 可选图片接收目录，放入后自动导入 |
| export/批次编号/ | 付款 Word、付款打印 PDF |
| temp/ | 缩略图、邮件暂存、运行缓存 |

不再默认将业务数据写入 C 盘 AppData。启动时发现旧版资料可选择复制迁移，逐文件校验并改写数据库路径，旧目录保留。
设置也可迁移到新的空目录并重启。备份需退出程序后备份整个资料目录，包含配置和密钥。

微信 PC 登录不授予聊天读取权限。本工具不读取微信数据库；先把文件传输助手的图片保存后拖入，或复制后粘贴。本地识别不上传发票和截图。

## 开发与验证

```powershell
npm install
npm run build
npm start
npm test
npm run test:desktop
npm run dist
node scripts/verify-release.cjs
npm run test:packaged
```

`npm run dist` 只生成 Portable.exe；`npm run pack` 生成可运行程序目录。构建缓存和 QA 资料在 `.qa/`，私人配置、数据库、测试材料不打包。
生产依赖和模型版本锁定；`build/vc-runtime/` 附带来自 Visual Studio Redistributable 目录的 x64 CRT。第三方说明及 Apache-2.0 全文在 build/。
测试使用合成材料和隔离数据库，不连接真实邮箱、不实际出纸。`INVOICE_PRINT_TEST=1` 只在显式指定 `.qa/` 隔离资料库时生效。
`INVOICE_SMOKE_RESTRICTED=1` 只为测试启用软件渲染和 no-sandbox；正常应用保留 sandbox。
可用 `INVOICE_TEST_EXE` 指向便携 EXE，`INVOICE_TEST_TEMP` 指定受限环境中的便携解压临时目录。

## 当前边界

OCR 结果需要核对；多金额、缺失字段和歧义配对不会当作确定结果。当前一张发票对应一张实际付款截图。
只有 OFD 时可保留识别，批量打印需补充对应 PDF。旧版报销记录继续保存在数据库中，新界面不再要求创建报销单或填写补贴。
便携 EXE 未作商业代码签名。

本轮修复覆盖真实航空 PDF 的矩阵和中文字体渲染、PDF/OFD 同票合并，以及铁路 ZIP 附件补收。系统文件可拖到卡片、截图区或页面空白处；没有本地路径的图片可按内容导入。
清理后只保留最新便携 EXE、说明和校验值，当前机器的 InvoiceAssistant.private.json 与 .private-backups/ 配置备份保留。升级请保持 EXE 与现有定位文件在同一目录。
