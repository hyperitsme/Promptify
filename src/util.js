// src/util.js — robust fence stripper
export async function toDataURL(file) {
  if (!file) return undefined;
  const base64 = file.buffer.toString('base64');
  const mime = file.mimetype || 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

export function sanitizeHTMLFromModel(text) {
  if (!text) return '';
  // Ambil isi di dalam fence ```html ... ``` ATAU ``` ... ```
  // Toleran terhadap \n / \r\n dan spasi
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
  const raw = fence ? fence[1] : text;
  // Jika model menambahkan markdown lain, jangan di-strip berlebihan—cukup trim.
  return String(raw).trim();
}
