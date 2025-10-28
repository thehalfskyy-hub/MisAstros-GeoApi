export default async function handler(req, res) {
  try {
    const { date, time, place } = req.body;

    // ---------- 1. Geocoding (OpenCage) ----------
    const oc = await fetch(`https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(place)}&key=${process.env.OPENCAGE_KEY}`);
    const geo = await oc.json();
    if (!geo.results?.length) return res.status(400).json({ error: 'Lugar no encontrado' });
    const { lat, lng } = geo.results[0].geometry;

    // ---------- 2. Timezone (Google Time Zone API) ----------
    const tsLocal = Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
    const tzr = await fetch(`https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lng}&timestamp=${tsLocal}&key=${process.env.GOOGLE_TZ_KEY}`);
    const tzj = await tzr.json();
    const totalOffset = (tzj.rawOffset + tzj.dstOffset) / 3600; // offset en horas

    // ---------- 3. Preparo los datos ----------
    const [Y, M, D] = date.split('-').map(Number);
    const [HH, mm] = time.split(':').map(Number);

    // ---------- 4. Autenticación AstrologyAPI ----------
    // ⚠️ CAMBIAR ESTOS DOS DATOS POR LOS TUYOS
    const USER_ID = "646592"; // tu user id de AstrologyAPI
    const API_KEY = "bb8107343c440e0307f2374f70f45550ae1f36f8"; // tu API key de AstrologyAPI
    const baseAuth = Buffer.from(`${USER_ID}:${API_KEY}`).toString("base64");

    // ---------- 5. Payload base para las llamadas ----------
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

    // ---------- 6. Llamada a AstrologyAPI: rueda ----------
    const chartRes = await fetch("https://json.astrologyapi.com/v1/natal_wheel_chart", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + baseAuth
      },
      body: JSON.stringify(payload)
    });
    const chartData = await chartRes.json();

    // ---------- 7. Llamada: posiciones planetarias ----------
    const planetsRes = await fetch("https://json.astrologyapi.com/v1/western_horoscope", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + baseAuth
      },
      body: JSON.stringify(payload)
    });
    const planetsData = await planetsRes.json();

    // Leo los signos del Sol, Luna y Ascendente
    const sunSign = planetsData?.planets?.find(p => p.name === "Sun")?.sign;
    const moonSign = planetsData?.planets?.find(p => p.name === "Moon")?.sign;
    const ascSign = planetsData?.houses?.find(h => h.house === 1)?.sign;

    // ---------- 8. Llamadas a los reportes cortos ----------
    const [sunReport, moonReport, ascReport] = await Promise.all([
      fetch(`https://json.astrologyapi.com/v1/general_rashi_report/sun`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Basic " + baseAuth },
        body: JSON.stringify(payload)
      }).then(r => r.json()),

      fetch(`https://json.astrologyapi.com/v1/general_rashi_report/moon`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Basic " + baseAuth },
        body: JSON.stringify(payload)
      }).then(r => r.json()),

      fetch(`https://json.astrologyapi.com/v1/general_ascendant_report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Basic " + baseAuth },
        body: JSON.stringify(payload)
      }).then(r => r.json())
    ]);

    // ---------- 9. Devuelvo todo al frontend ----------
    res.status(200).json({
      chartUrl: chartData.chart_url,
      sun: { sign: sunSign, text: sunReport?.report },
      moon: { sign: moonSign, text: moonReport?.report },
      asc: { sign: ascSign, text: ascReport?.report }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
