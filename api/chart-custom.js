// api/chart-custom.js — Vercel Serverless (CommonJS) — Compatible con PLAN STARTER
// Igual contrato que /api/chart, pero devuelve chartUrl = data:image/svg+xml;utf8,<svg modificado>

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

/** Detecta el offset (en grados) del anillo de signos.
 *  1) Intenta leer transform="rotate(A,...)" en el <g id="astrology-radix-signs">.
 *  2) Si no existe, estima ángulo con el primer <g transform="translate(x y)"> del anillo de signos.
 *  Devuelve grados donde 0° es hacia la derecha (eje +X) y -90° apunta hacia arriba (coincide con cómo trazamos).
 */
function detectSignRotationDegrees(svgText) {
  // 1) Intento directo: rotate en el grupo de signos
  const grp = svgText.match(/<g[^>]*id="astrology-radix-signs"[^>]*>/i);
  if (grp) {
    const mRot = grp[0].match(/transform="[^"]*rotate\(\s*([-\d.]+)/i);
    if (mRot) {
      const deg = parseFloat(mRot[1]);
      if (isFinite(deg)) return deg;
    }
  }

  // 2) Estimación: primer translate de un hijo de astrology-radix-signs
  //    Buscamos el bloque del grupo para rastrear hijos
  const blockMatch = svgText.match(/<g[^>]*id="astrology-radix-signs"[^>]*>([\s\S]*?)<\/g>/i);
  if (blockMatch) {
    const block = blockMatch[1];
    // Primer transform="translate(x y)" que aparezca
    const mT = block.match(/transform="\s*translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i);
    // Si no hay translate, probamos con matrices (menos común)
    if (mT) {
      const x = parseFloat(mT[1]), y = parseFloat(mT[2]);
      if (isFinite(x) && isFinite(y)) {
        // Tomamos centro del viewBox
        const vb = /viewBox="\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*"/i.exec(svgText);
        let vx = 0, vy = 0, vw = 500, vh = 500;
        if (vb) {
          vx = parseFloat(vb[1]); vy = parseFloat(vb[2]);
          vw = parseFloat(vb[3]); vh = parseFloat(vb[4]);
        } else {
          const mW = /width="([\d.]+)"/i.exec(svgText);
          const mH = /height="([\d.]+)"/i.exec(svgText);
          if (mW) vw = parseFloat(mW[1]);
          if (mH) vh = parseFloat(mH[1]);
        }
        const cx = vx + vw/2;
        const cy = vy + vh/2;
        // Ángulo desde el centro al primer signo (en radianes y luego grados)
        const angRad = Math.atan2(y - cy, x - cx);
        const angDeg = angRad * 180 / Math.PI;
        // Ese ángulo normalmente apunta al centro del signo (glyph).
        // Para pasar de centro a borde necesitamos ±15°. Eso lo hacemos en injectWhiteDividers.
        return angDeg;
      }
    }
  }

  // 3) Fallback seguro
  return 0; // sin rotación extra
}

// ——— Inyecta 12 divisores blancos en el aro externo (alineados a los límites de signo)
function injectWhiteDividers(svgText) {
  // viewBox para medidas
  const vb = /viewBox="\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*"/i.exec(svgText);
  let x = 0, y = 0, w = 500, h = 500;
  if (vb) {
    x = parseFloat(vb[1]); y = parseFloat(vb[2]);
    w = parseFloat(vb[3]); h = parseFloat(vb[4]);
  } else {
    const mW = /width="([\d.]+)"/i.exec(svgText);
    const mH = /height="([\d.]+)"/i.exec(svgText);
    if (mW) w = parseFloat(mW[1]);
    if (mH) h = parseFloat(mH[1]);
  }

  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = Math.min(w, h) / 2;

  // radios dentro del aro exterior negro
  const r1 = half * 0.82;
  const r2 = half * 0.96;

  // Detectar rotación real del anillo de signos:
  // angCentroSigno = ángulo donde cae el centro de Aries (o del primer signo detectado)
  const angCentroSigno = detectSignRotationDegrees(svgText);

 // 👉 Ajuste fino manual (si necesitás correr los divisores 1 o 2 grados)
const microOffset = -4; // probá con 1 o -1 si ves que están levemente corridos

// Para dibujar divisores en los BORDES de cada signo:
// si el centro de Aries es angCentroSigno, sus bordes están a ±15°.
const primerBorde = angCentroSigno - 15 + microOffset;

  const lines = [];
  for (let i = 0; i < 12; i++) {
    const ang = (primerBorde + i * 30) * Math.PI / 180; // en rad
    const x1 = cx + r1 * Math.cos(ang);
    const y1 = cy + r1 * Math.sin(ang);
    const x2 = cx + r2 * Math.cos(ang);
    const y2 = cy + r2 * Math.sin(ang);
    lines.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`
    );
  }

  const group =
    `<g id="mis-divisores-blancos" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round">${lines.join("")}</g>`;

  return svgText.replace(/<\/svg>\s*$/i, `${group}\n</svg>`);
}

function tweakSvg(svgText) {
  if (!svgText || typeof svgText !== "string") return svgText;

  let out = svgText;

  // ✅ Engrosar SOLO las líneas de aspectos (rojo/azul/verde) — line/path/polyline/polygon y style=
  const COLORS = ['#ff0000', '#FF0000', '#0000ff', '#0000FF', '#00ff00', '#00FF00'];
  for (const c of COLORS) {
    // con atributo stroke-width
    out = out.replace(
      new RegExp(`(<(?:line|path|polyline|polygon)\\b[^>]*stroke="${c}"[^>]*?)\\s+stroke-width="[^"]+"([^>]*>)`, "g"),
      `$1 stroke-width="5"$2`
    );
    // sin atributo stroke-width
    out = out.replace(
      new RegExp(`(<(?:line|path|polyline|polygon)\\b[^>]*stroke="${c}"(?![^>]*stroke-width)[^>]*)(>)`, "g"),
      `$1 stroke-width="5"$2`
    );
    // casos style="stroke:#ff0000; stroke-width:1"
    out = out.replace(
      new RegExp(`(style="[^"]*stroke:${c}[^"]*?stroke-width:)\\s*[^;"]+`, "g"),
      `$1 5`
    );
  }

  // 👉 Agregar divisores blancos alineados a signos (dinámico)
  out = injectWhiteDividers(out);

  return out;
}

function svgToDataUrl(svgText) {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svgText);
}

/* =========================
   Handler
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

    // Body
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch {}
    const { date, time, place } = body;
    if (!date || !time || !place) {
      return bad(res, 400, "Faltan parámetros", { need: ["date", "time", "place"] });
    }

    // Geocodificación
    let lat, lon;
    try {
      const g = await ocGeocode(place);
      lat = g.lat; lon = g.lon;
    } catch (e) {
      return bad(res, e.status || 400, "Lugar no encontrado o error de geocodificación.", detailFromError(e));
    }

    // Zona horaria
    let timezone = 0, tzSource = "fallback";
    try {
      const tz = await googleTimeZone(lat, lon);
      timezone = tz.tzHours;
      tzSource = tz.source || "google";
    } catch (_) {}

    // Base astro
    const [Y, M, D] = date.split("-").map(s => parseInt(s, 10));
    const [HH, mm] = time.split(":").map(s => parseInt(s || "0", 10));
    const astroBase = { day: D, month: M, year: Y, hour: HH, min: mm, lat, lon, tzone: timezone };

    // 3) Gráfico — pedimos SVG (aro exterior negro e íconos blancos), luego post-proceso
    let chartUrl = null;
    let chartError = null;
    try {
      const chartResp = await astroCall(EP_WESTERN_CHART, {
        ...astroBase,
        image_type: "svg",
        chart_size: 500,
        sign_background: "#000000",   // aro exterior negro
        sign_icon_color: "#FFFFFF",   // íconos de signos blancos
        planet_icon_color: "#000000", // (color de iconos de planetas en el SVG de proveedor)
        inner_circle_background: "#FFFFFF"
      });

      const svgUrl = chartResp.chart_url || chartResp.chartUrl || chartResp.svg_url || chartResp.svgUrl || null;
      if (!svgUrl) throw new Error("No se recibió URL de SVG del proveedor");

      const svgResp = await fetch(svgUrl);
      if (!svgResp.ok) throw new Error(`Fetch SVG ${svgResp.status}`);
      const rawSvg = await svgResp.text();

      const tweaked = tweakSvg(rawSvg);
      chartUrl = svgToDataUrl(tweaked);
    } catch (e) {
      chartError = detailFromError(e) || "Fallo al pedir/modificar el gráfico";
    }

    // 4) Planetas
    let planetsResp;
    try {
      planetsResp = await astroCall(EP_PLANETS, astroBase);
    } catch (e) {
      return bad(res, e.status || 502, "Error al pedir posiciones a AstrologyAPI.", detailFromError(e));
    }

    const sunObj  = (planetsResp || []).find(p => /sun/i.test(p.name || ""));
    const moonObj = (planetsResp || []).find(p => /moon/i.test(p.name || ""));

    const sun = sunObj
      ? { sign: sunObj.sign || sunObj.sign_name || sunObj.signName || "", text: sunObj.full_degree ? `Grados: ${sunObj.full_degree}` : "" }
      : { sign: "", text: "" };

    const moon = moonObj
      ? { sign: moonObj.sign || moonObj.sign_name || moonObj.signName || "", text: moonObj.full_degree ? `Grados: ${moonObj.full_degree}` : "" }
      : { sign: "", text: "" };

    // 5) Ascendente estimado
    let houses = null, house1 = null;
    try {
      houses = await astroCall(EP_HOUSES, astroBase);
      house1 = houses && (houses.houses || houses).find(h => String(h.house) === "1");
    } catch (_) {}

    const asc = {
      sign: (house1 && (house1.sign_name || house1.sign || house1.signName)) || "",
      text: house1 && house1.degree != null ? `Grados: ${house1.degree}` : "",
      source: houses ? "house_cusps/tropical" : "n/a",
    };

    // 6) Positions + Asc (compat con tu front)
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

    // 7) Respuesta JSON
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      chartUrl,
      sun,
      moon,
      asc,
      positions,
      errors: { chart: chartError },
      meta: { lat, lon, timezone, tzSource }
    }, null, 2));

  } catch (err) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    return bad(res, status, err?.message || "Error interno del servidor", detailFromError(err));
  }
};
