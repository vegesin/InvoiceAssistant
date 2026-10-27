module.exports = {
  appId:'cn.vegesin.invoiceassistant', productName:'发票报销助手', executableName:'InvoiceAssistant',
  directories:{output:'release',buildResources:'build'}, electronDist:'node_modules/electron/dist',
  npmRebuild:false, asar:true,
  asarUnpack:['node_modules/@img/**/*','node_modules/sharp/**/*','node_modules/sql.js/dist/*.wasm','node_modules/onnxruntime-node/bin/**/*','node_modules/@napi-rs/canvas-win32-x64-msvc/**/*'],
  files:['electron/**/*','dist/renderer/**/*','package.json','!**/*.private.json','!**/.key','!**/app.db','!**/data/**','!**/.qa/**','!**/.private-backups/**','!node_modules/onnxruntime-node/bin/napi-v6/{darwin,linux}/**/*','!node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/**/*','!node_modules/@gutenye/ocr-models/assets/**/*','!node_modules/pdfjs-dist/{web,types}/**/*','!**/*.map'],
  extraResources:[{from:'node_modules/@gutenye/ocr-models/assets',to:'ocr-models',filter:['ch_PP-OCRv4_det_infer.onnx','ch_PP-OCRv4_rec_infer.onnx','ppocr_keys_v1.txt']},{from:'build/fonts',to:'fonts',filter:['*.otf','OFL.txt']}],
  extraFiles:[{from:'build/使用说明.txt',to:'使用说明.txt'},{from:'build/第三方组件说明.txt',to:'第三方组件说明.txt'},{from:'build/Apache-2.0.txt',to:'Apache-2.0.txt'},{from:'build/vc-runtime',to:'.',filter:['*.dll']}], electronLanguages:['zh-CN','en-US'],
  win:{target:[{target:'portable',arch:['x64']}],signAndEditExecutable:false},
  portable:{artifactName:'InvoiceAssistant-${version}-x64-Portable.exe'},
};
