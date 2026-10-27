# 标志与品牌资源

![发票报销助手](../assets/brand/wordmark.png)

标志由“发票纸张、手机与完成勾选”组成，表达将原件与付款记录配齐。采用深青色与浅色纸张，适合工具界面和文档首页。

| 文件 | 用途 |
| --- | --- |
| [`icon.svg`](../assets/brand/icon.svg) | 可编辑的正方形矢量源文件 |
| `icon-256.png`、`icon-512.png` | 窗口图标、头像或文档插图 |
| [`app.ico`](../assets/brand/app.ico) | Windows 图标，包含 16～256 像素的 7 个尺寸 |
| `wordmark.svg/.png` | 浅色背景横向标志 |
| `wordmark-dark.svg/.png` | 深色背景横向标志 |
| [`social-preview.png`](../assets/brand/social-preview.png) | 1200×630 项目分享图片，可设置为 GitHub Social preview |

资源位于 `assets/brand/`。执行 `npm run brand` 从图标生成其他文件，避免手工修改生成的 PNG／ICO。横向标志的 SVG 使用系统字体；PNG 在生成时固定外观。若换机器生成文字外观有变化，需检查中文字体及预览效果。

主色为 `#176D69`，文字深色为 `#20383C`，背景可用 `#F4F8F5`。小尺寸使用纯图标，保持比例，不裁掉纸张或勾选，不在图标中添加小字。

本项目原创图形与代码一样按 MIT 许可提供；第三方字体和组件继续遵守各自许可。不声称已注册商标；复用标志不表示原维护者为衍生项目背书。

文档中的界面截图由桌面测试的合成发票和付款图片生成。执行 `npm run build`、`npm run test:desktop` 后，再执行 `node scripts/update-doc-images.cjs` 和 `npm run docs` 更新配图与离线手册。更新截图时不要使用真实邮箱、发票或报销记录。
