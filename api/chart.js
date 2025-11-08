// api/chart.js — Vercel Serverless (CommonJS) — Compatible con PLAN STARTER

// ====== C O N F I G ======
const ALLOWED_ORIGINS = new Set([
  "https://misastros.com",
  "https://www.misastros.com",
  "https://jauxxx-v4.myshopify.com",
  // helpers de desarrollo (podés quitar luego)
  "http://localhost:3000",
  "http://localhost:5173",
]);

const ASTRO_BASE = "https://json.astrologyapi.com/v1";
// Endpoints DISPONIBLES en tu plan Starter:
const EP_WESTERN_CHART = `${ASTRO_BASE}/natal_wheel_chart`;   // gráfico (SVG/PNG) ✅
const EP_PLANETS       = `${ASTRO_BASE}/planets/tropical`;     // posiciones (Sol/Luna…) ✅
const EP_HOUSES        = `${ASTRO_BASE}/house_cusps/tropical`; // casas → casa 1 = Ascendente (estimado) ✅

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
  res.end(JSON.stringify({ error: msg, detail: detail ?? null }));
}

async function ocGeocode(place) {
  const key = process.env.OPENCAGE_KEY;
  if (!key) throw new Error("Falta OPENCAGE_KEY");

  const url =
    "https://api.opencagedata.com/geocode/v1/json?q=" +
    encodeURIComponent(place) +
    `&key=${key}&limit=1&language=es&no_annotations=0`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`OpenCage ${r.status}`);
  const j = await r.json();
  const g = j.results && j.results[0];
  if (!g) throw new Error("Lugar no encontrado");

  return { lat: g.geometry.lat, lon: g.geometry.lng };
}

async function googleTimeZone(lat, lon) {
  // acepta GOOGLE_API_KEY o GOOGLE_TZ_KEY
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
    // mensaje claro para planes sin acceso
    const msg = j.msg || j.message || j.error || `AstrologyAPI ${r.status}`;
    const detail = j || null;
    const err = new Error(msg);
    err.detail = detail;
    throw err;
  }
  return j;
}

function normalizeChartUrl(resp) {
  // distintos planes → distintos campos
  return resp.chart_url || resp.chartUrl || resp.svg_url || resp.svgUrl || null;
}

// ====== Texto ES para planets/signos + formato grados (NUEVO para positions) ======
const NOMBRE_ES = {
  sun: "Sol",
  moon: "Luna",
  mercury: "Mercurio",
  venus: "Venus",
  mars: "Marte",
  jupiter: "Júpiter",
  saturn: "Saturno",
  uranus: "Urano",
  neptune: "Neptuno",
  pluto: "Plutón",
};

const SIGNO_ES = {
  aries:"Aries", taurus:"Tauro", gemini:"Géminis", cancer:"Cáncer",
  leo:"Leo", virgo:"Virgo", libra:"Libra", scorpio:"Escorpio",
  sagittarius:"Sagitario", capricorn:"Capricornio", aquarius:"Acuario", pisces:"Piscis",
};

function toDegMin(fullDegree) {
  const v = Number(fullDegree);
  if (!isFinite(v)) return "";
  const deg = Math.floor(v);
  const min = Math.round((v - deg) * 60);
  return `${deg}° ${min}'`;
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

    // Parseo body
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {}
    const { date, time, place } = body;
    if (!date || !time || !place) {
      return bad(res, 400, "Faltan parámetros", { need: ["date", "time", "place"] });
    }

    // 1) Geocodificación
    const { lat, lon } = await ocGeocode(place);

    // 2) Zona horaria (horas). Si falla o no hay key, usamos 0 (UTC)
    const tz = await googleTimeZone(lat, lon).catch(() => ({ tzHours: 0, source: "fallback" }));
    const timezone = tz.tzHours;

    // Payload común para AstrologyAPI
    const [Y, M, D] = date.split("-").map(s => parseInt(s, 10));
    const [HH, mm] = time.split(":").map(s => parseInt(s || "0", 10));

    const astroBase = {
      day: D, month: M, year: Y,
      hour: HH, min: mm,
      lat, lon,
      tzone: timezone,
    };

    // 3) Gráfico (SVG/PNG) — natal_wheel_chart (Starter)
    const chartResp = await astroCall(EP_WESTERN_CHART, astroBase);
    const chartUrl = normalizeChartUrl(chartResp);

    // 4) Planetas — planets/tropical (trae Sol, Luna y resto)
    const planetsResp = await astroCall(EP_PLANETS, astroBase);

    const sunObj  = (planetsResp || []).find(p => /sun/i.test(p.name || ""));
    const moonObj = (planetsResp || []).find(p => /moon/i.test(p.name || ""));

    const sun = sunObj
      ? { sign: sunObj.sign || sunObj.sign_name || sunObj.signName || "", text: sunObj.full_degree ? `Grados: ${sunObj.full_degree}` : "" }
      : { sign: "", text: "" };

    const moon = moonObj
      ? { sign: moonObj.sign || moonObj.sign_name || moonObj.signName || "", text: moonObj.full_degree ? `Grados: ${moonObj.full_degree}` : "" }
      : { sign: "", text: "" };

    // 5) Ascendente (estimado) — casa 1 de house_cusps/tropical
    const houses = await astroCall(EP_HOUSES, astroBase).catch(() => null);
    const house1 = houses && (houses.houses || houses).find(h => String(h.house) === "1");
    const asc = {
      sign: (house1 && (house1.sign_name || house1.sign || house1.signName)) || "",
      text: house1 && house1.degree ? `Grados: ${house1.degree}` : "",
      source: houses ? "house_cusps/tropical" : "n/a",
    };

    // 6) NUEVO: construir listado "positions" (tipo Sun/Moon/etc.)
    const positions = (Array.isArray(planetsResp) ? planetsResp : [])
      .filter(p => p && p.name)
      .map(p => {
        const key = String(p.name || "").toLowerCase();       // "sun","moon","mercury",…
        const name = NOMBRE_ES[key] || p.name;                 // "Sol","Luna",…
        const signKey = String(p.sign || p.sign_name || "").toLowerCase();
        const sign = SIGNO_ES[signKey] || (p.sign || p.sign_name || "");
        const retro = !!(p.retro || p.is_retro || p.is_retrograde);
        const degMin = p.full_degree != null ? toDegMin(p.full_degree) : "";
        return { key, name, sign, degMin, retro };
      });

    // sumar Ascendente como item si lo tenemos
    if (asc.sign) {
      const ascSignKey = String(asc.sign).toLowerCase();
      positions.push({
        key: "asc",
        name: "Ascendente",
        sign: SIGNO_ES[ascSignKey] || asc.sign,
        degMin: house1 && house1.degree != null ? toDegMin(house1.degree) : "",
        retro: false
      });
    }

    // 7) Respuesta
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      chartUrl,
      sun,
      moon,
      asc,
      positions, // <--- NUEVO
      meta: { lat, lon, timezone, tzSource: tz.source || "unknown" },
    }, null, 2));
  } catch (err) {
    return bad(res, 500, "Error interno del servidor", err.detail || err.message);
  }
};
