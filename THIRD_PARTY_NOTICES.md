# 第三方组件与资源

本项目原创代码、文档和标志采用 [MIT](LICENSE)。下列组件继续按各自许可分发；根目录 MIT 许可证不改变它们的许可。依赖具体版本以 `package-lock.json` 和本次发行包为准。

## 主要软件组件

| 组件 | 许可／来源 |
| --- | --- |
| Electron、Node.js、Chromium | Electron 为 MIT；Node、Chromium 及其依赖包含其他许可，发行包保留 Electron `LICENSE` 与 `LICENSES.chromium.html`，见 [Electron](https://github.com/electron/electron) |
| React、React DOM | MIT，[React](https://github.com/facebook/react) |
| PDF.js | Apache-2.0，[Mozilla PDF.js](https://github.com/mozilla/pdf.js) |
| pdf-lib | MIT，[pdf-lib](https://github.com/Hopding/pdf-lib) |
| @napi-rs/canvas | MIT，包含其原生绘图依赖，[canvas](https://github.com/Brooooooklyn/canvas) |
| @gutenye/ocr-node | 代码为 MIT；模型另见下节，[Guten OCR](https://github.com/gutenye/ocr) |
| ONNX Runtime | MIT 及其第三方声明，[ONNX Runtime](https://github.com/microsoft/onnxruntime) |
| Sharp | Apache-2.0；原生组件包含 LGPL 等许可，见下节，[Sharp](https://github.com/lovell/sharp) |
| sql.js、SQLite | sql.js 为 MIT，SQLite 为公有领域，[sql.js](https://github.com/sql-js/sql.js) |
| docx、ExcelJS | MIT，[docx](https://github.com/dolanmiu/docx)、[ExcelJS](https://github.com/exceljs/exceljs) |
| ImapFlow、Mailparser | MIT，[ImapFlow](https://github.com/postalsys/imapflow)、[Mailparser](https://github.com/nodemailer/mailparser) |
| JSZip | 可选 MIT 或 GPL-3.0，本项目按 MIT 使用，[JSZip](https://github.com/Stuk/jszip) |
| Chokidar | MIT，[Chokidar](https://github.com/paulmillr/chokidar) |
| Vite、electron-builder、markdown-it、resedit | 开发／构建工具，各自 MIT；resedit 仅修改构建目录内的图标资源 |

上表方便定位主要组件，不是完整的传递依赖清单。构建脚本会从实际打包的 npm 组件复制其可用 LICENSE／NOTICE／版权说明及包版本到 `third-party-licenses/`。原依赖中的许可文件也保留在应用资源中。升级依赖后需重新检查，不能把自动收集当作许可审计结论。

## OCR 模型与字典

固定使用 `@gutenye/ocr-models@1.4.2` 内的 PP-OCRv4 中文检测、识别模型及字典。Guten OCR 的**代码 MIT 不覆盖模型和字典**；它们来自 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)，上游为 [Apache-2.0](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)，相关区分见 [Guten OCR 许可说明](https://github.com/gutenye/ocr#license)。全文附带于 `Apache-2.0.txt`。

| 资源 | SHA-256 |
| --- | --- |
| `ch_PP-OCRv4_det_infer.onnx` | `30a86f5731181461d08021402766601e4302a9b9b9666be8aff402696339cdff` |
| `ch_PP-OCRv4_rec_infer.onnx` | `06b3e6af6c59a1ba5d53790ed8c2e4b2de389870b6cf5a97f349f3412cb269c0` |
| `ppocr_keys_v1.txt` | `28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7` |

来源清单见 [模型资源记录](https://github.com/gutenye/ocr/blob/main/packages/models/assets.json)。升级时不得把其他模型套用此处的版本、校验值和许可结论。

## Sharp／libvips

当前 Windows 原生包 `@img/sharp-win32-x64@0.34.5` 的许可字段为 `Apache-2.0 AND LGPL-3.0-or-later`，附带 libvips 8.17.3 及图像库。其 README 列出 LGPL、MPL、BSD、MIT 等第三方条款，随发行包原样保留。

构建脚本和第三方来源见 [sharp-libvips](https://github.com/lovell/sharp-libvips)，Windows 依赖构建见 [build-win64-mxe](https://github.com/libvips/build-win64-mxe)，libvips 源码见 [libvips](https://github.com/libvips/libvips)。分发者应为所分发版本提供对应源码与构建信息，并遵守 LGPL 的替换、调试及通知要求。原生 DLL 保持为独立文件，不禁止用户依相应条款替换或为调试修改而进行逆向分析。完整依赖版本记录保留为原生包的 `versions.json`。

## 中文字体

`build/fonts/NotoSansCJKsc-Regular.otf` 来自 [Noto CJK](https://github.com/notofonts/noto-cjk)，用于 PDF 缺少可用字体时的中文后备。按 SIL Open Font License 1.1 分发，全文保留在 `build/fonts/OFL.txt`，发行包内位于 `resources/fonts/OFL.txt` 和第三方许可目录。

## Microsoft Visual C++ 运行库

`build/vc-runtime/` 包含 MSVCP140、MSVCP140_1、VCRUNTIME140、VCRUNTIME140_1 x64 DLL，来源记录为 Visual Studio 2022 Build Tools 14.44.35112 的 VC/Redist/MSVC 目录，采用应用本地部署。

这些 Microsoft 二进制**不属于本项目 MIT 许可**。允许的文件、再分发资格和条件以 [Microsoft 官方部署说明](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170)及适用的 Visual Studio 许可为准。二次发布者需自行确认其授权；也可改为由使用者安装官方支持的运行库。

## 许可材料的位置

源码中保留根许可证、本文、`build/Apache-2.0.txt` 和字体 OFL；npm 组件许可随依赖获取。便携版同时带有项目许可、第三方摘要和 `third-party-licenses/`，包含 Electron／Chromium 及实际打包依赖的说明。打包过程不改变第三方组件的著作权。
