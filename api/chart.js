// api/chart.js  — Vercel Serverless (CommonJS)

const fetch = require("node-fetch");

// ====== C O N F I G ======
const ALLOWED_ORIGINS = new Set([
  "https://misastros.com",
  "https://www.misastros.com",
  "https://jauxxx-v4.myshopify.com", // tu dominio Shopify
  "http://localhost:3000",
  "http://localhost:5173",
]);

const ASTRO_BASE = "https://json.astrologyapi.com/v1";

// Endpoints usados (AstrologyAPI v1)
const EP_WESTERN_CHART = `${ASTRO_BASE}/western_chart_svg`;
const EP_PLANETS = `${ASTRO_BASE}/planets`;
const EP_ASCENDANT = `${ASTRO_BASE}/ascendant`;

// ====== H E L P E R S ======
function setCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
}

function bad(res, status, msg, detail) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: msg, detail: detail || null }));
}

async function ocGeocode(place) {
  const key = process.env.OPENCAGE_KEY;
  if (!key) throw new Error("Falta OPENCAGE_KEY");

  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
    place
  )}&key=${key}&limit=1&language=es&no_annotations=0`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`OpenCage ${r.status}`);
  const j = await r.json();
  const g = j.results && j.results[0];
  if (!g) throw new Error("Lugar no encontrado");

  return { lat: g.geometry.lat, lon: g.geometry.lng };
}

async function googleTimeZone(lat, lon) {
  // ✅ lee GOOGLE_API_KEY o GOOGLE_TZ_KEY (cualquiera de las dos)
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_TZ_KEY;
  if (!key) return { tzHours: 0, source: "fallback" };

  const ts = Math.floor(Date.now() / 1000);
  const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lon}&timestamp=${ts}&key=${key}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Google TZ ${r.status}`);
  const j = await r.json();
  if (j.status !== "OK") throw new Error(`Google TZ ${j.status}`);

  const total = (j.rawOffset || 0) + (j.dstOffset || 0);
  return { tzHours: total / 3600, source: "google" };
}

async function astroCall(endpoint, payload) {
  const id = process.env.ASTRO_USER_ID;
  const key = process.env.ASTRO_API_KEY;
  if (!id || !key) throw new Error("Faltan ASTRO_USER_ID / ASTRO_API_KEY");

  const auth = Buffer.from(`${id}:${key}`).toString("base64");
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`AstrologyAPI parse error: ${text.slice(0, 200)}`);
  }
  if (!r.ok) {
    const msg = j.message || j.error || `AstrologyAPI ${r.status}`;
    const err = new Error(msg);
    err.detail = j;
    throw err;
  }
  return j;
}

function normalizeChartUrl(resp) {
  return (
    resp.chart_url ||
    resp.chartUrl ||
    resp.svg_url ||
    resp.svgUrl ||
    null
  );
}

// ====== H A N D L E R ======
module.exports = async (req, res) => {
  try {
    const origin = req.headers.origin || "";
    setCors(res, origin);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method !== "POST") {
      return bad(res, 405, "Method Not Allowed. Use POST.");
    }

    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {}
    const { date, time, place } = body || {};
    if (!date || !time || !place) {
      return bad(res, 400, "Faltan parámetros", {
        need: ["date", "time", "place"],
      });
    }

    // 1) Geocodificación
    const { lat, lon } = await ocGeocode(place);

    // 2) Zona horaria
    const tz = await googleTimeZone(lat, lon).catch(() => ({
      tzHours: 0,
      source: "fallback",
    }));
    const timezone = tz.tzHours;

    // 3) Payload base
    const astroBase = {
      day: parseInt(date.split("-")[2], 10),
      month: parseInt(date.split("-")[1], 10),
      year: parseInt(date.split("-")[0], 10),
      hour: parseInt(time.split(":")[0] || "0", 10),
      min: parseInt(time.split(":")[1] || "0", 10),
      lat,
      lon,
      tzone: timezone,
    };

    // 4) Rueda
    const chartResp = await astroCall(EP_WESTERN_CHART, astroBase);
    const chartUrl = normalizeChartUrl(chartResp);

    // 5) Planetas (Sol y Luna)
    const planetsResp = await astroCall(EP_PLANETS, astroBase);
    const sunObj = planetsResp.find((p) => /sun/i.test(p.name || ""));
    const moonObj = planetsResp.find((p) => /moon/i.test(p.name || ""));

    const sun = sunObj
      ? {
          sign:
            sunObj.sign || sunObj.sign_name || sunObj.signName || "",
          text: sunObj.full_degree
            ? `Grados: ${sunObj.full_degree}`
            : "",
        }
      : { sign: "", text: "" };

    const moon = moonObj
      ? {
          sign:
            moonObj.sign || moonObj.sign_name || moonObj.signName || "",
          text: moonObj.full_degree
            ? `Grados: ${moonObj.full_degree}`
            : "",
        }
      : { sign: "", text: "" };

    // 6) Ascendente
    const ascResp = await astroCall(EP_ASCENDANT, astroBase);
    const asc = {
      sign: ascResp.ascendant || ascResp.sign || ascResp.sign_name || "",
      text: ascResp.naksahtra || ascResp.nakshatra || "",
    };

    // ✅ Respuesta final
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(
      JSON.stringify(
        {
          chartUrl,
          sun,
          moon,
          asc,
          meta: { lat, lon, timezone, tzSource: tz.source || "unknown" },
        },
        null,
        2
      )
    );
  } catch (err) {
    return bad(res, 500, "Error interno del servidor", err.detail || err.message);
  }
};
