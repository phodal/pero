export const mystProjectMessages = {
  resource: { en: 'Project resource', zh: '项目资源' },
  source: { en: 'MyST resource source', zh: 'MyST 资源源码' },
  raw: { en: 'MyST project snapshot', zh: 'MyST 项目快照' },
  preview: { en: 'MyST project preview', zh: 'MyST 项目预览' },
  diagnostics: { en: 'MyST project diagnostics', zh: 'MyST 项目诊断' },
  snapshotDownload: { en: 'Download project snapshot', zh: '下载项目快照' },
  htmlDownload: { en: 'Download entry HTML', zh: '下载入口 HTML' },
  downloaded: { en: 'Download prepared.', zh: '已准备下载。' },
  unavailable: { en: 'This project snapshot is unsupported or invalid. The raw snapshot is read-only and can still be downloaded.', zh: '此项目快照不受支持或无效。原始快照为只读，仍可下载。' },
  boundaries: { en: 'Explicit local text resources. Includes stay inert; no plugins, code, filesystem discovery or remote fetches. Preview shows the entry document, not a multi-page site.', zh: '仅使用显式提供的本地文本资源。包含指令保持静态，不执行插件或代码，不扫描文件或获取远程内容。预览仅展示入口文档，并非多页网站。' },
} as const;
