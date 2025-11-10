// api/chart.js — Vercel Serverless (CommonJS) — Compatible con PLAN STARTER

// ====== C O N F I G ======
const ASTRO_BASE = "https://json.astrologyapi.com/v1";
// Endpoints DISPONIBLES en tu plan Starter:
const EP_WESTERN_CHART = `${ASTRO_BASE}/natal_wheel_chart`;   // gráfico (SVG/PNG) ✅
const EP_PLANETS       = `${ASTRO_BASE}/planets/tropical`;     // posiciones (Sol/Luna…) ✅
const EP_HOUSES        = `${ASTRO_BASE}/house_cusps/tropical`; // casas → casa 1 = Ascendente (estimado) ✅

const WIDE_OPEN = String(process.env.WIDE_OPEN_CORS || "").toLowerCase() === "true";

// Lista exacta permitida
const ALLOWED_EXACT = new Set([
  "https://misastros.com",
  "https://www.misastros.com",
  "https://jauxxx-v4.myshopify.com",
  "http://localhost:3000",
  "http://localhost:5173",
]);

// Sufijos comunes de Shopify (preview/editor)
const ALLOWED_SUFFIXES = [
  ".myshopify.com",
  ".shopifypreview.com",
];

function originIsAllowed(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    if (ALLOWED_EXACT.has(origin)) return true;
    if (host === "admin.shopify.com") return true;
    if (ALLOWED_SUFFIXES.some(suf => host.endsWith(suf))) return true;
    if (host === "misastros.com" || host === "www.misastros.com") return true;
    return false;
  } catch {
    return false;
  }
}

function applyCors(res, origin) {
  if (WIDE_OPEN) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (originIsAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "600"); // cachea el preflight 10min
}

// ====== H E L P E R S ======
function bad(res, status, msg, detail) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: msg, detail: detail ?? null }));
}

function detailFromError(err) {
  if (!err) return null;
  if (err.detail) return err.detail;
  if (err.message) return err.message;
  return String(err);
}

async function ocGeocode(place) {
  const key = process.env.OPENCAGE_KEY;
  if (!key) throw Object.assign(new Error("Falta OPENCAGE_KEY"), { status: 500 });
  const url =
    "https://api.opencagedata.com/geocode/v1/json?q=" +
    encodeURIComponent(place) +
    `&key=${key}&limit=1&language=es&no_annotations=0`;
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error(`OpenCage ${r.status}`), { status: r.status });
  const j = await r.json();
  const g = j.results && j.results[0];
  if (!g) throw Object.assign(new Error("Lugar no encontrado"), { status: 400 });
  return { lat: g.geometry.lat, lon: g.geometry.lng };
}

async function googleTimeZone(lat, lon) {
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_TZ_KEY;
  if (!key) return { tzHours: 0, source: "fallback" };
  const ts = Math.floor(Date.now() / 1000);
  const url = `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lon}&timestamp=${ts}&key=${key}`;
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error(`Google TZ ${r.status}`), { status: r.status });
  const j = await r.json();
  if (j.status !== "OK") throw Object.assign(new Error(`Google TZ ${j.status}`), { status: 502 });
  const total = (j.rawOffset || 0) + (j.dstOffset || 0);
  return { tzHours: total / 3600, source: "google" };
}

async function astroCall(endpoint, payload) {
  const id = process.env.ASTRO_USER_ID;
  const key = process.env.ASTRO_API_KEY;
  if (!id || !key) {
    const e = new Error("Faltan ASTRO_USER_ID / ASTRO_API_KEY");
    e.status = 500;
    throw e;
  }
  const auth = Buffer.from(`${id}:${key}`).toString("base64");
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); }
  catch {
    const e = new Error(`AstrologyAPI parse error: ${text.slice(0, 200)}`);
    e.status = r.status || 502;
    throw e;
  }
  if (!r.ok) {
    const msg = j.msg || j.message || j.error || `AstrologyAPI ${r.status}`;
    const err = new Error(msg);
    err.detail = j || null;
    err.status = r.status || 502;
    throw err;
  }
  return j;
}

function normalizeChartUrl(resp) {
  return resp.chart_url || resp.chartUrl || resp.svg_url || resp.svgUrl || null;
}

