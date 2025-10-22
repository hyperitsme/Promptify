import "dotenv/config";
import express from "express";
import cors from "cors";
import { customAlphabet } from "nanoid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateSiteHTML } from "./openai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1); // important on Render/behind proxy

// ---- ENV ----
const PORT = process.env.PORT || 8080;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const BODY_LIMIT = process.env.BODY_LIMIT || "15mb";

// Support comma-separated origins: "https://a.com,https://b.com"
const ORIGIN_ENV = (process.env.ALLOWED_ORIGIN || "*").trim();
const ALLOWED_ORIGINS =
  ORIGIN_ENV === "*"
    ? "*"
    : ORIGIN_ENV
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

// ---- CORS ----
const corsOptions = {
  origin: ALLOWED_ORIGINS === "*" ? true : (origin, cb) => {
    // allow same-origin/non-browser or listed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: false,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // preflight

// ---- Body parsers ----
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// ---- Static folder for generated sites (ephemeral on Render) ----
const SITES_DIR = path.join(__dirname, "sites");
fs.mkdirSync(SITES_DIR, { recursive: true });
app.use("/sites", express.static(SITES_DIR, {
  extensions: ["html"],
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
  }
}));

// ---- Health ----
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- Generator ----
app.post("/generate-site", async (req, res) => {
  try {
    const nano = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);
    const id = `site_${nano()}`;
    const payload = req.body || {};

    if (!payload?.name && !payload?.description) {
      return res.status(400).json({ error: "Missing required fields (name or description)." });
    }

    const html = await generateSiteHTML(payload);

    const sitePath = path.join(SITES_DIR, id);
    fs.mkdirSync(sitePath, { recursive: true });
    fs.writeFileSync(path.join(sitePath, "index.html"), html, "utf8");

    const url = `${BASE_URL}/sites/${id}/`;
    return res.json({ id, url, html, source: "ai", quality_gate: "passed" });
  } catch (err) {
    const message = err?.message || String(err);
    console.error("AI generation error:", message);
    return res.status(502).json({
      error: "AI_GENERATION_FAILED",
      message: "Generator could not produce a high-quality HTML page.",
      detail: message
    });
  }
});

// ---- Root ----
app.get("/", (_req, res) => {
  res
    .type("text")
    .send("Promptify Generator API is running. POST /generate-site");
});

// ---- 404 fallback ----
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// ---- Start ----
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
  console.log(`Health: ${BASE_URL}/health`);
  console.log(`Sites:  ${BASE_URL}/sites/<id>/`);
});
