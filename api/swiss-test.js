// api/swiss-test.js
// Prueba técnica con sweph / Swiss Ephemeris.
// Calcula puntos premium: Chiron, Mean Node, South Node y Mean Black Moon Lilith.
// No toca data-excel.js ni premium-excel.js.

import sweph from 'sweph';

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
  let degree = Math.floor(decimalDegree);
  let minutes = Math.round((decimalDegree - degree) * 60);

  if (minutes === 60) {
    degree += 1;
    minutes = 0;
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

function extractLongitude(result) {
  if (!result) return null;

  if (typeof result.longitude === 'number') return result.longitude;
  if (typeof result.lon === 'number') return result.lon;

  if (Array.isArray(result)) {
    if (typeof result[0] === 'number') return result[0];

    if (Array.isArray(result[0]) && typeof result[0][0] === 'number') {
      return result[0][0];
    }
  }

  if (Array.isArray(result.xx) && typeof result.xx[0] === 'number') {
    return result.xx[0];
  }

  if (Array.isArray(result.data) && typeof result.data[0] === 'number') {
    return result.data[0];
  }

  if (result.data && Array.isArray(result.data.xx) && typeof result.data.xx[0] === 'number') {
    return result.data.xx[0];
  }

  return null;
}

function localBirthToUtcParts({ year, month, day, hour, min, tzone }) {
  /*
    tzone viene como offset horario.
    Ejemplo: Uruguay Summer Time = -2.
    Local = UTC - 2.
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

function getConstant(name, fallback) {
  return (
    sweph?.constants?.[name] ??
    sweph?.[name] ??
    fallback
  );
}

function calcBody({ julianDay, bodyId, bodyName, flags }) {
  try {
    const result = sweph.calc_ut(julianDay, bodyId, flags);
    const longitude = extractLongitude(result);

    if (longitude === null) {
      return {
        ok: false,
        body: bodyName,
        error: 'No pude extraer longitude del resultado.',
        raw: result
      };
    }

    return {
      ok: true,
      body: bodyName,
      ...degreeToSignData(longitude),
      raw: result
    };
  } catch (error) {
    return {
      ok: false,
      body: bodyName,
      error: error.message || String(error)
    };
  }
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

    const utc = localBirthToUtcParts({
      year,
      month,
      day,
      hour,
      min,
      tzone
    });

    const SE_GREG_CAL = getConstant('SE_GREG_CAL', 1);

    const julianDay = sweph.julday(
      utc.utcYear,
      utc.utcMonth,
      utc.utcDay,
      utc.decimalHour,
      SE_GREG_CAL
    );

    const SEFLG_SPEED = getConstant('SEFLG_SPEED', 256);
    const SEFLG_SWIEPH = getConstant('SEFLG_SWIEPH', 2);
    const SEFLG_MOSEPH = getConstant('SEFLG_MOSEPH', 4);

    /*
      Primero intentamos con SWIEPH.
      Si faltan archivos de efemérides, puede fallar Chiron.
      Después, si hace falta, probamos con MOSEPH.
    */
    const flagsSwiss = SEFLG_SWIEPH | SEFLG_SPEED;
    const flagsMoshier = SEFLG_MOSEPH | SEFLG_SPEED;

    const BODY = {
      CHIRON: getConstant('SE_CHIRON', 15),
      MEAN_NODE: getConstant('SE_MEAN_NODE', 10),
      MEAN_LILITH: getConstant('SE_MEAN_APOG', 12)
    };

    const chironSwiss = calcBody({
      julianDay,
      bodyId: BODY.CHIRON,
      bodyName: 'Chiron',
      flags: flagsSwiss
    });

    const meanNodeSwiss = calcBody({
      julianDay,
      bodyId: BODY.MEAN_NODE,
      bodyName: 'Mean North Node',
      flags: flagsSwiss
    });

    const meanLilithSwiss = calcBody({
      julianDay,
      bodyId: BODY.MEAN_LILITH,
      bodyName: 'Mean Black Moon Lilith',
      flags: flagsSwiss
    });

    const chironMoshier = chironSwiss.ok
      ? null
      : calcBody({
          julianDay,
          bodyId: BODY.CHIRON,
          bodyName: 'Chiron',
          flags: flagsMoshier
        });

    const meanNodeMoshier = meanNodeSwiss.ok
      ? null
      : calcBody({
          julianDay,
          bodyId: BODY.MEAN_NODE,
          bodyName: 'Mean North Node',
          flags: flagsMoshier
        });

    const meanLilithMoshier = meanLilithSwiss.ok
      ? null
      : calcBody({
          julianDay,
          bodyId: BODY.MEAN_LILITH,
          bodyName: 'Mean Black Moon Lilith',
          flags: flagsMoshier
        });

    const chiron = chironSwiss.ok ? chironSwiss : chironMoshier;
    const meanNode = meanNodeSwiss.ok ? meanNodeSwiss : meanNodeMoshier;
    const meanLilith = meanLilithSwiss.ok ? meanLilithSwiss : meanLilithMoshier;

    let southNode = null;

    if (meanNode && meanNode.ok) {
      const southNodeFullDegree = normalizeDegree(meanNode.fullDegree + 180);

      southNode = {
        ok: true,
        body: 'Mean South Node',
        ...degreeToSignData(southNodeFullDegree)
      };
    } else {
      southNode = {
        ok: false,
        body: 'Mean South Node',
        error: 'No se pudo calcular porque falló Mean North Node.'
      };
    }

    return res.status(200).json({
      ok: true,
      mode: 'sweph_swiss_test',
      message:
        'Prueba técnica con sweph para puntos premium. Comparar contra Astro-Seek.',
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
      constants_used: {
        SE_GREG_CAL,
        SEFLG_SPEED,
        SEFLG_SWIEPH,
        SEFLG_MOSEPH,
        BODY
      },
      points: {
        chiron,
        mean_north_node: meanNode,
        mean_south_node: southNode,
        mean_black_moon_lilith: meanLilith
      },
      debug_attempts: {
        swiss: {
          chiron: chironSwiss,
          mean_north_node: meanNodeSwiss,
          mean_black_moon_lilith: meanLilithSwiss
        },
        moshier_fallback: {
          chiron: chironMoshier,
          mean_north_node: meanNodeMoshier,
          mean_black_moon_lilith: meanLilithMoshier
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Error en swiss-test.js',
      details: error.message || error,
      stack: error.stack || null
    });
  }
}
