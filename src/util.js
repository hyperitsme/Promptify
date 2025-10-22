// src/util.js — fence stripper yang toleran
export async function toDataURL(file) {
  if (!file) return undefined;
  const base64 = file.buffer.toString('base64');
  const mime = file.mimetype || 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

export function sanitizeHTMLFromModel(text) {
  if (!text) return '';
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
  const raw = fence ? fence[1] : text;
  return String(raw).trim();
}
