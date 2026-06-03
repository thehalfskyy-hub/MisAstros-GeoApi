// api/swiss-test.js
// Prueba técnica con Swiss Ephemeris.
// Objetivo: calcular Quirón, Nodo Norte medio, Nodo Sur y Lilith Black Moon media.
// NO toca data-excel.js ni premium-excel.js.

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const swe = require('swisseph');

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDegree(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

function formatDegreeInSign(decimalDegree) {
  const degree = Math.floor(decimalDegree);
  const minutes = Math.round((decimalDegree - degree) * 60);

  if (minutes === 60) {
    return `${degree + 1}°00'`;
  }

  return `${degree}°${String(minutes).padStart(2, '0')}'`;
}

function degreeToSignData(fullDegreeRaw) {
  const fullDegree = normalizeDegree(fullDegreeRaw);

  const signs = [
    'Aries',
    'Taurus',
    'Gemini',
    'Cancer',
    'Leo',
    'Virgo',
    'Libra',
    'Scorpio',
    'Sagittarius',
    'Capricorn',
    'Aquarius',
    'Pisces'
  ];

  const signIndex = Math.floor(fullDegree / 30);
  const normDegree = fullDegree - signIndex * 30;

  return {
    sign: signs[signIndex],
    degree: formatDegreeInSign(normDegree),
    normDegree,
    fullDegree
  };
}

function getLongitude(result) {
  if (!result) return null;

  if (typeof result.longitude === 'number') {
    return result.longitude;
  }

  if (Array.isArray(result.xx) && typeof result.xx[0] === 'number') {
    return result.xx[0];
  }

  if (Array.isArray(result) && typeof result[0] === 'number') {
    return result[0];
  }

  return null;
}

function calcUt(julianDay, bodyId, bodyName) {
  return new Promise((resolve, reject) => {
    const flags =
      (swe.SEFLG_SWIEPH || 2) |
      (swe.SEFLG_SPEED || 256);

    swe.swe_calc_ut(julianDay, bodyId, flags, result => {
      const longitude = getLongitude(result);

      if (longitude === null) {
        return reject(new Error(`No se pudo calcular ${bodyName}`));
      }

      resolve({
        body: bodyName,
        raw: result,
        ...degreeToSignData(longitude)
      });
    });
  });
}

function localBirthToUtcParts({ year, month, day, hour, min, tzone }) {
  /*
    AstrologyAPI usa tzone como offset de la zona:
    Uruguay Summer Time = -2 significa local = UTC - 2.
    Entonces UTC = local - tzone.
  */
  const utcMs =
    Date.UTC(year, month - 1, day, hour, min, 0) -
    tzone * 60 * 60 * 1000;

  const d = new Date(utcMs);

  return {
    utcYear: d.getUTCFullYear(),
    utcMonth: d.getUTCMonth() + 1,
    utcDay: d.getUTCDate(),
    utcHour: d.getUTCHours(),
    utcMin: d.getUTCMinutes(),
    decimalHour: d.getUTCHours() + d.getUTCMinutes() / 60
  };
}

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET') {
      return res.status(405).json({
        ok: false,
        error: 'Method not allowed. Usá GET.'
      });
    }

    const year = numberOrNull(req.query.year);
    const month = numberOrNull(req.query.month);
    const day = numberOrNull(req.query.day);
    const hour = numberOrNull(req.query.hour);
    const min = numberOrNull(req.query.min);
    const tzone = numberOrNull(req.query.tzone);

    if (
      year === null ||
      month === null ||
      day === null ||
      hour === null ||
      min === null ||
      tzone === null
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan parámetros.',
        required: ['year', 'month', 'day', 'hour', 'min', 'tzone'],
        example:
          '/api/swiss-test?year=1970&month=6&day=1&hour=21&min=15&tzone=-2'
      });
    }

    // Si el paquete trae carpeta de efemérides, la usamos.
    try {
      swe.swe_set_ephe_path(`${process.cwd()}/node_modules/swisseph/ephe`);
    } catch (e) {
      // No cortamos la ejecución. Si puede calcular igual, sigue.
    }

    const utc = localBirthToUtcParts({
      year,
      month,
      day,
      hour,
      min,
      tzone
    });

    const julianDay = swe.swe_julday(
      utc.utcYear,
      utc.utcMonth,
      utc.utcDay,
      utc.decimalHour,
      swe.SE_GREG_CAL
    );

    const BODY = {
      CHIRON: swe.SE_CHIRON || 15,
      MEAN_NODE: swe.SE_MEAN_NODE || 10,
      MEAN_LILITH: swe.SE_MEAN_APOG || 12
    };

    const [chiron, meanNode, meanLilith] = await Promise.all([
      calcUt(julianDay, BODY.CHIRON, 'Chiron'),
      calcUt(julianDay, BODY.MEAN_NODE, 'Mean North Node'),
      calcUt(julianDay, BODY.MEAN_LILITH, 'Mean Black Moon Lilith')
    ]);

    const southNodeFullDegree = normalizeDegree(meanNode.fullDegree + 180);
    const southNode = {
      body: 'Mean South Node',
      ...degreeToSignData(southNodeFullDegree)
    };

    return res.status(200).json({
      ok: true,
      mode: 'swiss_test',
      message:
        'Prueba técnica con Swiss Ephemeris para puntos premium.',
      input: {
        local: {
          year,
          month,
          day,
          hour,
          min,
          tzone
        },
        utc,
        julianDay
      },
      points: {
        chiron,
        mean_north_node: meanNode,
        mean_south_node: southNode,
        mean_black_moon_lilith: meanLilith
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Error en swiss-test.js',
      details: error.message || error
    });
  }
}
