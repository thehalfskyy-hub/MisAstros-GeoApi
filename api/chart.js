// api/chart.js  (Vercel Serverless Function, NO-Next)

// ───────── CORS ─────────
const ALLOWED_ORIGINS = [
  "https://misastros.com",
  "https://www.misastros.com",
  "https://misastros.myshopify.com",
];

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : "";
  if (allow) res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
}

// ───────── Helpers ─────────
function bad(status, message, detail) {
  return { status, body: { error: message, detail } };
}
function ok(body) {
  return { status: 200, body };
}

function parseYMD(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}
function normalizeTime(t) {
  const s = String(t || "").trim().toLowerCase().replace(/\s/g, "");
  const m = s.match(/^(\d{1,2}):(\d{2})(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const suf = m[3];
  if (suf) {
    const isPm = /pm|p\.m\./.test(suf);
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${min}`;
}

async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} ${r.statusText}`);
    err.response = data;
    err.status = r.status;
    throw err;
  }
  return data;
}
function astroAuthHeaders() {
  const user = process.env.ASTRO_USER_ID;
  const key = process.env.ASTRO_API_KEY;
  const basic = Buffer.from(`${user}:${key}`).toString("base64");
  return { Authorization: `Basic ${basic}`, "Content-Type": "application/json" };
}
function unixTimestamp(ymd, hh, mm) {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, hh, mm, 0));
  return Math.floor(dt.getTime() / 1000);
}

// ───────── Geocoding + TZ ─────────
async function geocode(place) {
  const key = process.env.OPENCAGE_KEY;
  if (!key) throw new Error("Falta OPENCAGE_KEY");
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
    place
  )}&key=${key}&no_annotations=0&language=es`;
  const data = await fetchJSON(url);
  const best = data.results?.[0];
  if (!best) throw new Error("No se encontró el lugar");
  const lat = best.geometry?.lat;
  const lon = best.geometry?.lng;
  const ocTz = best.annotations?.timezone || null;
  return { lat, lon, ocTz };
}

async function resolveTimeZone(lat, lon, ymd, hh, mm) {
  const gkey = process.env.GOOGLE_API_KEY;
  if (gkey) {
    const ts = unixTimestamp(ymd, hh, mm);
    const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lon}&timestamp=${ts}&key=${gkey}`;
    const tz = await fetchJSON(url);
    if (tz.status !== "OK") throw new Error(`Google TZ: ${tz.status}`);
    return { offsetHours: (tz.dstOffset + tz.rawOffset) / 3600, tzId: tz.timeZoneId };
  }
  return { offsetHours: 0, tzId: null };
}

// ───────── AstrologyAPI ─────────
async function astroChart({ ymd, hh, mm, lat, lon, tzone }) {
  const url = "https://json.astrologyapi.com/v1/western_chart";
  const body = {
    day: ymd.d, month: ymd.m, year: ymd.y,
    hour: hh, min: mm, lat, lon, tzone,
  };
  const data = await fetchJSON(url, {
    method: "POST",
    headers: astroAuthHeaders(),
    body: JSON.stringify(body),
  });
  return data.chart_url || data.svg_url || data.chartUrl || null;
}
async function astroPlanets({ ymd, hh, mm, lat, lon, tzone }) {
  const url = "https://json.astrologyapi.com/v1/planets/tropical";
  const body = {
    day: ymd.d, month: ymd.m, year: ymd.y,
    hour: hh, min: mm, lat, lon, tzone,
  };
  const list = await fetchJSON(url, {
    method: "POST",
    headers: astroAuthHeaders(),
    body: JSON.stringify(body),
  });
  const byName = {};
  (list || []).forEach((p) => { if (p?.name) byName[p.name.toLowerCase()] = p; });
  return {
    sunSign: byName["sun"]?.sign || null,
    moonSign: byName["moon"]?.sign || null,
  };
}
async function astroAscendant({ ymd, hh, mm, lat, lon, tzone }) {
  const url = "https://json.astrologyapi.com/v1/ascendant";
  const body = {
    day: ymd.d, month: ymd.m, year: ymd.y,
    hour: hh, min: mm, lat, lon, tzone,
  };
  const data = await fetchJSON(url, {
    method: "POST",
    headers: astroAuthHeaders(),
    body: JSON.stringify(body),
  });
  return data.ascendant || data.sign || null;
}
const shortTexts = (sign) => ({
  sun: `Tu Sol en ${sign} marca el núcleo de tu identidad y tu fuerza vital.`,
  moon: `Tu Luna en ${sign} describe tu mundo emocional y cómo te cuidás.`,
  asc: `Tu Ascendente en ${sign} es tu puerta de entrada: cómo iniciás y cómo te ven.`,
});

// ───────── Handler ─────────
module.exports = async (req, res) => {
  try {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
      const { status, body } = bad(405, "Method Not Allowed. Use POST.");
      return res.status(status).json(body);
    }

    const { date, time, place } = req.body || {};
    if (!date || !time || !place) {
      const { status, body } = bad(400, "Faltan campos: date, time, place");
      return res.status(status).json(body);
    }

    const ymd = parseYMD(date);
    if (!ymd) {
      const { status, body } = bad(400, "Fecha inválida. Usá YYYY-MM-DD");
      return res.status(status).json(body);
    }

    const tt = normalizeTime(time);
    const m = /^(\d{2}):(\d{2})$/.exec(tt);
    if (!m) {
      const { status, body } = bad(400, "Hora inválida. Usá HH:MM (24h) o 4:30 pm");
      return res.status(status).json(body);
    }
    const hh = +m[1];
    const mm = +m[2];

    const { lat, lon } = await geocode(place);

    let tz;
    try {
      tz = await resolveTimeZone(lat, lon, ymd, hh, mm);
    } catch (e) {
      const { status, body } = bad(502, "Error al resolver zona horaria", e.message || e);
      return res.status(status).json(body);
    }

    const inputs = { ymd, hh, mm, lat, lon, tzone: tz.offsetHours };
    const [chartUrl, planets, ascSign] = await Promise.all([
      astroChart(inputs),
      astroPlanets(inputs),
      astroAscendant(inputs),
    ]);

    const sunSign = planets.sunSign || null;
    const moonSign = planets.moonSign || null;

    const payload = {
      chartUrl,
      sun: sunSign ? { sign: sunSign, text: shortTexts(sunSign).sun } : null,
      moon: moonSign ? { sign: moonSign, text: shortTexts(moonSign).moon } : null,
      asc: ascSign ? { sign: ascSign, text: shortTexts(ascSign).asc } : null,
      meta: { tzId: tz.tzId || null, tzone: tz.offsetHours },
    };

    const { status, body } = ok(payload);
    return res.status(status).json(body);
  } catch (err) {
    console.error("API /api/chart error:", err);
    const { status, body } = bad(
      err.status || 500,
      "Error interno del servidor",
      err.response || err.message || String(err)
    );
    return res.status(status).json(body);
  }
};
