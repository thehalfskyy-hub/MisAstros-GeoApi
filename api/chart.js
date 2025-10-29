// api/chart.js
const ALLOWED_ORIGIN = "*"; // Para test. Luego cambiá a tu dominio (ej: https://misastros.com)

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readJsonBody(req) {
  // Vercel Node serverless no parsea el body por defecto en "Other"
  return await new Promise((resolve, reject) => {
    try {
      let data = "";
      req.on("data", chunk => { data += chunk; });
      req.on("end", () => {
        try { resolve(data ? JSON.parse(data) : {}); }
        catch (e) { reject(new Error("JSON inválido en body")); }
      });
    } catch (e) { reject(e); }
  });
}

export default async function handler(req, res) {
  setCors(res);

  // 1) Preflight CORS
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // 2) Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Usa POST." });
  }

  try {
    // ----- BODY -----
    const { date, time, place } = await readJsonBody(req);
    if (!date || !time || !place) {
      return res.status(400).json({ error: "Faltan campos: date, time, place" });
    }

    // ----- 1) Geocoding (OpenCage) -----
    const ocResp = await fetch(
      `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(place)}&key=${process.env.OPENCAGE_KEY}`
    );
    const geo = await ocResp.json();
    if (!geo.results?.length) return res.status(400).json({ error: "Lugar no encontrado" });
    const { lat, lng } = geo.results[0].geometry;

    // ----- 2) Timezone (Google Time Zone API) -----
    const tsLocal = Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
    const tzResp = await fetch(
      `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${tsLocal}&key=${process.env.GOOGLE_TZ_KEY}`
    );
    const tzj = await tzResp.json();
    if (tzj.status !== "OK") return res.status(500).json({ error: "Error en Google Time Zone", detail: tzj });
    const totalOffset = (tzj.rawOffset + tzj.dstOffset) / 3600;

    // ----- 3) Datos base -----
    const [Y, M, D] = date.split('-').map(Number);
    const [HH, mm] = time.split(':').map(Number);

    // ----- 4) AstrologyAPI Auth (pone tus credenciales) -----
    const USER_ID = "646592"; // <--- TU USER ID
    const API_KEY = "bb8107343c440e0307f2374f70f45550ae1f36f8"; // <--- TU API KEY
    const baseAuth = "Basic " + Buffer.from(`${USER_ID}:${API_KEY}`).toString("base64");

    // ----- 5) Payload común -----
    const payload = {
      year: Y, month: M, day: D,
      hour: HH, min: mm,
      lat, lon: lng,
      tzone: totalOffset,
      chart_size: 900,
      image_type: "svg",
      inner_circle_background: "#F9FAFB",
      sign_background: "#FFFFFF",
      sign_icon_color: "#0F172A",
      planet_icon_color: "#111827"
    };

    // ----- 6) Rueda -----
    const chartRes = await fetch("https://json.astrologyapi.com/v1/natal_wheel_chart", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": baseAuth },
      body: JSON.stringify(payload)
    });
    const chartData = await chartRes.json();
    if (!chartRes.ok) return res.status(502).json({ error: "AstrologyAPI chart error", detail: chartData });

    // ----- 7) Planetas/Houses -----
    const planetsRes = await fetch("https://json.astrologyapi.com/v1/western_horoscope", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": baseAuth },
      body: JSON.stringify(payload)
    });
    const planetsData = await planetsRes.json();
    if (!planetsRes.ok) return res.status(502).json({ error: "AstrologyAPI positions error", detail: planetsData });

    const sunSign  = planetsData?.planets?.find(p => p.name === "Sun")?.sign;
    const moonSign = planetsData?.planets?.find(p => p.name === "Moon")?.sign;
    const ascSign  = planetsData?.houses?.find(h => h.house === 1)?.sign;

    // ----- 8) Reports cortos -----
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
