# 构建与发布

[开发指南](DEVELOPMENT.md) · [隐私](PRIVACY.md) · [第三方组件](../THIRD_PARTY_NOTICES.md)

## 构建便携版

在 Windows x64、Node.js 22／24 环境中：

```powershell
$env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'
npm ci
npm test
npm run dist
node scripts/verify-release.cjs
npm run test:packaged
```

`npm run dist` 重新生成品牌资源、离线手册、前端与单文件便携 EXE，不生成安装程序。中间程序目录位于 `.qa/build-*/win-unpacked/`，发行文件复制到 `release/`。

`npm run pack` 只生成程序目录，用于调试或二次打包，不输出单文件便携 EXE。

便携程序首次运行会临时解压，业务资料默认在 EXE 旁的InvoiceData/，不是临时解压目录。`INVOICE_TEST_EXE` 可指定测试另一个 EXE；见开发指南中的测试环境变量。

## 每次发布需完成的验证

- 核对版本、`CHANGELOG.md` 和兼容性说明，提交对应锁文件。
- 单元测试、前端构建、桌面流程、打包校验及实际便携 EXE 启动均通过。
- 用合成材料检查发票预览、拖入、配对、两种打印模式及日常核算；模拟提交不代表真实打印机验收。
- 实际打印机试打单面、纸张、方向和页数；未进行时在发行说明中明确。
- 升级测试保留现有定位文件和资料库；不要用清空资料目录解决问题。
- 检查 EXE 图标、离线帮助、许可证、模型、字体、运行库及 SHA-256。

`scripts/verify-release.cjs` 检查打包源码一致性、私人文件排除、原生依赖及模型资源；不能替代完整的安全或许可证审计。

## 发布包内容

可公开发送以下文件：

```text
InvoiceAssistant-<版本>-x64-Portable.exe
使用说明.txt
使用手册.html
LICENSE
THIRD_PARTY_NOTICES.md
第三方组件说明.txt
Apache-2.0.txt
third-party-licenses/
SHA256SUMS.txt
```

**不要把自己的整个 `release/` 目录直接压缩发送。** 开发者运行软件后，该目录可能产生 `InvoiceAssistant.private.json` 或真实InvoiceData/。只从上面的公开文件白名单组装发布包，不包含个人定位文件、`.key`、邮箱配置、数据库、运行缓存和测试资料。

运行库、字体和许可证也包含在便携程序内部；外部许可文件便于接收者查阅。不得仅发布 EXE 后把所有第三方组件统称为 MIT。

## 校验下载

```powershell
Get-FileHash .\InvoiceAssistant-<版本>-x64-Portable.exe -Algorithm SHA256
```

与同次发布的 `SHA256SUMS.txt` 比较。校验值帮助判断传输是否完整；若 EXE 与校验文件来自同一被篡改渠道，它不能证明发布者身份。

## 运行库与二次分发

OCR 模型、Noto 字体、Electron／Chromium、Sharp／libvips、Microsoft CRT 等具有各自许可。仓库保留来源和许可材料，详见第三方组件说明。Microsoft CRT 的再分发资格和允许文件范围须按微软条款确认；构建工具存在不自动等于获得再分发权。

当前不配置代码签名、自动更新或自动上传发行版。未签名程序可能显示 Windows 发布者提示。维护者需要单独配置签名与安全发布渠道，不能在文档中假称已经签名。

## 在 GitHub 开源

1. 完成隐私检查：`git status --short`、`git diff --cached`、`git ls-files`；另检查历史提交，忽略规则不会清除历史。
2. 创建自己的远程仓库，推送源码，确认许可证和图片能正常显示。
3. 在仓库 Settings 配置 Issues、私密漏洞报告和所需分支保护。
4. 根据最终版本创建标签和 Release，附上公开发布文件、校验值、变化及已知限制。

仓库尚无远程地址时，文档不预设下载链接、维护者邮箱或线上演示地址。`.github/workflows/ci.yml` 仅运行合成数据的测试与构建；不会替你上传凭据、推送或发布二进制。

## 清理中间产物

```powershell
# 先预览，再清理；保留当前版本、个人定位文件和业务资料
powershell -NoProfile -File scripts/clean-generated.ps1
powershell -NoProfile -File scripts/clean-generated.ps1 -Apply
```

清理脚本面向维护者已构建、已验证且保留私人定位文件的本地目录；干净检出无需运行。脚本检查目标路径并保留发布记录。手动清理也必须先退出运行中的程序，并确认目标是生成目录；不要删除用户选定的业务资料库。
