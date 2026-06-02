export default async function handler(req, res) {
  try {
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
      Por ahora soportamos Montevideo hardcodeado para probar el flujo.
      Después reemplazamos esto por geo_details + timezone_with_dst.
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
      tzone: location.tzone,
      house_type: 'placidus'
    };

    async function callAstrologyApi(endpoint) {
      const response = await fetch(
        `https://json.astrologyapi.com/v1/${endpoint}`,
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

      const data = await response.json();

      if (!response.ok) {
        throw {
          status: response.status,
          endpoint,
          data
        };
      }

      return data;
    }

    const [planetsData, houseCuspsData] = await Promise.all([
      callAstrologyApi('planets/tropical'),
      callAstrologyApi('house_cusps/tropical')
    ]);

    function formatDegree(decimalDegree) {
  const degree = Math.floor(decimalDegree);
  const minutes = Math.round((decimalDegree - degree) * 60);

  if (minutes === 60) {
    return `${degree + 1}°00'`;
  }

  return `${degree}°${String(minutes).padStart(2, '0')}'`;
}

function slugPlanetName(name) {
  const map = {
    'Sol': 'sol',
    'Luna': 'luna',
    'Mercurio': 'mercurio',
    'Venus': 'venus',
    'Marte': 'marte',
    'Júpiter': 'jupiter',
    'Jupiter': 'jupiter',
    'Saturno': 'saturno',
    'Urano': 'urano',
    'Neptuno': 'neptuno',
    'Plutón': 'pluton',
    'Pluton': 'pluton',
    'Ascendente': 'ascendente'
  };

  return map[name] || String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function buildExcelData(planets, houseCusps) {
  const excel = {};

  for (const planet of planets) {
    const key = slugPlanetName(planet.name);

    excel[`${key}_signo`] = planet.sign || '';
    excel[`${key}_casa`] = planet.house || '';
    excel[`${key}_grado`] = formatDegree(planet.normDegree || 0);
    excel[`${key}_grado_decimal`] = planet.normDegree || 0;
    excel[`${key}_grado_total`] = planet.fullDegree || 0;
    excel[`${key}_retrogrado`] = planet.isRetro === 'true' ? 'Sí' : 'No';
  }

  if (houseCusps && Array.isArray(houseCusps.houses)) {
    for (const house of houseCusps.houses) {
      excel[`casa_${house.house}_signo`] = house.sign || '';
      excel[`casa_${house.house}_grado_total`] = house.degree || '';
    }
  }

  excel.ascendente_grado_total = houseCusps?.ascendant || '';
  excel.medio_cielo_grado_total = houseCusps?.midheaven || '';
  excel.vertex_grado_total = houseCusps?.vertex || '';

  return excel;
}

const excelData = buildExcelData(planetsData, houseCuspsData);

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
  excel: excelData,
  sent_payload: payload,
  raw: {
    planets: planetsData,
    house_cusps: houseCuspsData
  }
});
    
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: 'Error en data-excel.js',
      endpoint: error.endpoint || null,
      details: error.data || error.message || error
    });
  }
}
