// api/places.js — Vercel Serverless (CommonJS, Node 18/22 => fetch global)

// === Config ===
const ALLOWED_ORIGINS = new Set([
  "https://misastros.com",
  "https://www.misastros.com",
  "https://misastrosargentina.com",
  "https://www.misastrosargentina.com",
  "https://jauxxx-v4.myshopify.com",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function setCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
}

function bad(res, status, msg, detail) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: msg, detail: detail || null, items: [] }));
}

function cleanLang(value) {
  const raw = String(value || "es").toLowerCase();

  if (raw.startsWith("en")) return "en";
  if (raw.startsWith("es")) return "es";

  return "es";
}

module.exports = async (req, res) => {
  try {
    const origin = req.headers.origin || "";
    setCors(res, origin);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method !== "GET") {
      return bad(res, 405, "Method Not Allowed. Use GET.");
    }

    const { URL } = require("url");
    const url = new URL(req.url, "http://localhost");

    const q = (url.searchParams.get("q") || "").trim();

    const lang = cleanLang(
      url.searchParams.get("lang") ||
      url.searchParams.get("language") ||
      url.searchParams.get("locale")
    );

    if (!q || q.length < 3) {
      return bad(res, 400, "Parámetro 'q' mínimo 3 caracteres");
    }

    const key = process.env.OPENCAGE_KEY;
    if (!key) return bad(res, 500, "Falta OPENCAGE_KEY");

    const ocURL =
      "https://api.opencagedata.com/geocode/v1/json?q=" +
      encodeURIComponent(q) +
      "&key=" +
      encodeURIComponent(key) +
      "&limit=8" +
      "&language=" +
      encodeURIComponent(lang) +
      "&no_annotations=1";

    const r = await fetch(ocURL);

    if (!r.ok) {
      return bad(res, r.status, `OpenCage ${r.status}`);
    }

    const j = await r.json();

    const seen = new Set();

    const items = (j.results || [])
      .map((g) => {
        const c = g.components || {};

        const city =
          c.city ||
          c.town ||
          c.village ||
          c.hamlet ||
          c.municipality ||
          c.county ||
          "";

        const state =
          c.state ||
          c.province ||
          c.region ||
          "";

        const country = c.country || "";

        const parts = [city, state, country]
          .filter(Boolean)
          .filter((part, index, arr) => arr.indexOf(part) === index);

        const formatted = parts.length ? parts.join(", ") : g.formatted;

        return {
          formatted,
          lat: g.geometry?.lat ?? null,
          lon: g.geometry?.lng ?? null,
          city: city || null,
          state: state || null,
          country: country || null,
          lang,
        };
      })
      .filter((item) => {
        if (!item.formatted) return false;

        const key = item.formatted.toLowerCase();

        if (seen.has(key)) return false;

        seen.add(key);
        return true;
      })
      .slice(0, 6);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ items }, null, 2));
  } catch (err) {
    return bad(res, 500, "Error interno del servidor", err.message);
  }
};
