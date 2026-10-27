<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/wordmark-dark.png">
    <img src="assets/brand/wordmark.png" width="680" alt="发票报销助手 / Invoice Reimbursement Assistant">
  </picture>
</p>

<p align="center">把材料配齐，一次打印。</p>
<p align="center">Windows 10/11 x64 · 免安装便携版 · 本地中文 OCR · MIT</p>
<p align="center"><a href="README.en.md">English</a> · <a href="docs/USER_GUIDE.md">使用手册</a> · <a href="docs/DEVELOPMENT.md">开发指南</a> · <a href="docs/FAQ.md">常见问题</a></p>

# 发票报销助手

面向个人的 Windows 报销材料整理工具：收取邮箱发票，导入手机实际付款截图，看图核对后批量单面打印；日常账单另页核算。

你只需关注两个选项卡：**发票报销**和**日常开销**。邮箱、日期范围、资料目录和排版设置集中在“设置”中。

![发票报销界面，示例材料均为合成数据](docs/images/invoices.png)

## 下载与开始使用

到本仓库的 **Releases** 下载 `InvoiceAssistant-<版本>-x64-Portable.exe`。源码下载包不包含 EXE；尚无发布包时，可按[开发指南](docs/DEVELOPMENT.md)自行构建。

1. 将 EXE 放到可写目录，建议使用 D 盘，直接双击运行。
2. 首次默认在 EXE 同级创建“报销资料”。已有用户沿用原资料目录和邮箱设置。
3. 拖入发票 PDF/OFD/ZIP 与手机截图，或在设置中添加邮箱后收取发票。
4. 核对图片、金额与配对关系，选择打印模式和打印机，再打印。

无需另装 Node.js、Python、OCR、Word 或 PDF 打印插件。使用真实打印机需要该设备的 Windows 驱动。

## 能做什么

| 场景 | 当前支持 |
| --- | --- |
| 收取发票 | IMAP 收件箱、接收日期范围、运行期间每 5 分钟检查；支持 ZIP 中的 PDF/OFD |
| 识别与整理 | PDF 正文＋离线中文 OCR，按日期从新到旧；同票号 PDF/OFD 归并，字段可人工修正 |
| 关联付款 | 图片批量导入、粘贴、拖入卡片；按金额、商户和日期推荐，用户看图确认 |
| 仅打印发票 | 无需配对或识别金额，N 张 PDF 提交 N 个单面任务 |
| 发票＋付款记录 | 完整配对后，N 个发票任务＋1 个合并付款记录任务；生成 A4 横向 Word 与打印 PDF |
| 日常开销 | 账单／长截图明细核对，支出减退款，收入不计入，保存核算结果 |
| 本地资料 | 自选目录、复制校验迁移、独立邮箱配置、逐任务打印进度和失败续打 |

**N+1 是任务数，不是纸张数。** 多页 PDF 和付款记录都可能占多张纸。“已提交”表示 Windows 已接收请求，仍需确认实际出纸。

## 一条最短工作流

```text
邮箱／本地发票 ──┐
                ├─ 看图核对、关联 ─ 选择打印模式和打印机 ─ 单面打印
手机付款截图 ───┘

日常账单／长截图 ─ 核对交易明细 ─ 保存本次合计
```

具体操作、邮箱设置、资料迁移、升级及打印异常处理见[使用手册](docs/USER_GUIDE.md)。

## 资料与隐私

- 发票、截图、OCR 文本和数据库保存在本地资料目录。应用未实现发票云上传或应用遥测。
- 收取邮件时连接你配置的邮箱服务器；不读取微信聊天数据库。
- 邮箱及加密授权码保存在 `config/accounts.private.json`，本地密钥为 `config/.key`。
- EXE 旁的 `InvoiceAssistant.private.json` 记录资料位置。它与资料目录需要在升级时保留，不能随公共发布包分发。
- `.gitignore` 排除运行资料、私人配置、密钥、数据库、备份和测试输出。已跟踪文件不受新增忽略规则保护，公开前仍需检查 Git 历史。

详见[隐私与资料管理](docs/PRIVACY.md)和[安全问题反馈](SECURITY.md)。

## 适用范围

当前仅提供 Windows 10/11 x64 便携版。一张发票对应一张实际付款截图；多笔付款或多张发票共用一笔付款需先人工整理凭证。只有 OFD 时可保存和解析文字，预览及批量打印需要对应 PDF。仅提供网页下载链接的邮件需先手动下载附件再导入。

OCR 和匹配推荐均需要核对。日常开销长截图不进入付款 Word。当前不提供手机端、微信自动读取、云端同步或完整企业财务审批流程。

## 从源码运行

建议使用 Windows x64 与 Node.js 22 或 24。

```powershell
$env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'
npm ci
npm run docs
npm run build
npm start
```

开发、隔离测试和便携版构建见[开发指南](docs/DEVELOPMENT.md)；维护者发布流程见[发布指南](docs/RELEASING.md)。不要使用真实邮箱或真实打印机运行自动化测试。

## 文档导航

| 读者／任务 | 文档 |
| --- | --- |
| 第一次使用、邮箱、截图、打印 | [使用手册](docs/USER_GUIDE.md) |
| 使用中遇到问题 | [常见问题](docs/FAQ.md) |
| 备份、迁移、私人配置和网络行为 | [隐私与资料管理](docs/PRIVACY.md) |
| 安装依赖、调试、测试、构建 | [开发指南](docs/DEVELOPMENT.md) |
| 模块、数据流、数据库与 IPC | [架构说明](docs/ARCHITECTURE.md) |
| 打包、审核、分发和清理 | [发布指南](docs/RELEASING.md) |
| Logo、图标和配色 | [品牌资源](docs/BRANDING.md) |
| 提交问题和代码 | [贡献指南](CONTRIBUTING.md) |
| 版本变化 | [更新记录](CHANGELOG.md) |

## 许可证

本项目原创代码、文档和原创品牌资源采用 [MIT License](LICENSE)。第三方库、OCR 模型、字体和运行库遵循各自许可，详见[第三方声明](THIRD_PARTY_NOTICES.md)。项目使用的许可证不改变第三方资源的许可范围。
