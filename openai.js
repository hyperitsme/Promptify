import OpenAI from "openai";

/* =========================
   Quality Gates & Helpers
   ========================= */

const BANNED_HEADINGS = [/^\s*fast\s*$/i, /^\s*customizable\s*$/i, /^\s*reliable\s*$/i];

function violatesExternal(html) {
  return /(https?:)?\/\/(fonts\.|cdnjs|unpkg|cdn\.|googleapis|gstatic|jsdelivr|bootstrap|tailwindcss)/i.test(html)
    || /\b<link\b[^>]*rel=["']stylesheet/i.test(html)
    || /\b<script\b[^>]*src=/i.test(html)
    || /\b@import\b/i.test(html)
    || /\b<iframe\b/i.test(html);
}

function hasBannedHeadings(html) {
  const matches = [...html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis)];
  return matches.some(m => {
    const text = (m[1] || "").replace(/<[^>]+>/g, "").trim();
    return BANNED_HEADINGS.some(rx => rx.test(text));
  });
}

function isValidHTML(html) {
  if (typeof html !== "string") return false;
  return /^<!doctype html>/i.test(html.trim());
}

/** Remove code fences, preambles, and keep from <!doctype html> downward */
function sanitizeHTML(raw) {
  if (!raw) return "";
  let s = String(raw).trim();

  // remove markdown fences if present
  s = s.replace(/^```(?:html|HTML)?\s*/i, "").replace(/```$/i, "");
  // find doctype
  const i = s.toLowerCase().indexOf("<!doctype html>");
  if (i >= 0) s = s.slice(i);

  // strip invisible BOMs etc
  s = s.replace(/^\uFEFF/, "");

  return s.trim();
}

/* =========================
   Prompts
   ========================= */

function systemMsg() {
  return [
    "You are a professional web studio (brand copywriter + senior front-end engineer).",
    "Return ONLY a COMPLETE, VALID single-file HTML document.",
    "Start with EXACTLY: <!doctype html> (lowercase). No preface, no backticks, no explanations.",
    "Inline ALL CSS & JS. Absolutely NO external requests (fonts/scripts/iframes/CDNs).",
    "Semantic HTML, mobile-first responsive, a11y (roles, focus-visible).",
    "Use CSS variables in :root for colors (primary, accent) and system-ui font stack.",
    "Design: vibrant dark theme, tasteful keyframe animations, hover lift, soft neon shadows, glass blur.",
    "Copywriting MUST be specific to the given project description.",
    "Never use generic section titles like “Fast”, “Customizable”, or “Reliable”.",
    "Do NOT mention prompts, models, or how it was generated."
  ].join(" ");
}

function primaryPrompt(brief) {
  const { name, ticker, description, telegram, twitter, primaryColor, accentColor } = brief;

  return `
Build a polished landing page.

PROJECT
- Name: ${name}
- Ticker: ${ticker || ""}
- Description: ${description}
- Telegram: ${telegram || ""}
- X/Twitter: ${twitter || ""}

THEME
- :root { --primary: ${primaryColor}; --accent: ${accentColor}; }
- Dark background, high contrast, vibrant accents.

ASSETS (IMPORTANT)
- Insert these markers exactly and use them in the HTML:
  - LOGO: "%%LOGO_DATA_URL%%"
  - BACKGROUND: "%%BG_DATA_URL%%"
  Example usage:
    <img src="%%LOGO_DATA_URL%%" alt="project logo" class="logo">
    .hero{ background-image: url(%%BG_DATA_URL%%); } /* add overlay for readability */
  If an asset is unavailable, still keep the element but it may be empty; the backend will replace or remove it.

STRUCTURE
- Sticky header with logo (marker), nav (About, Token & Utility, Roadmap, FAQ), and a playful primary CTA.
- Hero with strong headline tied to the description, subheadline, CTAs, and background using the marker.
- 4–6 uniquely named features aligned with the description (NOT generic).
- Optional: short About / Token&Utility / Roadmap / FAQ.
- Social buttons for Telegram and X.
- Footer with © YEAR and simple links.

TECH
- Put ALL styles in a single <style> and ALL scripts in a single <script>.
- Use only system fonts; no external links.
- Output ONLY the final HTML (no fences/no commentary).`;
}

