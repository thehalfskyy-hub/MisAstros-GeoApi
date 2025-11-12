// api/chart-custom.js — Vercel Serverless (CommonJS)
// Versión que detecta y recolorea los divisores reales del SVG a blanco.
// ✅ Funciona igual en todas las ruedas (no depende del Ascendente ni del signo Aries).

const ALLOWED_ORIGINS = new Set([
  "https://misastros.com",
  "https://www.misastros.com",
  "https://jauxxx-v4.myshopify.com",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const ASTRO_BASE = "https://json.astrologyapi.com/v1";
const EP_WESTERN_CHART = `${ASTRO_BASE}/natal_wheel_chart`;
const EP_PLANETS       = `${ASTRO_BASE}/planets/tropical`;
const EP_HOUSES        = `${ASTRO_BASE}/house_cusps/tropical`;

// ---------- Helpers ----------
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

function toDegMin(fullDegree) {
  const v = Number(fullDegree);
  if (!isFinite(v)) return "";
  const deg = Math.floor(v);
  const min = Math.round((v - deg) * 60);
  return `${deg}° ${min}'`;
}

const NOMBRE_ES = {
  sun: "Sol", moon: "Luna", mercury: "Mercurio", venus: "Venus", mars: "Marte",
  jupiter: "Júpiter", saturn: "Saturno", uranus: "Urano", neptune: "Neptuno", pluto: "Plutón",
};
const SIGNO_ES = {
  aries:"Aries", taurus:"Tauro", gemini:"Géminis", cancer:"Cáncer",
  leo:"Leo", virgo:"Virgo", libra:"Libra", scorpio:"Escorpio",
  sagittarius:"Sagitario", capricorn:"Capricornio", aquarius:"Acuario", pisces:"Piscis",
};

/* =========================
   Post-proceso del SVG
   ========================= */

// --- Detecta y recolorea los divisores reales del aro de signos ---
function recolorExistingSignDividers(svgText) {
  if (!svgText || typeof svgText !== "string") return svgText;

  const vb = /viewBox="\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*"/i.exec(svgText);
  let x = 0, y = 0, w = 500, h = 500;
  if (vb) {
    x = parseFloat(vb[1]); y = parseFloat(vb[2]);
    w = parseFloat(vb[3]); h = parseFloat(vb[4]);
  }
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = Math.min(w, h) / 2;

  const LINE_RE = /<line\b([^>]*?)\/>/gi;
  const readAttr = (s, name) => {
    const m = new RegExp(`${name}="([^"]+)"`, "i").exec(s);
    return m ? m[1] : null;
  };

  const isDarkGrey = (stroke) => {
    if (!stroke) return false;
    const s = stroke.toLowerCase().replace(/\s/g, "");
    return (
      s === "#000" || s === "#000000" ||
      /^#([1-5][0-9a-f]){3}$/i.test(s) ||
      s === "#111111" || s === "#222222" || s === "#333333" ||
      s === "#444444" || s === "#555555" || s === "#666666" ||
      s === "black" || s.startsWith("rgba(0,0,0") || s.startsWith("rgb(0,0,0")
    );
  };

  const replaceOne = (whole, attrs) => {
    const x1 = parseFloat(readAttr(attrs, "x1") || "NaN");
    const y1 = parseFloat(readAttr(attrs, "y1") || "NaN");
    const x2 = parseFloat(readAttr(attrs, "x2") || "NaN");
    const y2 = parseFloat(readAttr(attrs, "y2") || "NaN");
    if (![x1, y1, x2, y2].every(Number.isFinite)) return whole;

    const rA = Math.hypot(x1 - cx, y1 - cy);
    const rB = Math.hypot(x2 - cx, y2 - cy);
    const length = Math.hypot(x2 - x1, y2 - y1);
    const stroke = readAttr(attrs, "stroke");
    let sw = parseFloat(readAttr(attrs, "stroke-width") || "0.6");
    const style = readAttr(attrs, "style") || "";

    let styleStroke = null, styleWidth = null;
    const mStroke = /stroke:\s*([^;"]+)/i.exec(style);
    if (mStroke) styleStroke = mStroke[1].trim();
    const mWidth = /stroke-width:\s*([0-9.]+)/i.exec(style);
    if (mWidth) styleWidth = parseFloat(mWidth[1]);

    const effStroke = (stroke || styleStroke || "").trim();
    const effWidth  = Number.isFinite(styleWidth) ? styleWidth : sw;

    const nearOuter = (v) => v >= half * 0.90 && v <= half * 1.02;
    const nearRing  = (v) => v >= half * 0.78 && v <= half * 0.98;
    const looksRadial =
      (nearOuter(rA) && nearRing(rB)) || (nearOuter(rB) && nearRing(rA));
    const longEnough = length >= half * 0.12;
    const thinStroke = !Number.isFinite(effWidth) || effWidth <= 1.2;

    if (looksRadial && longEnough && thinStroke && isDarkGrey(effStroke)) {
      let newAttrs = attrs;
      newAttrs = newAttrs.replace(/stroke:\s*[^;"]+;?/gi, "");
      newAttrs = newAttrs.replace(/stroke-width:\s*[^;"]+;?/gi, "");

      if (/stroke="/i.test(newAttrs)) {
        newAttrs = newAttrs.replace(/stroke="[^"]*"/i, 'stroke="#FFFFFF"');
      } else {
        newAttrs += ' stroke="#FFFFFF"';
      }
      if (/stroke-width="/i.test(newAttrs)) {
        newAttrs = newAttrs.replace(/stroke-width="[^"]*"/i, 'stroke-width="2"');
      } else {
        newAttrs += ' stroke-width="2"';
      }
      if (/stroke-linecap="/i.test(newAttrs)) {
        newAttrs = newAttrs.replace(/stroke-linecap="[^"]*"/i, 'stroke-linecap="round"');
      } else {
        newAttrs += ' stroke-linecap="round"';
      }
      newAttrs = newAttrs.replace(/\sstyle="\s*;?\s*"/i, "");

      return `<line ${newAttrs.trim()} />`;
    }

    return whole;
  };

  return svgText.replace(LINE_RE, replaceOne);
}

// --- Engrosar solo las líneas de aspectos (opcional) ---
function thickenAspectLines(svgText, width = 5) {
  if (!svgText || typeof svgText !== "string") return svgText;
  let out = svgText;
  const COLORS = ['#ff0000', '#FF0000', '#0000ff', '#0000FF', '#00ff00', '#00FF00'];
  for (const c of COLORS) {
    out = out.replace(
      new RegExp(`(<(?:line|path|polyline|polygon)\\b[^>]*stroke="${c}"[^>]*?)\\s+stroke-width="[^"]+"([^>]*>)`, "g"),
      `$1 stroke-width="${width}"$2`
    );
    out = out.replace(
      new RegExp(`(<(?:line|path|polyline|polygon)\\b[^>]*stroke="${c}"(?![^>]*stroke-width)[^>]*)(>)`, "g"),
      `$1 stroke-width="${width}"$2`
    );
    out = out.replace(
      new RegExp(`(style="[^"]*stroke:${c}[^"]*?stroke-width:)\\s*[^;"]+`, "g"),
      `$1 ${width}`
    );
  }
  return out;
}

// --- Función principal de ajuste del SVG ---
function tweakSvg(svgText) {
  let out = svgText;
  out = recolorExistingSignDividers(out); // 🔥 recolorea los divisores reales
  // out = thickenAspectLines(out, 5); // ← activá esto si querés engrosar los aspectos
  return out;
}

function svgToDataUrl(svgText) {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svgText);
}

/* =========================
   Handler principal
   ========================= */
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
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {}
    const { date, time, place } = body;
    if (!date || !time || !place) {
      return bad(res, 400, "Faltan parámetros", { need: ["date", "time", "place"] });
    }

    const g = await ocGeocode(place);
    const { lat, lon } = g;

    const tz = await googleTimeZone(lat, lon);
    const timezone = tz.tzHours;
    const [Y, M, D] = date.split("-").map(s => parseInt(s, 10));
    const [HH, mm] = time.split(":").map(s => parseInt(s || "0", 10));
    const astroBase = { day: D, month: M, year: Y, hour: HH, min: mm, lat, lon, tzone: timezone };

    // Gráfico principal (SVG)
    let chartUrl = null;
    let chartError = null;
    try {
      const chartResp = await astroCall(EP_WESTERN_CHART, {
        ...astroBase,
        image_type: "svg",
        chart_size: 500,
        sign_background: "#000000",
        sign_icon_color: "#FFFFFF",
        planet_icon_color: "#000000",
        inner_circle_background: "#FFFFFF"
      });

      const svgUrl = chartResp.chart_url || chartResp.chartUrl || chartResp.svg_url || chartResp.svgUrl;
      const svgResp = await fetch(svgUrl);
      const rawSvg = await svgResp.text();
      const tweaked = tweakSvg(rawSvg);
      chartUrl = svgToDataUrl(tweaked);
    } catch (e) {
      chartError = detailFromError(e) || "Fallo al pedir/modificar el gráfico";
    }

    // Planetas (para tu front)
    const planetsResp = await astroCall(EP_PLANETS, astroBase);
    const sunObj = planetsResp.find(p => /sun/i.test(p.name || ""));
    const moonObj = planetsResp.find(p => /moon/i.test(p.name || ""));

    const sun = sunObj
      ? { sign: sunObj.sign, text: `Grados: ${sunObj.full_degree}` }
      : { sign: "", text: "" };
    const moon = moonObj
      ? { sign: moonObj.sign, text: `Grados: ${moonObj.full_degree}` }
      : { sign: "", text: "" };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      chartUrl,
      sun,
      moon,
      errors: { chart: chartError },
      meta: { lat, lon, timezone }
    }, null, 2));

  } catch (err) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return bad(res, status, err?.message || "Error interno del servidor", detailFromError(err));
  }
};
