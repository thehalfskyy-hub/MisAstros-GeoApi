// api/places.js — Vercel Serverless (CommonJS, Node 18/22 => fetch global)

// === Config ===
const ALLOWED_ORIGINS = new Set([
  "https://misastros.com",
  "https://www.misastros.com",
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
  res.end(JSON.stringify({ error: msg, detail: detail || null }));
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

    // parsear ?q=
    const { URL } = require("url");
    const url = new URL(req.url, "http://localhost");
    const q = (url.searchParams.get("q") || "").trim();

    if (!q || q.length < 3) {
      return bad(res, 400, "Parámetro 'q' mínimo 3 caracteres");
    }

    const key = process.env.OPENCAGE_KEY;
    if (!key) return bad(res, 500, "Falta OPENCAGE_KEY");

    const ocURL =
      "https://api.opencagedata.com/geocode/v1/json?q=" +
      encodeURIComponent(q) +
      `&key=${key}&limit=6&language=es&no_annotations=1`;

    const r = await fetch(ocURL);
    if (!r.ok) return bad(res, r.status, `OpenCage ${r.status}`);
    const j = await r.json();

    const items = (j.results || []).map((g) => ({
      formatted: g.formatted,              // "Barcelona, España"
      lat: g.geometry?.lat ?? null,
      lon: g.geometry?.lng ?? null,
      // opcionalmente expongo componentes principales para UI
      city: g.components?.city || g.components?.town || g.components?.village || null,
      state: g.components?.state || null,
      country: g.components?.country || null,
    }));

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ items }, null, 2));
  } catch (err) {
    return bad(res, 500, "Error interno del servidor", err.message);
  }
};
