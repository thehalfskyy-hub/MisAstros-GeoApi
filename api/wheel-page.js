// api/wheel-page.js
// Endpoint independiente para generar la página SVG de la rueda astral
// SIN tocar data-excel.js

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
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj, null, 2));
}

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Body JSON inválido."));
      }
    });
    req.on("error", reject);
  });
}

function extractFromTrelloText(text) {
  const safeText = String(text || "");

  function getValue(label) {
    const regex = new RegExp(`${label}:\\s*(.+)`, "i");
    const match = safeText.match(regex);
    return match ? match[1].trim() : "";
  }

  return {
    nombre: getValue("Nombre"),
    fecha_nacimiento: getValue("Fecha de nacimiento"),
    hora_nacimiento: getValue("Hora de nacimiento"),
    lugar_nacimiento: getValue("Lugar de nacimiento")
  };
}

function normalizeHour(hourRaw = "") {
  const h = String(hourRaw).trim().replace(".", ":");
  const m = h.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const hour = Number(m[1]);
  const min = Number(m[2]);

  if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;

  return {
    hour,
    min,
    normalized: `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`
  };
}

function parseDate(dateRaw = "") {
  const m = String(dateRaw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { year, month, day };
}

async function ocGeocode(place) {
  const key = process.env.OPENCAGE_KEY;
  if (!key) {
    const e = new Error("Falta OPENCAGE_KEY en Vercel.");
    e.status = 500;
    throw e;
  }

  const url =
    "https://api.opencagedata.com/geocode/v1/json?q=" +
    encodeURIComponent(place) +
    `&key=${key}&limit=1&language=es&no_annotations=0`;

  const response = await fetch(url);
  if (!response.ok) {
    const e = new Error(`OpenCage error ${response.status}`);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();
  const result = data.results && data.results[0];

  if (!result) {
    const e = new Error("Lugar no encontrado.");
    e.status = 400;
    throw e;
  }

  return {
    lat: result.geometry.lat,
    lon: result.geometry.lng,
    formatted: result.formatted || place
  };
}

async function googleTimeZoneForBirth(lat, lon, year, month, day, hour, min) {
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_TZ_KEY;

  if (!key) {
    const e = new Error("Falta GOOGLE_API_KEY o GOOGLE_TZ_KEY en Vercel.");
    e.status = 500;
    throw e;
  }

  const timestamp = Math.floor(Date.UTC(year, month - 1, day, hour || 12, min || 0) / 1000);

  const url =
    `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lon}` +
    `&timestamp=${timestamp}&key=${key}`;

  const response = await fetch(url);
  if (!response.ok) {
    const e = new Error(`Google Time Zone error ${response.status}`);
    e.status = response.status;
    throw e;
  }

  const data = await response.json();

  if (data.status !== "OK") {
    const e = new Error(`Google Time Zone status: ${data.status}`);
    e.status = 502;
    e.detail = data;
    throw e;
  }

  const totalOffsetSeconds = (data.rawOffset || 0) + (data.dstOffset || 0);

  return {
    tzone: totalOffsetSeconds / 3600
  };
}

function astrologyAuthHeader() {
  const userId = process.env.ASTRO_USER_ID;
  const apiKey = process.env.ASTRO_API_KEY;

  if (!userId || !apiKey) {
    throw new Error("Faltan ASTRO_USER_ID / ASTRO_API_KEY en Vercel.");
  }

  const token = Buffer.from(`${userId}:${apiKey}`).toString("base64");
  return `Basic ${token}`;
}

async function callAstrologyApi(endpoint, payload, extraPayload = {}) {
  const url = `https://json.astrologyapi.com/v1/${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": astrologyAuthHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...payload,
      ...extraPayload
    })
  });

  if (!response.ok) {
    const text = await response.text();
    const e = new Error(`AstrologyAPI ${endpoint} ${response.status}`);
    e.status = response.status;
    e.detail = text;
    throw e;
  }

  return response.json();
}

function signToEnglish(signRaw = "") {
  const sign = String(signRaw).trim().toLowerCase();

  const map = {
    aries: "Aries",
    tauro: "Taurus",
    taurus: "Taurus",
    geminis: "Gemini",
    géminis: "Gemini",
    gemini: "Gemini",
    cancer: "Cancer",
    cáncer: "Cancer",
    leo: "Leo",
    virgo: "Virgo",
    libra: "Libra",
    escorpio: "Scorpio",
    scorpio: "Scorpio",
    sagitario: "Sagittarius",
    sagittarius: "Sagittarius",
    capricornio: "Capricorn",
    capricorn: "Capricorn",
    acuario: "Aquarius",
    aquarius: "Aquarius",
    piscis: "Pisces",
    pisces: "Pisces"
  };

  return map[sign] || String(signRaw || "");
}

function formatDegreeFromDecimal(decimalValue) {
  const value = Number(decimalValue);
  if (!Number.isFinite(value)) return "";

  const degrees = Math.floor(value);
  const minutesFloat = (value - degrees) * 60;
  const minutes = Math.round(minutesFloat);

  const safeDegrees = degrees;
  const safeMinutes = minutes === 60 ? 59 : minutes;

  return `${safeDegrees}° ${String(safeMinutes).padStart(2, "0")}'`;
}

function isRetrograde(planet) {
  if (String(planet?.isRetro).toLowerCase() === "true") return true;
  if (Number(planet?.speed) < 0) return true;
  return false;
}

function normalizePlanetName(nameRaw = "") {
  const n = String(nameRaw).trim().toLowerCase();

  const map = {
    sun: "Sun",
    sol: "Sun",
    moon: "Moon",
    luna: "Moon",
    mercury: "Mercury",
    mercurio: "Mercury",
    venus: "Venus",
    mars: "Mars",
    marte: "Mars",
    jupiter: "Jupiter",
    júpiter: "Jupiter",
    saturn: "Saturn",
    saturno: "Saturn",
    uranus: "Uranus",
    urano: "Uranus",
    neptune: "Neptune",
    neptuno: "Neptune",
    pluto: "Pluto",
    plutón: "Pluto",
    pluton: "Pluto",
    ascendant: "Ascendant",
    ascendente: "Ascendant"
  };

  return map[n] || nameRaw;
}

function buildPlanetMap(planets = []) {
  const out = {};

  for (const p of planets) {
    const key = normalizePlanetName(p.name);
    if (!key) continue;

    out[key] = {
      sign: signToEnglish(p.sign || ""),
      degree: formatDegreeFromDecimal(p.normDegree),
      motion: isRetrograde(p) ? "Retrograde" : "Direct"
    };
  }

  return out;
}

function extractWheelUrl(wheelData) {
  if (!wheelData) return "";

  if (typeof wheelData === "string") return wheelData;

  return (
    wheelData.svg ||
    wheelData.chart_url ||
    wheelData.image ||
    wheelData.url ||
    wheelData.output ||
    wheelData.svg_url ||
    ""
  );
}

async function wheelSourceToDataUri(source) {
  if (!source) return "";

  if (typeof source === "string" && source.trim().startsWith("<svg")) {
    return `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`No se pudo descargar la rueda: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/svg+xml";
  const buffer = Buffer.from(await response.arrayBuffer());

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

const FONT_MAIN = 'Georgia, "Times New Roman", serif';

function degreeWithMotion(degree, motion) {
  if (!degree) return "";
  return motion === "Retrograde" ? `${degree} R` : degree;
}

function lineItem({ xLabel, xDeg, y, symbol, label, sign, degree, motion }) {
  const textLeft = `${symbol} ${label} in ${sign}`;
  const textRight = degreeWithMotion(degree, motion);

  return `
    <line x1="${xLabel}" y1="${y + 16}" x2="${xDeg + 28}" y2="${y + 16}"
      stroke="#e4d9d3" stroke-width="1"/>

    <text x="${xLabel}" y="${y}"
      font-family="${FONT_MAIN}"
      font-size="21" font-weight="400"
      fill="#5d5652">${esc(textLeft)}</text>

    <text x="${xDeg}" y="${y}"
      font-family="${FONT_MAIN}"
      font-size="18" font-weight="400"
      fill="#9b918b">${esc(textRight)}</text>
  `;
}

function buildSvg({ wheelDataUri, planets }) {
  const width = 794;
  const height = 1123;

  const p = (name) => planets[name] || { sign: "", degree: "", motion: "" };

  const wheelBlock = wheelDataUri
    ? `
      <image href="${wheelDataUri}"
        x="82" y="45" width="630" height="630"
        preserveAspectRatio="xMidYMid meet"/>
    `
    : `
      <text x="397" y="330" text-anchor="middle"
        font-family="${FONT_MAIN}" font-size="24"
        fill="#9b1c1c">No se pudo cargar la rueda astral</text>
    `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f7eee9"/>

  <!-- ondas decorativas derecha -->
  <g opacity="0.38" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 34 }).map((_, i) => {
      const x = 720 + i * 3;
      return `<path d="M ${x} -40 C ${x - 50} 130, ${x + 40} 260, ${x - 10} 430 C ${x - 60} 630, ${x + 30} 840, ${x - 5} 1120"/>`;
    }).join("\n")}
  </g>

  <!-- ondas decorativas abajo izquierda -->
  <g opacity="0.22" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 30 }).map((_, i) => {
      const y = 1010 + i * 5;
      return `<path d="M -20 ${y} C 120 ${y - 70}, 250 ${y + 70}, 420 ${y - 10}"/>`;
    }).join("\n")}
  </g>

  ${wheelBlock}

  <!-- columna izquierda -->
  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 720,
    symbol: "☉",
    label: "Sun",
    sign: p("Sun").sign,
    degree: p("Sun").degree,
    motion: p("Sun").motion
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 775,
    symbol: "☽",
    label: "Moon",
    sign: p("Moon").sign,
    degree: p("Moon").degree,
    motion: p("Moon").motion
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 830,
    symbol: "☿",
    label: "Mercury",
    sign: p("Mercury").sign,
    degree: p("Mercury").degree,
    motion: p("Mercury").motion
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 885,
    symbol: "♀",
    label: "Venus",
    sign: p("Venus").sign,
    degree: p("Venus").degree,
    motion: p("Venus").motion
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 940,
    symbol: "♂",
    label: "Mars",
    sign: p("Mars").sign,
    degree: p("Mars").degree,
    motion: p("Mars").motion
  })}

  <!-- columna derecha -->
  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 720,
    symbol: "♃",
    label: "Jupiter",
    sign: p("Jupiter").sign,
    degree: p("Jupiter").degree,
    motion: p("Jupiter").motion
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 775,
    symbol: "♄",
    label: "Saturn",
    sign: p("Saturn").sign,
    degree: p("Saturn").degree,
    motion: p("Saturn").motion
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 830,
    symbol: "♅",
    label: "Uranus",
    sign: p("Uranus").sign,
    degree: p("Uranus").degree,
    motion: p("Uranus").motion
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 885,
    symbol: "♆",
    label: "Neptune",
    sign: p("Neptune").sign,
    degree: p("Neptune").degree,
    motion: p("Neptune").motion
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 940,
    symbol: "♇",
    label: "Pluto",
    sign: p("Pluto").sign,
    degree: p("Pluto").degree,
    motion: p("Pluto").motion
  })}

  <!-- ascendente -->
  <line x1="260" y1="1006" x2="535" y2="1006"
    stroke="#e4d9d3" stroke-width="1"/>

  <text x="240" y="990"
    font-family="${FONT_MAIN}"
    font-size="17" font-weight="400"
    fill="#5d5652">Asc</text>

  <text x="280" y="990"
    font-family="${FONT_MAIN}"
    font-size="23" font-weight="600"
    fill="#5d5652">${esc(`Ascendant in ${p("Ascendant").sign || ""}`)}</text>

  <text x="540" y="990"
    font-family="${FONT_MAIN}"
    font-size="18" font-weight="400"
    fill="#9b918b">${esc(p("Ascendant").degree || "")}</text>
