<p align="center"><img src="assets/brand/wordmark.png" width="680" alt="Invoice Reimbursement Assistant"></p>

# Invoice Reimbursement Assistant

A portable Windows desktop app for organizing Chinese invoice PDFs and their payment screenshots, printing them in batches, and checking daily expenses locally.

[中文说明](README.md) · [User guide, Chinese](docs/USER_GUIDE.md) · [Development](docs/DEVELOPMENT.md) · [Privacy](docs/PRIVACY.md)

## Get started

Download the Windows x64 Portable EXE from this repository's Releases. The source ZIP does not contain a compiled EXE; if no release is available, build from source.

1. Place the EXE in a writable folder and launch it. New users get a local data folder beside the EXE; existing users keep their configured data location.
2. Import PDF/OFD/ZIP invoices and phone payment screenshots, or configure an IMAP mailbox.
3. Review recognized fields and confirm screenshot matches.
4. Select a printer and either **invoices only** or **invoices plus payment records**. Both request single-sided printing.

No separate Node.js, Python, OCR, Word, or PDF printing application is needed for the portable build. A real printer still needs its Windows driver. The current application UI and detailed user documentation are in Chinese.

![Application with synthetic example materials](docs/images/invoices.png)

## Features and limits

- IMAP INBOX attachment import, received-date filters, ZIP extraction, and content deduplication.
- Local Chinese OCR, editable fields, PDF previews, and invoice/payment screenshot pairing.
- N invoice print jobs, optionally plus one merged payment-record job. Job count is not paper count.
- Landscape A4 payment DOCX and a matching PDF for the built-in print pipeline.
- A separate daily-expense page: expenses minus refunds, excluding income, with editable transaction rows.
- Local storage, private mailbox configuration, migration, and persistent print progress.

Windows 10/11 x64 is the supported target. OCR and matching require human review. Each invoice currently pairs with one payment screenshot. OFD text can be imported, but a matching PDF is required for preview and batch printing. Mail that only contains a web download link needs manual downloading first. The app does not read WeChat databases or provide cloud sync, a mobile app, or enterprise approval workflows.

## Build

Use Windows x64 and Node.js 22 or 24:

```powershell
$env:ONNXRUNTIME_NODE_INSTALL_CUDA='skip'
npm ci
npm run docs
npm run build
npm start
```

Run `npm test`, `npm run test:desktop`, and `npm run dist` for regression checks, isolated desktop checks, and the portable build. See the [development](docs/DEVELOPMENT.md) and [release](docs/RELEASING.md) guides for full instructions.

## Privacy and contribution

Business materials and OCR stay local. Mail fetching connects to the configured IMAP provider. The app does not implement business-data uploads or application telemetry. Do not submit real invoices, mailbox credentials, private JSON, encryption keys, or databases in public issues.

Please read [CONTRIBUTING](CONTRIBUTING.md) and [SECURITY](SECURITY.md). This project's original code, documentation, and original brand assets use the [MIT license](LICENSE); bundled third-party resources retain their own licenses, listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).
