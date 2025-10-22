// src/server.js  — FIXED
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

// Uploads (logo/bg)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 2 }, // 2MB each
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get('/api/health', (_, res) =>
  res.json({ ok: true, service: 'promptify-backend', time: new Date().toISOString() })
);

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

app.post(
  '/api/generate',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'bg', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
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

      const logoDataURL = req.files?.logo?.[0] ? await toDataURL(req.files.logo[0]) : undefined;
      const bgDataURL = req.files?.bg?.[0] ? await toDataURL(req.files.bg[0]) : undefined;

      const system = buildSystemPrompt();
      const userContent = [
        { type: 'text', text: `Project name: ${data.name}` },
        { type: 'text', text: `Ticker: ${data.ticker}` },
        { type: 'text', text: `Description: ${data.prompt}` },
        { type: 'text', text: `Colors => primary: ${data.colors.primary}, accent: ${data.colors.accent}, bg: ${data.colors.bg}` },
        { type: 'text', text: `Social => x: ${data.xurl || ''}, telegram: ${data.tgurl || ''}` },
      ];
      if (logoDataURL) userContent.push({ type: 'input_image', image_url: logoDataURL });
      if (bgDataURL) userContent.push({ type: 'input_image', image_url: bgDataURL });

      const model = process.env.MODEL || 'gpt-5';
      const temperature = Number(process.env.TEMPERATURE || 0.4);
      const maxTokens = Number(process.env.MAX_TOKENS || 4000);

      const ai = await openai.responses.create({
        model,
        temperature,
        max_output_tokens: maxTokens,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      });

      let html = sanitizeHTMLFromModel(ai.output_text || '');

      // If model didn't return a full HTML doc, wrap safely
      const lower = html.trim().toLowerCase();
      const looksLikeHTML = lower.startsWith('<!doctype html') || lower.startsWith('<html');
      if (!looksLikeHTML) {
        const safeBody = html.replace(/[<]/g, '&lt;').replace(/[>]/g, '&gt;');
        html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${data.name} — ${data.ticker}</title></head><body><pre style="white-space:pre-wrap;font-family:ui-monospace,monospace">${safeBody}</pre></body></html>`;
      }

      // Inject color tokens & try to apply assets if present
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
      console.error(err);
      res.status(500).json({ error: 'Generation failed', details: String(err?.message || err) });
    }
  }
);

app.listen(port, () => console.log('Promptify backend listening on :' + port));
