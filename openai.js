import OpenAI from "openai";

/* ===== Quality gates ===== */
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
  return typeof html === "string" && /^<!doctype html>/i.test(html.trim());
}

/* ===== Prompts ===== */
function systemMsg() {
  return [
    "You are a professional web studio (brand copywriter + senior front-end engineer).",
    "Return ONLY a COMPLETE, VALID single-file index.html.",
    "Inline ALL CSS & JS. Absolutely NO external requests (fonts/scripts/iframes/CDNs).",
    "Semantic HTML, a11y roles, focus-visible, mobile-first responsive.",
    "Use CSS variables in :root for colors (primary, accent) and the system-ui font stack.",
    "Design language: colorful, tasteful animations (keyframes), playful pill buttons, hover lifts, soft shadows, glass/blur accents.",
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
    .hero{ background-image: url(%%BG_DATA_URL%%); }  // add overlay for readability
  If an asset is unavailable, still keep the element but it may be empty; the backend will replace or remove it.

STRUCTURE
- Sticky header with logo (using the marker), simple nav (About, Token & Utility, Roadmap, FAQ), and a playful primary CTA.
- Hero with big headline tied to the description, subheadline, CTAs, and background using the marker.
- 4–6 uniquely named features aligned with the description (NOT generic).
- Optional: short About / Token&Utility / Roadmap / FAQ.
- Social buttons for Telegram and X.
- Footer with © YEAR and simple links.

TECH
- Put ALL styles in a single <style> and ALL scripts in a single <script>.
- Use only system fonts; no external links.
- Start with <!doctype html>.
- Output ONLY the final HTML (no fences/no commentary).`;
}

function revisionPrompt(reason) {
  return `
REVISION:
Previous HTML failed because: ${reason}
Please return ONLY a COMPLETE, VALID single-file index.html that fixes the issue.
Keep animations, playful buttons, colorful style, and project-specific copy.
Respect the asset markers %%LOGO_DATA_URL%% and %%BG_DATA_URL%%.
No external resources. Start with <!doctype html>.`;
}

/* ===== Generator ===== */
export async function generateSiteHTML(payload) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.MODEL || "gpt-4o-mini";
  const maxRetries = Number(process.env.MAX_RETRIES || 2);

  const brief = {
    name: payload.name || "Untitled Project",
    ticker: payload.ticker || "$TOKEN",
    description: payload.description || payload.prompt || "A crypto project.",
    telegram: payload.telegram || payload.tgurl || "",
    twitter: payload.twitter || payload.xurl || "",
    primaryColor: (payload.colors && (payload.colors.primary || payload.colors?.primaryColor)) || "#7c3aed",
    accentColor: (payload.colors && (payload.colors.accent || payload.colors?.accentColor)) || "#06b6d4",
    // kita TIDAK mengirim base64 panjang ke model; kita injeksikan setelah lulus quality-gate
    logoDataUrl: payload.assets?.logo || payload.logo || "",
    backgroundDataUrl: payload.assets?.background || payload.background || ""
  };

  const baseInput = [
    { role: "system", content: systemMsg() },
    { role: "user", content: JSON.stringify({ ...brief, logoDataUrl: "%%LOGO_DATA_URL%%", backgroundDataUrl: "%%BG_DATA_URL%%" }) }
  ];

  let attempts = 0;
  let html = "";
  let lastReason = "";

  while (attempts <= maxRetries) {
    attempts++;
    const input = [
      ...baseInput,
      { role: "user", content: attempts === 1 ? primaryPrompt(brief) : revisionPrompt(lastReason) }
    ];

    // Build request body (temperature opsional)
    const req = {
      model,
      max_output_tokens: 7000,
      input
    };
    if (process.env.TEMPERATURE) {
      const t = Number(process.env.TEMPERATURE);
      if (!Number.isNaN(t)) req.temperature = t;
    }

    const res = await client.responses.create(req);
    html = (res.output_text || "").trim();

    // Gates
    if (!isValidHTML(html)) { lastReason = "HTML must start with <!doctype html>."; continue; }
    if (violatesExternal(html)) { lastReason = "Contains external resources (fonts/scripts/iframes/CDNs)."; continue; }
    if (hasBannedHeadings(html)) { lastReason = "Uses generic headings (Fast/Customizable/Reliable)."; continue; }
    if (!html.includes("%%LOGO_DATA_URL%%") && !html.includes("%%BG_DATA_URL%%")) {
      lastReason = "Missing asset placeholders %%LOGO_DATA_URL%% / %%BG_DATA_URL%%.";
      continue;
    }
    break; // passed
  }

  if (!isValidHTML(html)) {
    throw new Error(`AI generation failed after retries: ${lastReason || "invalid HTML"}`);
  }

  // Inject placeholders
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

  // Validasi akhir
  if (!isValidHTML(html) || violatesExternal(html)) {
    throw new Error("Injection produced invalid HTML (unexpected).");
  }

  return html;
}
