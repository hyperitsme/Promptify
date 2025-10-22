// src/util.js
export async function toDataURL(file) {
  if (!file) return undefined;
  const base64 = file.buffer.toString('base64');
  const mime = file.mimetype || 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

export function sanitizeHTMLFromModel(text) {
  if (!text) return '';
  // strip ```html fences if model menambahkan fence
  const fenced = text.match(/```(?:html)?\n([\s\S]*?)\n```/i);
  const raw = fenced ? fenced[1] : text;
  return raw.trim();
}
