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

function extractFromTrelloText(text) {
  const safeText = String(text || '');

  function getValue(label) {
    const regex = new RegExp(`${label}:\\s*(.+)`, 'i');
    const match = safeText.match(regex);
    return match ? match[1].trim() : '';
  }

  return {
    nombre: getValue('Nombre'),
    fecha_nacimiento: getValue('Fecha de nacimiento'),
    hora_nacimiento: getValue('Hora de nacimiento'),
    lugar_nacimiento: getValue('Lugar de nacimiento')
  };
}

const body = req.body || {};
const trelloData = body.trello_text
  ? extractFromTrelloText(body.trello_text)
  : {};

const nombre = body.nombre || trelloData.nombre;
const fecha_nacimiento = body.fecha_nacimiento || trelloData.fecha_nacimiento;
const hora_nacimiento = body.hora_nacimiento || trelloData.hora_nacimiento;
const lugar_nacimiento = body.lugar_nacimiento || trelloData.lugar_nacimiento;

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
      Por ahora soportamos Montevideo hardcodeado para probar el flujo.
      Después reemplazamos esto por geocoding automático.
    */
  const locationMap = {
  'montevideo, uruguay': {
    lat: -34.9011,
    lon: -56.1645,
    tzone: -3
  },
  'santiago de chile': {
    lat: -33.4489,
    lon: -70.6693,
    tzone: -4
  },
  'santiago, chile': {
    lat: -33.4489,
    lon: -70.6693,
    tzone: -4
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
  'Este lugar todavía no está cargado en locationMap. Después agregamos geocoding automático.'
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
            'Accept-Language': 'en'
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

    function formatDateForSheet(dateString) {
      const [yyyy, mm, dd] = String(dateString).split('-');
      return `${dd}/${mm}/${yyyy}`;
    }

    function formatHourForSheet(hourString) {
      return String(hourString).replace(':', '.');
    }

    function signToEnglish(sign) {
      const map = {
        Aries: 'Aries',
        Tauro: 'Taurus',
        Taurus: 'Taurus',
        Géminis: 'Gemini',
        Geminis: 'Gemini',
        Gemini: 'Gemini',
        Cáncer: 'Cancer',
        Cancer: 'Cancer',
        Leo: 'Leo',
        Virgo: 'Virgo',
        Libra: 'Libra',
        Escorpio: 'Scorpio',
        Scorpio: 'Scorpio',
        Sagitario: 'Sagittarius',
        Sagittarius: 'Sagittarius',
        Capricornio: 'Capricorn',
        Capricorn: 'Capricorn',
        Acuario: 'Aquarius',
        Aquarius: 'Aquarius',
        Piscis: 'Pisces',
        Pisces: 'Pisces'
      };

      return map[sign] || sign || '';
    }

    function slugPlanetName(name) {
      const map = {
        Sol: 'sol',
        Sun: 'sol',

        Luna: 'luna',
        Moon: 'luna',

        Mercurio: 'mercurio',
        Mercury: 'mercurio',

        Venus: 'venus',

        Marte: 'marte',
        Mars: 'marte',

        Júpiter: 'jupiter',
        Jupiter: 'jupiter',

        Saturno: 'saturno',
        Saturn: 'saturno',

        Urano: 'urano',
        Uranus: 'urano',

        Neptuno: 'neptuno',
        Neptune: 'neptuno',

        Plutón: 'pluton',
        Pluton: 'pluton',
        Pluto: 'pluton',

        Ascendente: 'ascendente',
        Ascendant: 'ascendente'
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
        const sign = signToEnglish(planet.sign);
        const motion = planet.isRetro === 'true' ? 'Retrograde' : 'Direct';

        excel[`${key}_signo`] = sign;
        excel[`${key}_casa`] = planet.house || '';
        excel[`${key}_grado`] = formatDegree(planet.normDegree || 0);
        excel[`${key}_grado_decimal`] = planet.normDegree || 0;
        excel[`${key}_grado_total`] = planet.fullDegree || 0;

        // Lo dejamos en los dos formatos por compatibilidad.
        excel[`${key}_retrogrado`] = planet.isRetro === 'true' ? 'Sí' : 'No';
        excel[`${key}_motion`] = motion;
      }

      if (houseCusps && Array.isArray(houseCusps.houses)) {
        for (const house of houseCusps.houses) {
          excel[`casa_${house.house}_signo`] = signToEnglish(house.sign);
          excel[`casa_${house.house}_grado_total`] = house.degree || '';
        }
      }

      excel.ascendente_grado_total = houseCusps?.ascendant || '';
      excel.medio_cielo_grado_total = houseCusps?.midheaven || '';
      excel.vertex_grado_total = houseCusps?.vertex || '';

      return excel;
    }

    function buildSheetNormalData(excel) {
      return {
        // Datos generales de la plantilla
        fecha: formatDateForSheet(fecha_nacimiento),
        hora: formatHourForSheet(horaNormalizada),
        lugar: lugar_nacimiento,
        nombre,

        // Fila Sun
        sun_sign: excel.sol_signo || '',
        sun_degree: excel.sol_grado || '',
        sun_house: excel.sol_casa || '',
        sun_motion: excel.sol_motion || '',

        // Fila Moon
        moon_sign: excel.luna_signo || '',
        moon_degree: excel.luna_grado || '',
        moon_house: excel.luna_casa || '',
        moon_motion: excel.luna_motion || '',

        // Fila Mercury
        mercury_sign: excel.mercurio_signo || '',
        mercury_degree: excel.mercurio_grado || '',
        mercury_house: excel.mercurio_casa || '',
        mercury_motion: excel.mercurio_motion || '',

        // Fila Venus
        venus_sign: excel.venus_signo || '',
        venus_degree: excel.venus_grado || '',
        venus_house: excel.venus_casa || '',
        venus_motion: excel.venus_motion || '',

        // Fila Mars
        mars_sign: excel.marte_signo || '',
        mars_degree: excel.marte_grado || '',
        mars_house: excel.marte_casa || '',
        mars_motion: excel.marte_motion || '',

        // Fila Jupiter
        jupiter_sign: excel.jupiter_signo || '',
        jupiter_degree: excel.jupiter_grado || '',
        jupiter_house: excel.jupiter_casa || '',
        jupiter_motion: excel.jupiter_motion || '',

        // Fila Saturn
        saturn_sign: excel.saturno_signo || '',
        saturn_degree: excel.saturno_grado || '',
        saturn_house: excel.saturno_casa || '',
        saturn_motion: excel.saturno_motion || '',

        // Fila Uranus
        uranus_sign: excel.urano_signo || '',
        uranus_degree: excel.urano_grado || '',
        uranus_house: excel.urano_casa || '',
        uranus_motion: excel.urano_motion || '',

        // Fila Neptune
        neptune_sign: excel.neptuno_signo || '',
        neptune_degree: excel.neptuno_grado || '',
        neptune_house: excel.neptuno_casa || '',
        neptune_motion: excel.neptuno_motion || '',

        // Fila Pluto
        pluto_sign: excel.pluton_signo || '',
        pluto_degree: excel.pluton_grado || '',
        pluto_house: excel.pluton_casa || '',
        pluto_motion: excel.pluton_motion || '',

        // Ascendente
        asc_sign: excel.ascendente_signo || '',
        asc_sign_label: excel.ascendente_signo
          ? `${excel.ascendente_signo} (ASC)`
          : '',
        asc_degree: excel.ascendente_grado || '',
        asc_house: excel.ascendente_casa || 1,

        // Casas
        casa_1_signo: excel.casa_1_signo || '',
        casa_2_signo: excel.casa_2_signo || '',
        casa_3_signo: excel.casa_3_signo || '',
        casa_4_signo: excel.casa_4_signo || '',
        casa_5_signo: excel.casa_5_signo || '',
        casa_6_signo: excel.casa_6_signo || '',
        casa_7_signo: excel.casa_7_signo || '',
        casa_8_signo: excel.casa_8_signo || '',
        casa_9_signo: excel.casa_9_signo || '',
        casa_10_signo: excel.casa_10_signo || '',
        casa_11_signo: excel.casa_11_signo || '',
        casa_12_signo: excel.casa_12_signo || ''
      };
    }

function buildSheetNormalRows(sheet) {
  return [
    [sheet.sun_sign, sheet.sun_degree, sheet.sun_house, sheet.sun_motion],
    [sheet.moon_sign, sheet.moon_degree, sheet.moon_house, sheet.moon_motion],
    [sheet.mercury_sign, sheet.mercury_degree, sheet.mercury_house, sheet.mercury_motion],
    [sheet.venus_sign, sheet.venus_degree, sheet.venus_house, sheet.venus_motion],
    [sheet.mars_sign, sheet.mars_degree, sheet.mars_house, sheet.mars_motion],
    [sheet.jupiter_sign, sheet.jupiter_degree, sheet.jupiter_house, sheet.jupiter_motion],
    [sheet.saturn_sign, sheet.saturn_degree, sheet.saturn_house, sheet.saturn_motion],
    [sheet.uranus_sign, sheet.uranus_degree, sheet.uranus_house, sheet.uranus_motion],
    [sheet.neptune_sign, sheet.neptune_degree, sheet.neptune_house, sheet.neptune_motion],
    [sheet.pluto_sign, sheet.pluto_degree, sheet.pluto_house, sheet.pluto_motion]
  ];
}

    function buildElementsData(planets) {
  const signElements = {
    Aries: 'fire',
    Leo: 'fire',
    Sagittarius: 'fire',

    Taurus: 'earth',
    Virgo: 'earth',
    Capricorn: 'earth',

    Gemini: 'air',
    Libra: 'air',
    Aquarius: 'air',

    Cancer: 'water',
    Scorpio: 'water',
    Pisces: 'water'
  };

  const allowedBodies = [
    'Sun',
    'Moon',
    'Mercury',
    'Venus',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
    'Pluto',
    'Ascendant'
  ];

  const counts = {
    fire: 0,
    earth: 0,
    air: 0,
    water: 0
  };

  for (const planet of planets) {
    if (!allowedBodies.includes(planet.name)) continue;

    const sign = signToEnglish(planet.sign);
    const element = signElements[sign];

    if (element) {
      counts[element] += 1;
    }
  }

  const total = counts.fire + counts.earth + counts.air + counts.water || 1;

  const percentages = {
    fire: Number(((counts.fire / total) * 100).toFixed(2)),
    earth: Number(((counts.earth / total) * 100).toFixed(2)),
    air: Number(((counts.air / total) * 100).toFixed(2)),
    water: Number(((counts.water / total) * 100).toFixed(2))
  };

  const dominant = Object.entries(percentages)
    .sort((a, b) => b[1] - a[1])[0][0];

return {
  counts,
  percentages,
  dominant,
  percentage_rows: [
    [percentages.fire],
    [percentages.earth],
    [percentages.air],
    [percentages.water]
  ],
  rows: [
    ['Fire', counts.fire, percentages.fire],
    ['Earth', counts.earth, percentages.earth],
    ['Air', counts.air, percentages.air],
    ['Water', counts.water, percentages.water]
  ]
};
}

const excelData = buildExcelData(planetsData, houseCuspsData);
const sheetNormalData = buildSheetNormalData(excelData);
const sheetNormalRows = buildSheetNormalRows(sheetNormalData);
const elementsData = buildElementsData(planetsData);
    
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
  sheet_normal: sheetNormalData,
  sheet_normal_rows: sheetNormalRows,
  elements: elementsData,
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
