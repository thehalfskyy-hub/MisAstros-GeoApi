export default async function handler(req, res) {
  try {
    // CORS básico para que puedas testear si hace falta desde navegador/Make
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        ok: false,
        error: 'Method not allowed. Usá POST.'
      });
    }

    const {
      nombre,
      fecha_nacimiento,
      hora_nacimiento,
      lugar_nacimiento
    } = req.body || {};

    if (!nombre || !fecha_nacimiento || !hora_nacimiento || !lugar_nacimiento) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan datos obligatorios.',
        required: [
          'nombre',
          'fecha_nacimiento',
          'hora_nacimiento',
          'lugar_nacimiento'
        ],
        received: {
          nombre,
          fecha_nacimiento,
          hora_nacimiento,
          lugar_nacimiento
        }
      });
    }

    // Fecha esperada: YYYY-MM-DD
    const [year, month, day] = String(fecha_nacimiento)
      .split('-')
      .map(Number);

    if (!year || !month || !day) {
      return res.status(400).json({
        ok: false,
        error: 'Formato de fecha inválido. Usá YYYY-MM-DD.',
        fecha_nacimiento
      });
    }

    // Hora aceptada: 21.15 o 21:15
    const horaNormalizada = String(hora_nacimiento)
      .trim()
      .replace('.', ':');

    const [hour, min] = horaNormalizada.split(':').map(Number);

    if (
      Number.isNaN(hour) ||
      Number.isNaN(min) ||
      hour < 0 ||
      hour > 23 ||
      min < 0 ||
      min > 59
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Formato de hora inválido. Usá HH:mm o HH.mm.',
        hora_nacimiento
      });
    }

    /*
      PRIMERA VERSIÓN:
      Por ahora soportamos Montevideo hardcodeado para probar todo el flujo.
      Después lo reemplazamos por geocoding automático usando OpenCage + Google TZ,
      que veo que ya tenés cargados en Vercel.
    */
    const locationMap = {
      'montevideo, uruguay': {
        lat: -34.9011,
        lon: -56.1645,
        tzone: -3
      }
    };

    const locationKey = String(lugar_nacimiento)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const location = locationMap[locationKey];

    if (!location) {
      return res.status(400).json({
        ok: false,
        error: 'Lugar no soportado todavía.',
        lugar_nacimiento,
        message:
          'Para esta primera prueba solo está cargado Montevideo, Uruguay. Después agregamos geocoding automático.'
      });
    }

    // Variables que ya tenés en Vercel
    const userId = process.env.ASTRO_USER_ID;
    const apiKey = process.env.ASTRO_API_KEY;

    if (!userId || !apiKey) {
      return res.status(500).json({
        ok: false,
        error:
          'Faltan variables de entorno ASTRO_USER_ID o ASTRO_API_KEY en Vercel.'
      });
    }

    const auth = Buffer.from(`${userId}:${apiKey}`).toString('base64');

    const payload = {
      day,
      month,
      year,
      hour,
      min,
      lat: location.lat,
      lon: location.lon,
      tzone: location.tzone
    };

    /*
      AstrologyAPI:
      - Usa Basic Auth con User ID como username y API Key como password.
      - El endpoint western_chart_data es POST y devuelve casas, planetas en casas y aspectos.
      Docs oficiales:
      https://www.astrologyapi.com/western-api-docs/api-ref/163/western_chart_data
    */
    const astrologyResponse = await fetch(
      'https://json.astrologyapi.com/v1/western_chart_data',
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept-Language': 'es'
        },
        body: JSON.stringify(payload)
      }
    );

    const astrologyData = await astrologyResponse.json();

    if (!astrologyResponse.ok) {
      return res.status(astrologyResponse.status).json({
        ok: false,
        error: 'Error desde AstrologyAPI.',
        sent_payload: payload,
        details: astrologyData
      });
    }

    return res.status(200).json({
      ok: true,
      input: {
        nombre,
        fecha_nacimiento,
        hora_nacimiento: horaNormalizada,
        lugar_nacimiento,
        lat: location.lat,
        lon: location.lon,
        tzone: location.tzone
      },
      sent_payload: payload,
      raw: astrologyData
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error interno en data-excel.js'
    });
  }
}
