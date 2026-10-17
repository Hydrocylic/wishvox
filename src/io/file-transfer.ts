// r04 T6（D4）：浏览器文件传输机制——自 ui/App.tsx 的导入导出细节拆出（UI 按钮留在 App）。
// 对照 PetitMaker io/image-export 的 downloadBlob/downloadJSON 纯 DOM 工具（ARCH.md :1291-1293）。
/** 下载 JSON 文件（Blob → ObjectURL → 临时 <a> 点击 → 回收） */
export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 读取用户选择的文本文件 */
export function readTextFile(file: File): Promise<string> {
  return file.text()
}