// ====== ES strings y grados ======
const NOMBRE_ES = {
  sun:"Sol", moon:"Luna", mercury:"Mercurio", venus:"Venus", mars:"Marte",
  jupiter:"Júpiter", saturn:"Saturno", uranus:"Urano", neptune:"Neptuno", pluto:"Plutón",
};
const SIGNO_ES = {
  aries:"Aries", taurus:"Tauro", gemini:"Géminis", cancer:"Cáncer", leo:"Leo",
  virgo:"Virgo", libra:"Libra", scorpio:"Escorpio", sagittarius:"Sagitario",
  capricorn:"Capricornio", aquarius:"Acuario", pisces:"Piscis",
};
function toDegMin(fullDegree){ const v=Number(fullDegree); if(!isFinite(v))return""; const d=Math.floor(v); const m=Math.round((v-d)*60); return `${d}° ${m}'`; }

// ====== H A N D L E R ======
module.exports = async (req, res) => {
  try {
    const origin = req.headers.origin || "";
    applyCors(res, origin);

    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    if (req.method !== "POST") return bad(res, 405, "Method Not Allowed. Use POST.");

    // Body
    let body = {};
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch {}
    const { date, time, place } = body;
    if (!date || !time || !place) return bad(res, 400, "Faltan parámetros", { need:["date","time","place"] });

    // 1) Geo
    let lat, lon;
    try { ({lat,lon} = await ocGeocode(place)); }
    catch (e) { return bad(res, e.status || 400, "Lugar no encontrado o error de geocodificación.", detailFromError(e)); }

    // 2) TZ
    let timezone = 0, tzSource = "fallback";
    try { const tz = await googleTimeZone(lat,lon); timezone = tz.tzHours; tzSource = tz.source || "google"; } catch {}

    // Payload
    const [Y,M,D] = date.split("-").map(s=>parseInt(s,10));
    const [HH,mm] = time.split(":").map(s=>parseInt(s||"0",10));
    const astroBase = { day:D, month:M, year:Y, hour:HH, min:mm, lat, lon, tzone:timezone };

    const errors = {};

    // 3) Chart
    let chartUrl = null;
    try { chartUrl = normalizeChartUrl(await astroCall(EP_WESTERN_CHART, astroBase)); }
    catch (e) { errors.chart = "Error al pedir el gráfico a AstrologyAPI."; errors.detail = detailFromError(e); }

    // 4) Planets
    let planetsResp = null;
    try { planetsResp = await astroCall(EP_PLANETS, astroBase); }
    catch (e) { errors.planets = "Error al pedir posiciones a AstrologyAPI."; errors.planetsDetail = detailFromError(e); }

    const sunObj  = (planetsResp || []).find(p => /sun/i.test(p.name || ""));
    const moonObj = (planetsResp || []).find(p => /moon/i.test(p.name || ""));

    const sun  = sunObj  ? { sign:sunObj.sign || sunObj.sign_name || sunObj.signName || "", text:sunObj.full_degree ? `Grados: ${sunObj.full_degree}` : "" } : { sign:"", text:"" };
    const moon = moonObj ? { sign:moonObj.sign || moonObj.sign_name || moonObj.signName || "", text:moonObj.full_degree ? `Grados: ${moonObj.full_degree}` : "" } : { sign:"", text:"" };

    // 5) ASC estimado (casas)
    let houses = null, house1 = null;
    try { houses = await astroCall(EP_HOUSES, astroBase); house1 = houses && (houses.houses || houses).find(h => String(h.house) === "1"); } catch {}
    const asc = {
      sign: (house1 && (house1.sign_name || house1.sign || house1.signName)) || "",
      text: house1 && house1.degree != null ? `Grados: ${house1.degree}` : "",
      source: houses ? "house_cusps/tropical" : "n/a",
    };

    // 6) positions
    const positions = (Array.isArray(planetsResp) ? planetsResp : [])
      .filter(p => p && p.name)
      .map(p => {
        const key = String(p.name || "").toLowerCase();
        const name = NOMBRE_ES[key] || p.name;
        const signKey = String(p.sign || p.sign_name || "").toLowerCase();
        const sign = SIGNO_ES[signKey] || (p.sign || p.sign_name || "");
        const retro = !!(p.retro || p.is_retro || p.is_retrograde);
        const degMin = p.full_degree != null ? toDegMin(p.full_degree) : "";
        return { key, name, sign, degMin, retro };
      });

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

    // 7) OK
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      chartUrl,
      sun,
      moon,
      asc,
      positions,
      meta: { lat, lon, timezone, tzSource },
      errors,
    }, null, 2));
  } catch (err) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return bad(res, status, err?.message || "Error interno del servidor", detailFromError(err));
  }
};