</svg>`;
}

module.exports = async (req, res) => {
  try {
    const origin = req.headers.origin || "";
    setCors(res, origin);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    let body = {};
    if (req.method === "POST") {
      body = await parseBody(req);
    } else if (req.method !== "GET") {
      return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    }

    const source = req.method === "GET" ? (req.query || {}) : body;

    const trelloData = source.trello_text
      ? extractFromTrelloText(source.trello_text)
      : {};

    const nombre = source.nombre || trelloData.nombre || "";
    const fecha_nacimiento = source.fecha_nacimiento || trelloData.fecha_nacimiento || "";
    const hora_nacimiento = source.hora_nacimiento || trelloData.hora_nacimiento || "";
    const lugar_nacimiento = source.lugar_nacimiento || trelloData.lugar_nacimiento || "";

    if (!fecha_nacimiento || !hora_nacimiento || !lugar_nacimiento) {
      return sendJson(res, 400, {
        ok: false,
        error: "Faltan datos.",
        required: ["fecha_nacimiento", "hora_nacimiento", "lugar_nacimiento"],
        received: { nombre, fecha_nacimiento, hora_nacimiento, lugar_nacimiento }
      });
    }

    const parsedDate = parseDate(fecha_nacimiento);
    if (!parsedDate) {
      return sendJson(res, 400, {
        ok: false,
        error: "Fecha inválida. Formato esperado: YYYY-MM-DD"
      });
    }

    const parsedHour = normalizeHour(hora_nacimiento);
    if (!parsedHour) {
      return sendJson(res, 400, {
        ok: false,
        error: "Hora inválida. Formato esperado: HH:mm o HH.mm"
      });
    }

    const geo = await ocGeocode(lugar_nacimiento);
    const tz = await googleTimeZoneForBirth(
      geo.lat,
      geo.lon,
      parsedDate.year,
      parsedDate.month,
      parsedDate.day,
      parsedHour.hour,
      parsedHour.min
    );

    const payload = {
      day: parsedDate.day,
      month: parsedDate.month,
      year: parsedDate.year,
      hour: parsedHour.hour,
      min: parsedHour.min,
      lat: geo.lat,
      lon: geo.lon,
      tzone: tz.tzone,
      house_type: "placidus"
    };

    const [planetsData, natalWheelData] = await Promise.all([
      callAstrologyApi("planets/tropical", payload),
      callAstrologyApi("natal_wheel_chart", payload, {
        image_type: "svg",
        chart_size: 500,
        sign_background: "#f7eee9",
        sign_icon_color: "#4f4a46",
        planet_icon_color: "#4f4a46",
        inner_circle_background: "#f7eee9"
      })
    ]);

    const wheelSource = extractWheelUrl(natalWheelData);
    const wheelDataUri = wheelSource ? await wheelSourceToDataUri(wheelSource) : "";
    const planets = buildPlanetMap(planetsData || []);
    const svg = buildSvg({ wheelDataUri, planets });

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'inline; filename="wheel-page.svg"');
    return res.end(svg);

  } catch (error) {
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || "Error generating wheel page",
      detail: error.detail || null
    });
  }
};
