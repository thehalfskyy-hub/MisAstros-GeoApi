// api/chart.js — Vercel Serverless (CommonJS) — PLAN STARTER

// ====== C O N F I G ======
const ALLOWED_ORIGINS = new Set([
  "https://misastros.com",
  "https://www.misastros.com",
  "https://jauxxx-v4.myshopify.com",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const ASTRO_BASE = "https://json.astrologyapi.com/v1";
// Endpoints Starter:
const EP_WESTERN_CHART = `${ASTRO_BASE}/natal_wheel_chart`;
const EP_PLANETS       = `${ASTRO_BASE}/planets/tropical`;
const EP_HOUSES        = `${ASTRO_BASE}/house_cusps/tropical`;

// ====== H E L P E R S ======
function setCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-Requested-With");
}

function bad(res, status, msg, detail) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: msg, detail: detail ?? null }));
}
const detailFromError = (e) => (e?.detail ?? e?.message ?? String(e));

async function ocGeocode(place) {
  const key = process.env.OPENCAGE_KEY;
  if (!key) throw Object.assign(new Error("Falta OPENCAGE_KEY"), { status: 500 });
  const r = await fetch(
    "https://api.opencagedata.com/geocode/v1/json?q=" +
      encodeURIComponent(place) +
      `&key=${key}&limit=1&language=es&no_annotations=0`
  );
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
  const r = await fetch(`https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lon}&timestamp=${ts}&key=${key}`);
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
    const e = new Error(`AstrologyAPI parse error: ${text.slice(0,200)}`);
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
const normalizeChartUrl = (resp) => resp.chart_url || resp.chartUrl || resp.svg_url || resp.svgUrl || null;

const SIGN_INDEX = { aries:0, taurus:1, gemini:2, cancer:3, leo:4, virgo:5, libra:6, scorpio:7, sagittarius:8, capricorn:9, aquarius:10, pisces:11 };
const SIGNO_ES = {
  aries:"Aries", taurus:"Tauro", gemini:"Géminis", cancer:"Cáncer",
  leo:"Leo", virgo:"Virgo", libra:"Libra", scorpio:"Escorpio",
  sagittarius:"Sagitario", capricorn:"Capricornio", aquarius:"Acuario", pisces:"Piscis"
};
const NOMBRE_ES = { sun:"Sol", moon:"Luna", mercury:"Mercurio", venus:"Venus", mars:"Marte", jupiter:"Júpiter", saturn:"Saturno", uranus:"Urano", neptune:"Neptuno", pluto:"Plutón" };

function signToIndex(s){
  const k = String(s||"").toLowerCase();
  return SIGN_INDEX[k] ?? 0;
}

// ====== H A N D L E R ======
module.exports = async (req, res) => {
  try {
    const origin = req.headers.origin || "";
    setCors(res, origin);

    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    if (req.method !== "POST")   { return bad(res, 405, "Method Not Allowed. Use POST."); }

    let body = {};
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch {}
    const { date, time, place } = body;
    if (!date || !time || !place) {
      return bad(res, 400, "Faltan parámetros", { need: ["date","time","place"] });
    }

    // 1) Geocodificación
    let lat, lon;
    try { ({lat,lon} = await ocGeocode(place)); }
    catch (e) { return bad(res, e.status || 400, "Lugar no encontrado o error de geocodificación.", detailFromError(e)); }

    // 2) Zona horaria
    let timezone = 0, tzSource = "fallback";
    try { const tz = await googleTimeZone(lat,lon); timezone = tz.tzHours; tzSource = tz.source || "google"; }
    catch { /* fallback */ }

    // 3) Payload común
    const [Y,M,D] = date.split("-").map(n=>parseInt(n,10));
    const [HH,mm] = time.split(":").map(n=>parseInt(n||"0",10));
    const astroBase = { day:D, month:M, year:Y, hour:HH, min:mm, lat, lon, tzone: timezone };

    // 4) (Opcional) URL del gráfico de AstrologyAPI (por si lo querés seguir mostrando aparte)
    let chartUrl = null, chartError = null;
    try {
      const chartResp = await astroCall(EP_WESTERN_CHART, astroBase);
      chartUrl = normalizeChartUrl(chartResp);
    } catch (e) {
      chartError = { msg: "Error al pedir el gráfico a AstrologyAPI.", detail: detailFromError(e) };
    }

    // 5) Planetas
    let planetsResp;
    try { planetsResp = await astroCall(EP_PLANETS, astroBase); }
    catch (e) { return bad(res, e.status || 502, "Error al pedir posiciones a AstrologyAPI.", detailFromError(e)); }

    // 6) Casas
    let housesResp = null;
    try { housesResp = await astroCall(EP_HOUSES, astroBase); } catch { /* opcional */ }

    // 7) Normalizaciones
    const positions = (Array.isArray(planetsResp)? planetsResp:[]).map(p=>{
      const key = String(p.name||"").toLowerCase();         // sun/moon/…
      const name = NOMBRE_ES[key] || p.name;
      const sign_en = p.sign || p.sign_name || p.signName || "";
      const sign = SIGNO_ES[String(sign_en).toLowerCase()] || sign_en;
      const abs = Number(p.full_degree ?? p.fullDegree ?? NaN); // 0..360
      const retro = !!(p.retro || p.is_retro || p.is_retrograde);
      return { key, name, sign, abs, retro };
    });

    let housesAbs = null, asc = { sign:"", text:"", source:"n/a" };
    if (housesResp) {
      const arr = housesResp.houses || housesResp || [];
      const cusps = [];
      arr.forEach(h=>{
        const idx = Number(h.house);
        const sIdx = signToIndex(h.sign_name || h.sign || h.signName);
        const deg  = Number(h.degree || 0);
        cusps[idx-1] = sIdx*30 + deg; // 0..360
        if (idx === 1) {
          asc.sign   = SIGNO_ES[String(h.sign_name||h.sign||h.signName).toLowerCase()] || (h.sign_name||h.sign||h.signName) || "";
          asc.text   = `Grados: ${deg}`;
          asc.source = "house_cusps/tropical";
        }
      });
      if (cusps.length === 12) housesAbs = cusps;
    }

    // 8) Respuesta
    res.statusCode = 200;
    res.setHeader("Content-Type","application/json; charset=utf-8");
    res.end(JSON.stringify({
      chartUrl,
      errors: chartError ? { chart: true, detail: chartError.detail } : null,
      sun:  positions.find(p=>p.key==="sun")  ? { sign: positions.find(p=>p.key==="sun").sign  } : { sign:"" },
      moon: positions.find(p=>p.key==="moon") ? { sign: positions.find(p=>p.key==="moon").sign } : { sign:"" },
      asc,
      positions,          // ← incluye key, name, sign, abs(0..360), retro
      housesAbs,          // ← [12] en grados 0..360 (si disponible)
      meta: { lat, lon, timezone, tzSource }
    }, null, 2));
  } catch (err) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return bad(res, status, err?.message || "Error interno del servidor", detailFromError(err));
  }
};
