// src/server.js — Responses API (input_text/input_image), no temperature param
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { OpenAI } from 'openai';
import { z } from 'zod';
import { buildSystemPrompt } from './systemPrompt.js';
import { toDataURL, sanitizeHTMLFromModel } from './util.js';

const app = express();
const port = process.env.PORT || 8080;

// ---- CORS allowlist ----
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS: ' + origin));
    },
  })
);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use('/api/', limiter);

// ---- Uploads (logo/bg) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 2 }, // 2MB each
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Health ----
app.get('/api/health', (_, res) =>
  res.json({ ok: true, service: 'promptify-backend', time: new Date().toISOString() })
);

// ---- Schema ----
const GenSchema = z.object({
  name: z.string().min(1).max(60),
  ticker: z.string().min(1).max(16),
  prompt: z.string().min(8).max(4000),
  xurl: z.string().optional().default(''),
  tgurl: z.string().optional().default(''),
  colors: z.object({
    primary: z.string().default('#4d6bff'),
    accent: z.string().default('#8a5cff'),
    bg: z.string().default('#070811'),
  }),
});

// ---- Generate ----
app.post(
  '/api/generate',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'bg', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // normalize body
      const body = {
        name: req.body.name,
        ticker: req.body.ticker,
        prompt: req.body.prompt,
        xurl: req.body.xurl,
        tgurl: req.body.tgurl,
        colors: {
          primary: req.body['colors[primary]'] || req.body.primary || '#4d6bff',
          accent: req.body['colors[accent]'] || req.body.accent || '#8a5cff',
          bg: req.body['colors[bg]'] || req.body.bg || '#070811',
        },
      };

      const parsed = GenSchema.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      }
      const data = parsed.data;

      // files -> data URLs
      const logoDataURL = req.files?.logo?.[0] ? await toDataURL(req.files.logo[0]) : undefined;
      const bgDataURL = req.files?.bg?.[0] ? await toDataURL(req.files.bg[0]) : undefined;

      // OpenAI call (Responses API with input_text/input_image)
      const system = buildSystemPrompt();
      const model = process.env.MODEL || 'gpt-5';
      const maxTokens = Number(process.env.MAX_TOKENS || 4000);

      const userParts = [
        { type: 'input_text', text: `Project name: ${data.name}` },
        { type: 'input_text', text: `Ticker: ${data.ticker}` },
        { type: 'input_text', text: `Description: ${data.prompt}` },
        {
          type: 'input_text',
          text: `Colors => primary: ${data.colors.primary}, accent: ${data.colors.accent}, bg: ${data.colors.bg}`,
        },
        {
          type: 'input_text',
          text: `Social => x: ${data.xurl || ''}, telegram: ${data.tgurl || ''}`,
        },
      ];
      if (logoDataURL) userParts.push({ type: 'input_image', image_url: logoDataURL });
      if (bgDataURL) userParts.push({ type: 'input_image', image_url: bgDataURL });

      // Build request WITHOUT temperature
      const reqPayload = {
        model,
        max_output_tokens: maxTokens,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: userParts },
        ],
      };

      const ai = await openai.responses.create(reqPayload);

      // Extract final HTML
      let html = sanitizeHTMLFromModel(ai.output_text || '');

      // If not a full HTML doc, wrap safely so preview tetap jalan
      const lower = html.trim().toLowerCase();
      const looksLikeHTML = lower.startsWith('<!doctype html') || lower.startsWith('<html');
      if (!looksLikeHTML) {
        const safeBody = html.replace(/[<]/g, '&lt;').replace(/[>]/g, '&gt;');
        html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${data.name} — ${data.ticker}</title></head><body><pre style="white-space:pre-wrap;font-family:ui-monospace,monospace">${safeBody}</pre></body></html>`;
      }

      // Best-effort: inject color tokens & embed assets bila belum dipakai
      html = html.replace(
        '</head>',
        `<style>:root{--primary:${data.colors.primary};--accent:${data.colors.accent};--bg:${data.colors.bg};}</style></head>`
      );

      if (logoDataURL) {
        html = html
          .replace('<body', '<body data-logo="embedded"')
          .replace(/src="[^"]*logo[^"]*"/i, `src="${logoDataURL}"`);
      }
      if (bgDataURL) {
        html = html.replace(/background-image:[^;]+;/i, `background-image:url("${bgDataURL}");`);
      }

      res.json({ html });
    } catch (err) {
      // Log detail dari SDK bila ada
      const apiErr = err?.response?.data || err?.data || err?.message || err;
      console.error('Generation failed:', apiErr);
      res.status(500).json({ error: 'Generation failed', details: apiErr });
    }
  }
);

app.listen(port, () => console.log('Promptify backend listening on :' + port));