function revisionPrompt(reason) {
  return `
REVISION:
Previous HTML failed because: ${reason}
Please return ONLY a COMPLETE, VALID single-file HTML that starts with <!doctype html>.
Keep animations, playful buttons, colorful style, and project-specific copy.
Respect asset markers %%LOGO_DATA_URL%% and %%BG_DATA_URL%%.
No external resources.`;
}

/* =========================
   Fallback Template (never blank)
   ========================= */
function fallbackTemplate(brief) {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${brief.name} — ${brief.ticker}</title>
<style>
  :root{--primary:${brief.primaryColor};--accent:${brief.accentColor}}
  *{box-sizing:border-box}html,body{height:100%}
  body{margin:0;background:#0b0f1d;color:#e9ecff;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu}
  .wrap{max-width:1100px;margin:0 auto;padding:24px}
  header{display:flex;gap:12px;align-items:center;position:sticky;top:0;padding:12px 0;background:linear-gradient(180deg,#0b0f1dd9,#0b0f1d00)}
  header .logo{width:34px;height:34px;border-radius:9px;background:#1a1f33;display:grid;place-items:center;box-shadow:0 0 0 1px #242a44, 0 0 24px #1a1f33}
  header .logo img{max-width:26px;max-height:26px}
  .badge{background:#2e365f;color:#d9e0ff;padding:4px 10px;border-radius:999px;font-weight:600}
  .hero{position:relative;border-radius:16px;padding:48px;overflow:hidden;background:#0e1224;box-shadow:0 0 0 1px #1f2542, 0 25px 80px #080b18}
  .hero::before{content:"";position:absolute;inset:0;background-image:url(%%BG_DATA_URL%%);background-size:cover;background-position:center;opacity:.15;filter:blur(2px)}
  .hero h1{margin:0 0 8px;font-size:40px}
  .hero p{margin:0 0 18px;max-width:720px;opacity:.9}
  .cta{display:flex;gap:12px;flex-wrap:wrap}
  .btn{appearance:none;border:0;border-radius:999px;padding:12px 18px;background:var(--primary);color:#fff;font-weight:700;cursor:pointer;box-shadow:0 8px 30px #0e1348}
  .btn.ghost{background:#0f1431;box-shadow:inset 0 0 0 1px #27305a;color:#d9e0ff}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:28px 0}
  .card{background:#0e1224;border-radius:14px;padding:16px;box-shadow:0 0 0 1px #20264a}
  footer{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:40px 0 8px;opacity:.8}
</style>
<body>
  <div class="wrap">
    <header>
      <div class="logo"><img src="%%LOGO_DATA_URL%%" alt=""></div>
      <span class="badge">${brief.ticker}</span>
    </header>

    <section class="hero">
      <h1>${brief.name}</h1>
      <p>${brief.description}</p>
      <div class="cta">
        ${brief.twitter ? `<a class="btn" href="${brief.twitter}" target="_blank" rel="noopener">Follow on X</a>` : ``}
        ${brief.telegram ? `<a class="btn ghost" href="${brief.telegram}" target="_blank" rel="noopener">Join Telegram</a>` : ``}
      </div>
    </section>

    <section class="cards">
      <div class="card"><strong>Token & Utility</strong><p>Clear breakdown of ${brief.ticker} purpose and benefits.</p></div>
      <div class="card"><strong>Roadmap</strong><p>Milestones and upcoming launches.</p></div>
      <div class="card"><strong>Community</strong><p>Links and ways to get involved.</p></div>
      <div class="card"><strong>Security</strong><p>Best practices and verifiable audits if any.</p></div>
    </section>

    <footer>
      <small>© ${year} ${brief.name}</small>
      <div>
        ${brief.twitter ? `<a href="${brief.twitter}" target="_blank" rel="noopener">X</a>` : ``}
        ${brief.telegram ? ` · <a href="${brief.telegram}" target="_blank" rel="noopener">Telegram</a>` : ``}
      </div>
    </footer>
  </div>
</body>
</html>`;
}

/* =========================
   Generator
   ========================= */

export async function generateSiteHTML(payload) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.MODEL || "gpt-4o-mini";
  const maxRetries = Number(process.env.MAX_RETRIES || 3);

  const brief = {
    name: payload.name || "Untitled Project",
    ticker: payload.ticker || "$TOKEN",
    description: payload.description || payload.prompt || "A crypto project.",
    telegram: payload.telegram || payload.tgurl || "",
    twitter: payload.twitter || payload.xurl || "",
    primaryColor: payload.colors?.primary || "#7c3aed",
    accentColor: payload.colors?.accent || "#06b6d4",
    // NOTE: kita tidak kirim base64 ke model; kita injeksi setelah lulus quality gate
    logoDataUrl: payload.assets?.logo || payload.logo || "",
    backgroundDataUrl: payload.assets?.background || payload.bg || ""
  };

  let attempts = 0;
  let html = "";
  let lastReason = "";

  while (attempts <= maxRetries) {
    attempts++;

    const input = [
      { role: "system", content: systemMsg() },
      // ringkasan terstruktur + placeholders agar jelas
      { role: "user", content: JSON.stringify({
          ...brief,
          // kirim placeholder agar model menaruhnya di HTML
          logoDataUrl: "%%LOGO_DATA_URL%%",
          backgroundDataUrl: "%%BG_DATA_URL%%"
        })
      },
      { role: "user", content: attempts === 1 ? primaryPrompt(brief) : revisionPrompt(lastReason) }
    ];

    const res = await client.responses.create({
      model,
      max_output_tokens: 7000,
      // lebih deterministik bisa kecilkan temperature jika perlu
      temperature: 0.8,
      input
    });

    const raw = (res.output_text || "").trim();
    html = sanitizeHTML(raw);

    // quality gates
    if (!isValidHTML(html)) { lastReason = "HTML must start with <!doctype html>."; continue; }
    if (violatesExternal(html)) { lastReason = "Contains external resources (fonts/scripts/iframes/CDNs)."; continue; }
    if (hasBannedHeadings(html)) { lastReason = "Uses generic headings (Fast/Customizable/Reliable)."; continue; }
    if (!html.includes("%%LOGO_DATA_URL%%") && !html.includes("%%BG_DATA_URL%%")) {
      lastReason = "Missing asset placeholders %%LOGO_DATA_URL%% / %%BG_DATA_URL%%.";
      continue;
    }

    break; // passed
  }

  // fallback kalau tetap gagal
  if (!isValidHTML(html)) {
    // buat fallback minimal yang selalu valid supaya UI tidak blank
    html = fallbackTemplate(brief);
  }

  // inject data URL / default
  const inject = (h) => {
    if (brief.logoDataUrl) {
      h = h.replaceAll("%%LOGO_DATA_URL%%", brief.logoDataUrl);
    } else {
      h = h.replaceAll("%%LOGO_DATA_URL%%", "");
    }
    if (brief.backgroundDataUrl) {
      h = h.replaceAll("%%BG_DATA_URL%%", brief.backgroundDataUrl);
    } else {
      h = h.replaceAll("%%BG_DATA_URL%%", "none");
    }
    return h;
  };

  html = inject(html);

  // final re-check
  if (!isValidHTML(html) || violatesExternal(html)) {
    // jika injeksi aneh, paksa fallback (anti blank)
    html = inject(fallbackTemplate(brief));
  }

  return html;
}
