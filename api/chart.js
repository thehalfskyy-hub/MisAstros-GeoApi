// api/chart.js
// --- Configuración CORS ---
const ALLOWED_ORIGIN = "*"; // Para test. Luego cambialo por tu dominio: "https://misastros.com"

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    try {
      let data = "";
      req.on("data", chunk => { data += chunk; });
      req.on("end", () => {
        try { resolve(data ? JSON.parse(data) : {}); }
        catch { reject(new Error("JSON inválido en body")); }
      });
    } catch (e) { reject(e); }
  });
}

export default async function handler(req, res) {
  setCors(res);

  // Preflight CORS
  if (req.method === "OPTIONS") return res.status(204).end();

  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Usa POST." });
  }

  try {
    // ===== 0) Body =====
    const { date, time, place } = await readJsonBody(req);
    if (!date || !time || !place) {
      return res.status(400).json({ error: "Faltan campos: date, time, place" });
    }

    // ===== 1) Geocoding (OpenCage) =====
    if (!process.env.OPENCAGE_KEY) {
      return res.status(500).json({ error: "Falta OPENCAGE_KEY en variables de entorno" });
    }

    const ocResp = await fetch(
      `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(place)}&key=${process.env.OPENCAGE_KEY}`
    );
    const geo = await ocResp.json();

    if (!ocResp.ok) {
      return res.status(502).json({ error: "OpenCage error", detail: geo });
    }
    if (!geo.results?.length) {
      return res.status(400).json({ error: "Lugar no encontrado" });
    }

    const best = geo.results[0];
    const { lat, lng } = best.geometry || {};
    const tzAnn = best?.annotations?.timezone;

    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(500).json({ error: "OpenCage no devolvió coordenadas" });
    }
    if (!tzAnn) {
      return res.status(500).json({ error: "No se pudo determinar la zona horaria desde OpenCage" });
    }

    // OpenCage da offset en segundos (offset_sec); fallback a offset
    const totalOffset = (tzAnn.offset_sec ?? tzAnn.offset ?? 0) / 3600;

    // ===== 2) Datos base =====
    const [Y, M, D] = date.split("-").map(Number);
    const [HH, mm]  = time.split(":").map(Number);

    // ===== 3) AstrologyAPI Auth =====
    // ⚠️ REEMPLAZÁ ESTOS VALORES POR LOS TUYOS (o pasalos a env vars)
    const USER_ID = "646592"; // <--- TU USER ID
    const API_KEY = "bb8107343c440e0307f2374f70f45550ae1f36f8"; // <--- TU API KEY
    const baseAuth = "Basic " + Buffer.from(`${USER_ID}:${API_KEY}`).toString("base64");

    // ===== 4) Payload común =====
    const payload = {
      year: Y, month: M, day: D,
      hour: HH, min: mm,
      lat, lon: lng,
      tzone: totalOffset,
      chart_size: 900,
      image_type: "svg",
      // 🎨 Colores editables
      inner_circle_background: "#F9FAFB",
      sign_background: "#FFFFFF",
      sign_icon_color: "#0F172A",
      planet_icon_color: "#111827"
    };

    // ===== 5) Rueda =====
    const chartRes = await fetch("https://json.astrologyapi.com/v1/natal_wheel_chart", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": baseAuth },
      body: JSON.stringify(payload)
    });
    const chartData = await chartRes.json();
    if (!chartRes.ok) {
      return res.status(502).json({ error: "AstrologyAPI chart error", detail: chartData });
    }

    // ===== 6) Planetas / Casas =====
    const positionsRes = await fetch("https://json.astrologyapi.com/v1/western_horoscope", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": baseAuth },
      body: JSON.stringify(payload)
    });
    const positions = await positionsRes.json();
    if (!positionsRes.ok) {
      return res.status(502).json({ error: "AstrologyAPI positions error", detail: positions });
    }

    const sunSign  = positions?.planets?.find(p => p.name === "Sun")?.sign;
    const moonSign = positions?.planets?.find(p => p.name === "Moon")?.sign;
    const ascSign  = positions?.houses?.find(h => h.house === 1)?.sign;

    // ===== 7) Mini reportes =====
    const [sunReport, moonReport, ascReport] = await Promise.all([
      fetch("https://json.astrologyapi.com/v1/general_rashi_report/sun", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": baseAuth },
        body: JSON.stringify(payload)
      }).then(r => r.json()),
      fetch("https://json.astrologyapi.com/v1/general_rashi_report/moon", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": baseAuth },
        body: JSON.stringify(payload)
      }).then(r => r.json()),
      fetch("https://json.astrologyapi.com/v1/general_ascendant_report", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": baseAuth },
        body: JSON.stringify(payload)
      }).then(r => r.json())
    ]);

    return res.status(200).json({
      chartUrl: chartData.chart_url,
      sun:  { sign: sunSign,  text: sunReport?.report || "" },
      moon: { sign: moonSign, text: moonReport?.report || "" },
      asc:  { sign: ascSign,  text: ascReport?.report || "" }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message || "Error interno" });
  }
}
