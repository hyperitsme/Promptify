import OpenAI from "openai";

/* =========================================================
   Promptify HTML Generator (Full AI Layout + Quality Gates)
   - Single-file index.html (no CDN/external fetch)
   - Neon/glass/hover/scroll-anim encouraged (bukan wajib)
   - Warna, logo, background dari dashboard diinject
   - Auto-retry kalau output tidak valid/jelek
   ========================================================= */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Konfigurasi
const MODEL = process.env.MODEL || "gpt-4o";
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_TOKENS || 7000);

/* ---------- Gate helpers ---------- */
const isValidHTML = (html) =>
  typeof html === "string" && /^<!doctype html>/i.test(html.trim());

const hasExternal = (html) =>
  /(https?:)?\/\/(fonts\.|cdnjs|unpkg|cdn\.|googleapis|gstatic|jsdelivr|bootstrap|tailwindcss)/i.test(html) ||
  /\b<link\b[^>]*rel=["']stylesheet/i.test(html) ||
  /\b<script\b[^>]*src=/i.test(html) ||
  /\b@import\b/i.test(html) ||
  /\b<iframe\b/i.test(html);

const tooGenericHeading = (html) => {
  const banned = [/^\s*fast\s*$/i, /^\s*customizable\s*$/i, /^\s*reliable\s*$/i];
  const matches = [...html.matchAll(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis)];
  return matches.some((m) => {
    const text = (m[1] || "").replace(/<[^>]+>/g, "").trim();
    return banned.some((rx) => rx.test(text));
  });
};

// sebagian model kadang tidak menerima 'temperature'
const maybeTemperature = () => {
  const envT = process.env.TEMPERATURE;
  if (!envT) return undefined;
  const t = Number(envT);
  if (Number.isFinite(t)) return t;
  return undefined;
};

/* ---------- Prompts ---------- */
function systemMessage() {
  return [
    "You are a top-tier web designer & senior front-end engineer.",
    "Return ONLY a COMPLETE, VALID single-file index.html. No commentary.",
    "Inline ALL CSS & JS. Absolutely NO external requests (fonts/scripts/iframes/CDNs).",
    "Use semantic HTML, excellent a11y (landmarks, labels, focus-visible), and mobile-first responsiveness.",
    "Design language (guideline, not constraint): neon glow, tasteful glassmorphism, hover lifts, soft shadows, subtle parallax, scroll-reveal animations.",
    "Use CSS variables in :root for colors: --primary, --accent, and use the system-ui font stack.",
    "The page must feel premium and lively with an immersive hero. Keep bundle lean.",
  ].join(" ");
}

function primaryPrompt(brief) {
  // Jelaskan semua kebutuhan UI secara eksplisit agar hasil “wah”
  return `
Build a polished, animated landing page for a crypto/Web3 style project.

PROJECT BRIEF
- Name: ${brief.name}
- Ticker: ${brief.ticker}
- Description: ${brief.description}
- Socials: X = ${brief.twitter || "-"} • Telegram = ${brief.telegram || "-"}
- Theme colors: --primary: ${brief.primaryColor} • --accent: ${brief.accentColor}

ASSETS (IMPORTANT — PLACEHOLDERS):
- Use these exact placeholders in the HTML and styles:
  - LOGO image: "%%LOGO_DATA_URL%%"
  - BACKGROUND image: "%%BG_DATA_URL%%"
  Example:
    <img src="%%LOGO_DATA_URL%%" alt="project logo" class="logo">
    .hero{ background-image: url(%%BG_DATA_URL%%); }

STRUCTURE
- Sticky header with logo (use the logo placeholder), project name/ticker, simple nav (About, Token & Utility, Roadmap, FAQ), and a primary CTA.
- Hero: big headline tied to the description, subheadline, CTA buttons (X/Telegram if provided), background uses BACKGROUND placeholder with overlay for readability.
- 4–6 unique features (avoid generic labels like “Fast/Customizable/Reliable”).
- Sections: About, Token & Utility (bullets/grid), Roadmap (steps), FAQ (details/summary).
- Footer: © YEAR, socials if provided.

INTERACTION & FINISHING
- Hover states on cards & buttons (lift + glow).
- Scroll reveal (via IntersectionObserver) that progressively reveals .reveal elements.
- Keyframe-based accent animations for subtle glow/orb/particle, but keep it elegant and performant.
- Focus-visible and reduced-motion friendly.

RULES
- Start with <!doctype html>.
- Put ALL styles in a single <style> and ALL scripts in a single <script>.
- Use only system fonts (no external links).
- Include color variables in :root using provided colors.
- Never mention prompts/models or how it was generated.
- Output ONLY the final HTML (no fences/no extra text).`;
}

function revisionPrompt(reason) {
  return `
REVISION NEEDED:
Last HTML failed because: ${reason}
Please return ONLY a COMPLETE, VALID single-file index.html that fixes it.
Keep the same project brief, placeholders, animations, and premium style. No external resources. Start with <!doctype html>.`;
}

/* ---------- Main generator ---------- */
export async function generateSiteHTML(payload) {
  const brief = {
    name: payload.name || "Untitled Project",
    ticker: payload.ticker || "$TOKEN",
    description: payload.prompt || payload.description || "A modern crypto project website.",
    telegram: payload.tgurl || payload.telegram || "",
    twitter: payload.xurl || payload.twitter || "",
    primaryColor:
      payload.colors?.primary ||
      payload["colors[primary]"] ||
      "#7c3aed",
    accentColor:
      payload.colors?.accent ||
      payload["colors[accent]"] ||
      "#06b6d4",
    logoDataUrl: payload.assets?.logo || payload.logo || "",
    backgroundDataUrl: payload.assets?.background || payload.bg || ""
  };

  let attempts = 0;
  let html = "";
  let lastReason = "";

  while (attempts <= MAX_RETRIES) {
    attempts++;

    const input = [
      { role: "system", content: systemMessage() },
      {
        role: "user",
        content: JSON.stringify({
          project: {
            name: brief.name,
            ticker: brief.ticker,
            description: brief.description,
            socials: { twitter: brief.twitter, telegram: brief.telegram }
          },
          theme: { primary: brief.primaryColor, accent: brief.accentColor },
          // kirim placeholder agar model pakai elemen gambar yang bisa kita inject nanti
          assets: {
            logo: "%%LOGO_DATA_URL%%",
            background: "%%BG_DATA_URL%%"
          }
        })
      },
      { role: "user", content: attempts === 1 ? primaryPrompt(brief) : revisionPrompt(lastReason) }
    ];

    const req = {
      model: MODEL,
      input,
      max_output_tokens: MAX_OUTPUT_TOKENS
    };
    const t = maybeTemperature();
    if (t !== undefined) req.temperature = t;

    const res = await client.responses.create(req);

    html = (res.output_text || "").trim();

    // Gates
    if (!isValidHTML(html)) {
      lastReason = "HTML must start with <!doctype html>.";
      continue;
    }
    if (hasExternal(html)) {
      lastReason = "Contains external resources (fonts/scripts/iframes/CDNs).";
      continue;
    }
    if (tooGenericHeading(html)) {
      lastReason = "Uses generic headings (Fast/Customizable/Reliable).";
      continue;
    }
    // pastikan ada placeholder agar bisa diinject
    if (!html.includes("%%LOGO_DATA_URL%%") && !html.includes("%%BG_DATA_URL%%")) {
      lastReason = "Missing placeholders %%LOGO_DATA_URL%% / %%BG_DATA_URL%%.";
      continue;
    }

    // Lolos
    break;
  }

  if (!isValidHTML(html)) {
    throw new Error(
      `AI generation failed after retries: ${lastReason || "invalid HTML"}`
    );
  }

  // Inject assets & warna fallback aman
  const inject = (h) => {
    h = h.replaceAll("%%LOGO_DATA_URL%%", brief.logoDataUrl || "");
    h = h.replaceAll("%%BG_DATA_URL%%", brief.backgroundDataUrl || "none");

    // jika model lupa set var warna, tambahkan di <style>
    if (!/--primary\s*:/.test(h) || !/--accent\s*:/.test(h)) {
      h = h.replace(
        /<style>/i,
        `<style>:root{--primary:${brief.primaryColor};--accent:${brief.accentColor};}</style><style>`
      );
    }
    return h;
  };

  html = inject(html);

  // final sanity
  if (!isValidHTML(html) || hasExternal(html)) {
    throw new Error("Final HTML failed validation after injection.");
  }

  return html;
}
