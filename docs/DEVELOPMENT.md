# 开发指南

[项目首页](../README.md) · [架构](ARCHITECTURE.md) · [发布](RELEASING.md) · [贡献](../CONTRIBUTING.md)

## 环境与首次安装

支持的开发／发布目标为 Windows x64。建议使用 Node.js 22 或 24 及 npm，版本以 `package-lock.json` 锁定的依赖为准。Electron 内置的 Node 版本与构建机 Node 版本不同，不要假设它们相同。

```powershell
$env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'
npm ci
npm run docs
npm run build
npm start
```

项目使用 CPU OCR，安装时跳过 ONNX CUDA 下载即可。模型由锁定的 `@gutenye/ocr-models` 提供，版本升级需要连同模型名称、加载路径和打包配置检查。

`package.json` 的 `private: true` 是阻止误发布到 npm，不代表 Git 仓库必须私有。

## 实时开发

在两个终端中分别运行：

```powershell
# 终端 A：前端开发服务
npm run renderer
```

```powershell
# 终端 B：Electron
$env:INVOICE_ASSISTANT_DATA_DIR=Join-Path (Get-Location) '.qa/dev-data'
npm run dev
```

Vite 使用 5173 端口。修改主进程或 preload 后重启 Electron；前端由 Vite 更新。开发数据不要指向真实报销资料目录。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 构建前端到 `dist/renderer/` |
| `npm start` | 运行已构建的桌面应用 |
| `npm run renderer`／`npm run dev` | 前端开发服务／连接开发服务的 Electron |
| `npm test` | 业务、存储、解析、Word、打印状态等回归 |
| `npm run test:desktop` | 使用合成材料及隔离资料库的界面流程与重启检查 |
| `npm run brand` | 从 SVG 生成品牌 PNG、ICO 和分享图 |
| `npm run docs` | 从使用手册生成离线 HTML 和便携版简明说明 |
| `npm run pack` | 构建可直接运行的程序目录 |
| `npm run dist` | 构建单文件便携 EXE，不生成安装程序 |
| `node scripts/verify-release.cjs` | 构建源码、资源、私人文件排除和校验值审核 |
| `npm run test:packaged` | 验证最近构建或显式指定的程序 |

构建和发布步骤见[发布指南](RELEASING.md)。

## 隔离测试

`npm test` 使用临时目录和合成数据。桌面测试使用 `.qa/` 下的独立目录，正常测试不连接真实邮箱、不向真实打印机出纸。

```powershell
npm test
npm run build
npm run test:desktop
```

受限环境中可按需设置：

```powershell
$env:INVOICE_SMOKE_RESTRICTED='1'
$env:INVOICE_TEST_TEMP=Join-Path (Get-Location) '.qa/portable-temp'
npm run test:desktop
```

`INVOICE_SMOKE_RESTRICTED=1` 仅给测试进程启用软件渲染及 no-sandbox；正常应用保持 sandbox。不要把测试参数作为生产启动方式。

`INVOICE_PRINT_TEST=1` 仅在显式指定且路径包含 `.qa/` 的隔离资料库中启用模拟打印提交。它不是普通用户的打印设置。

## 环境变量

| 名称 | 作用 |
| --- | --- |
| `INVOICE_ASSISTANT_DATA_DIR` | 覆盖资料根目录，主要用于隔离开发／测试 |
| `INVOICE_TEST_EXE` | 指定打包验证使用的 EXE 绝对路径 |
| `INVOICE_TEST_TEMP` | 指定便携程序测试解压的临时目录 |
| `INVOICE_SMOKE_RESTRICTED` | 受限桌面测试的渲染和 sandbox 参数 |
| `INVOICE_SMOKE_CAPTURE` | 设为 `0` 跳过桌面截图，仅用于截图接口不可用的环境；仍检查业务操作 |
| `INVOICE_PRINT_TEST` | 受隔离路径限制的模拟打印提交 |
| `ONNXRUNTIME_NODE_INSTALL_CUDA` | 安装依赖时可设 `skip`，跳过 CUDA 组件 |

普通使用者无需设置这些变量。便携定位由 EXE 旁的 `InvoiceAssistant.private.json` 负责。

## 修改时应维持的约束

- 原件按内容去重，同名不同内容保留独立副本，避免覆盖已有凭证。
- 自动识别保留人工修正字段；识别失败要留下可核对的状态和原件。
- 只有明确的发票身份字段才归并 PDF/OFD，不按金额相同就当作同一张票。
- 日期筛选依据接收日；规则变化补扫旧邮件，不能只看旧 UID 游标。
- 同金额多笔匹配保留歧义；截图不可重复关联其他发票。
- 打印明确区分仅发票与完整配对，持久化每项进度，不自动重发状态不确定的任务。
- 导入入口共享同一业务逻辑，卡片、页面和无本地路径图片都要覆盖。
- 邮箱配置、密钥、数据库和真实样本不得进入构建或测试夹具。

PDF 渲染使用嵌入字体注册、系统字体映射和中文后备字体，并兼容 Electron 图片缓冲及矩阵行为。验证应同时检查实际像素和文字，不能只判断生成了文件或返回了成功状态。

## 故障定位

先确定问题位于邮箱发现、附件拆包、解析、渲染、入库、配对还是打印提交。用合成／脱敏样本复现，再添加针对行为的回归检查。不要通过清空真实数据库解决游标或迁移问题，也不要在日志中打印授权码和密钥。

GitHub CI 只使用合成数据运行测试与构建，不会替代真实打印机验收。发行版和源码均未经过独立安全审计。
