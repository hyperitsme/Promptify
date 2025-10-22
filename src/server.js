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

// Render/Proxy: penting untuk rate-limit & ip detection
app.set('trust proxy', 1);

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

// ---- Rate limit ----
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

// ---- Helper: default HTML bila AI kosong ----
function fallbackHTML({ name, ticker, prompt, colors, logoDataURL, bgDataURL, xurl, tgurl }) {
  const cssBg = bgDataURL ? `background-image:url('${bgDataURL}');background-size:cover;background-position:center;` : '';
  const logo = logoDataURL ? `<img src="${logoDataURL}" alt="${name} logo" style="width:56px;height:56px;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.35)" />` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${name} — ${ticker}</title>
<style>
:root{--primary:${colors.primary};--accent:${colors.accent};--bg:${colors.bg};--ink:#e9ecff;--muted:#aab6d8}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:radial-gradient(1000px 600px at 70% -10%,rgba(109,97,255,.25),transparent 60%),linear-gradient(180deg,var(--bg),#0b0e1d);color:var(--ink);font-family:ui-sans-serif,system-ui,Inter,Segoe UI,Roboto,Arial}
.container{max-width:1100px;margin:36px auto;padding:0 16px}
.card{border:1px solid rgba(255,255,255,.08);border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.03));box-shadow:0 0 0 1px rgba(123,110,255,.14),0 14px 44px rgba(88,70,255,.18);overflow:hidden}
.hero{display:flex;gap:24px;align-items:center;padding:24px;border-bottom:1px solid rgba(255,255,255,.08);${cssBg}}
h1{margin:0;font-size:28px;letter-spacing:.2px}
.badge{display:inline-block;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;padding:6px 10px;border-radius:999px;font-weight:700;box-shadow:0 10px 34px rgba(104,88,255,.35)}
p{color:var(--muted);line-height:1.6}
.btn{display:inline-block;margin-top:8px;background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:700;box-shadow:0 10px 34px rgba(104,88,255,.35)}
.btn:hover{transform:translateY(-2px);box-shadow:0 18px 64px rgba(104,88,255,.45)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px}
.tile{padding:18px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.03)}
a.link{color:var(--ink)}
@media (max-width:860px){.hero{flex-direction:column;align-items:flex-start}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="hero">
        ${logo}
        <div>
          <div class="badge">${ticker}</div>
          <h1>${name}</h1>
          <p>${prompt}</p>
        </div>
      </div>
      <div class="grid">
        <div class="tile"><h3>About</h3><p>${prompt}</p></div>
        <div class="tile"><h3>Follow</h3>
          <p>${xurl ? `<a class="link" href="${xurl}" target="_blank" rel="noopener">X (Twitter)</a>` : '—'}</p>
          <p>${tgurl ? `<a class="link" href="${tgurl}" target="_blank" rel="noopener">Telegram</a>` : '—'}</p>
          <a class="btn" href="#">Buy / Join</a>
        </div>
      </div>
    </div>
  </div>
</body></html>`;
}

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

      // OpenAI Responses API
      const system = buildSystemPrompt();
      const model = process.env.MODEL || 'gpt-5';
      const maxTokens = Number(process.env.MAX_TOKENS || 4000);

      const userParts = [
        { type: 'input_text', text: `Return ONLY a single-file HTML. Start with <!doctype html>.` },
        { type: 'input_text', text: `Project name: ${data.name}` },
        { type: 'input_text', text: `Ticker: ${data.ticker}` },
        { type: 'input_text', text: `Description: ${data.prompt}` },
        { type: 'input_text', text: `Colors => primary: ${data.colors.primary}, accent: ${data.colors.accent}, bg: ${data.colors.bg}` },
        { type: 'input_text', text: `Social => x: ${data.xurl || ''}, telegram: ${data.tgurl || ''}` },
      ];
      if (logoDataURL) userParts.push({ type: 'input_image', image_url: logoDataURL });
      if (bgDataURL) userParts.push({ type: 'input_image', image_url: bgDataURL });

      const payload = {
        model,
        max_output_tokens: maxTokens,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: userParts },
        ],
      };

      const ai = await openai.responses.create(payload);

      // ---- Robust extraction ----
      let html = (ai && typeof ai.output_text === 'string') ? ai.output_text : '';
      if (!html || !html.trim()) {
        // try to read from structured output
        try {
          const out = ai?.output || ai?.response || ai;
          // Some SDK versions expose as: output -> [ { content: [ { type:'output_text', text:'...' } ] } ]
          const first = Array.isArray(out) ? out[0] : null;
          const content = first?.content || [];
          const ot = content.find(c => c.type === 'output_text');
          if (ot?.text) html = ot.text;
        } catch (_) {}
      }

      html = sanitizeHTMLFromModel(html || '');

      // ---- Fallback if still empty (no blank pages) ----
      const lower = html.trim().toLowerCase();
      const looksLikeHTML = lower.startsWith('<!doctype html') || lower.startsWith('<html');
      if (!looksLikeHTML) {
        html = fallbackHTML({
          name: data.name,
          ticker: data.ticker,
          prompt: data.prompt,
          colors: data.colors,
          logoDataURL,
          bgDataURL,
          xurl: data.xurl,
          tgurl: data.tgurl,
        });
      } else {
        // Inject color tokens & try embed assets if selector generik ditemukan
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
      }

      res.json({ html });
    } catch (err) {
      const apiErr = err?.response?.data || err?.data || err?.message || err;
      console.error('Generation failed:', apiErr);
      res.status(500).json({ error: 'Generation failed', details: apiErr });
    }
  }
);

app.listen(port, () => console.log('Promptify backend listening on :' + port));
