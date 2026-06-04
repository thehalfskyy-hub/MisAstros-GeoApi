// api/premium-aspects.js
// Endpoint de prueba/producción para aspectos de Carta Natal Premium.
// Calcula aspectos mayores usando grados completos:
// Conjunction, Sextile, Square, Trine, Opposition.
// Combina planetas de AstrologyAPI + puntos premium de Swiss Ephemeris.

import sweph from 'sweph';
import path from 'path';

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

function formatOrb(decimalDegree) {
  const value = Math.abs(Number(decimalDegree) || 0);
  let degree = Math.floor(value);
  let minutes = Math.round((value - degree) * 60);

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

  if (
    result.data &&
    Array.isArray(result.data.xx) &&
    typeof result.data.xx[0] === 'number'
  ) {
    return result.data.xx[0];
  }

  return null;
}

function extractSpeed(result) {
  if (!result) return 0;

  if (typeof result.speed === 'number') return result.speed;

  if (Array.isArray(result.data) && typeof result.data[3] === 'number') {
    return result.data[3];
  }

  if (Array.isArray(result.xx) && typeof result.xx[3] === 'number') {
    return result.xx[3];
  }

  if (Array.isArray(result) && typeof result[3] === 'number') {
    return result[3];
  }

  return 0;
}

function motionFromSpeed(speed) {
  return Number(speed) < 0 ? 'Retrograde' : 'Direct';
}

function getConstant(name, fallback) {
  return sweph?.constants?.[name] ?? sweph?.[name] ?? fallback;
}

function calcBody({ julianDay, bodyId, bodyName, flags }) {
  try {
    const result = sweph.calc_ut(julianDay, bodyId, flags);
    const longitude = extractLongitude(result);
    const rawError = result?.error || result?.serr || '';

    if (
      rawError ||
      result?.flag === -1 ||
      longitude === null ||
      (Array.isArray(result?.data) && result.data.every(n => Number(n) === 0))
    ) {
      return {
        ok: false,
        body: bodyName,
        error: rawError || 'No pude extraer longitude válida del resultado.',
        raw: result
      };
    }

    const speed = extractSpeed(result);

    return {
      ok: true,
      body: bodyName,
      ...degreeToSignData(longitude),
      speed,
      motion: motionFromSpeed(speed),
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

function localBirthToUtcParts({ year, month, day, hour, min, tzone }) {
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

function extractFromTrelloText(text) {
  const safeText = String(text || '');

  function getValue(label) {
    const regex = new RegExp(`${label}:\\s*(.+)`, 'i');
    const match = safeText.match(regex);
    return match ? match[1].trim() : '';
  }

  return {
    tipo_producto_interno: getValue('Tipo de producto interno'),
    nombre: getValue('Nombre'),
    fecha_nacimiento: getValue('Fecha de nacimiento'),
    hora_nacimiento: getValue('Hora de nacimiento'),
    lugar_nacimiento: getValue('Lugar de nacimiento')
  };
}

async function ocGeocode(place) {
  const key = process.env.OPENCAGE_KEY;

  if (!key) {
    const e = new Error('Falta OPENCAGE_KEY en Vercel.');
    e.status = 500;
    throw e;
  }

  const url =
    'https://api.opencagedata.com/geocode/v1/json?q=' +
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
    const e = new Error('Lugar no encontrado.');
    e.status = 400;
    throw e;
  }

  return {
    lat: result.geometry.lat,
    lon: result.geometry.lng,
    formatted: result.formatted || place,
    city:
      result.components?.city ||
      result.components?.town ||
      result.components?.village ||
      '',
    state: result.components?.state || '',
    country: result.components?.country || ''
  };
}

async function googleTimeZoneForBirth(lat, lon, year, month, day, hour, min) {
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_TZ_KEY;

  if (!key) {
    const e = new Error('Falta GOOGLE_API_KEY o GOOGLE_TZ_KEY en Vercel.');
    e.status = 500;
    throw e;
  }

  const timestamp = Math.floor(
    Date.UTC(year, month - 1, day, hour || 12, min || 0) / 1000
  );

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

  if (data.status !== 'OK') {
    const e = new Error(`Google Time Zone status: ${data.status}`);
    e.status = 502;
    e.detail = data;
    throw e;
  }

  const totalOffsetSeconds = (data.rawOffset || 0) + (data.dstOffset || 0);

  return {
    tzone: totalOffsetSeconds / 3600,
    timezoneId: data.timeZoneId || '',
    timezoneName: data.timeZoneName || '',
    rawOffset: data.rawOffset || 0,
    dstOffset: data.dstOffset || 0
  };
}

async function callAstrologyApi(endpoint, payload) {
  const userId = process.env.ASTRO_USER_ID;
  const apiKey = process.env.ASTRO_API_KEY;

  if (!userId || !apiKey) {
    const e = new Error('Faltan ASTRO_USER_ID o ASTRO_API_KEY en Vercel.');
    e.status = 500;
    throw e;
  }

  const auth = Buffer.from(`${userId}:${apiKey}`).toString('base64');

  const response = await fetch(`https://json.astrologyapi.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'en'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = text;
  }

  if (!response.ok) {
    const e = new Error(`AstrologyAPI ${endpoint} error ${response.status}`);
    e.status = response.status;
    e.detail = data;
    throw e;
  }

  return data;
}

function buildHouseCuspsArray(houseCuspsData) {
  const houses = Array.isArray(houseCuspsData?.houses)
    ? houseCuspsData.houses
    : [];

  return houses
    .map(h => ({
      house: Number(h.house),
      degree: normalizeDegree(h.degree)
    }))
    .filter(h => Number.isFinite(h.house) && Number.isFinite(h.degree))
    .sort((a, b) => a.house - b.house);
}

function degreeDistanceForward(from, to) {
  return normalizeDegree(to - from);
}

function isDegreeInsideHouse(pointDegree, cuspStart, cuspEnd) {
  const totalArc = degreeDistanceForward(cuspStart, cuspEnd);
  const pointArc = degreeDistanceForward(cuspStart, pointDegree);

  return pointArc >= 0 && pointArc < totalArc;
}

function findHouseForDegree(fullDegree, houseCuspsData) {
  const cusps = buildHouseCuspsArray(houseCuspsData);

  if (cusps.length !== 12) return '';

  const point = normalizeDegree(fullDegree);

  for (let i = 0; i < 12; i++) {
    const current = cusps[i];
    const next = cusps[(i + 1) % 12];

    if (isDegreeInsideHouse(point, current.degree, next.degree)) {
      return current.house;
    }
  }

  return '';
}

function findPlanet(planets, name) {
  return (Array.isArray(planets) ? planets : []).find(
    p => String(p.name).toLowerCase() === String(name).toLowerCase()
  );
}

function calculatePartOfFortune({ planetsData, houseCuspsData }) {
  const sun = findPlanet(planetsData, 'Sun');
  const moon = findPlanet(planetsData, 'Moon');

  const asc = Number(houseCuspsData?.ascendant);
  const sunDegree = Number(sun?.fullDegree);
  const moonDegree = Number(moon?.fullDegree);

  if (
    !Number.isFinite(asc) ||
    !Number.isFinite(sunDegree) ||
    !Number.isFinite(moonDegree)
  ) {
    return {
      ok: false,
      body: 'Part of Fortune',
      error: 'Faltan Sol, Luna o Ascendente para calcular Parte de Fortuna.'
    };
  }

  const sunHouse = Number(sun?.house);
  const isDayChart = sunHouse >= 7 && sunHouse <= 12;

  const fortuneFullDegree = isDayChart
    ? normalizeDegree(asc + moonDegree - sunDegree)
    : normalizeDegree(asc + sunDegree - moonDegree);

  return {
    ok: true,
    body: 'Part of Fortune',
    formula: isDayChart
      ? 'Day chart: ASC + Moon - Sun'
      : 'Night chart: ASC + Sun - Moon',
    chartSect: isDayChart ? 'day' : 'night',
    ...degreeToSignData(fortuneFullDegree),
    house: findHouseForDegree(fortuneFullDegree, houseCuspsData),
    motion: ''
  };
}

function buildCalculatedPoint({ body, fullDegree, houseCuspsData }) {
  return {
    ok: true,
    body,
    ...degreeToSignData(fullDegree),
    house: findHouseForDegree(fullDegree, houseCuspsData),
    motion: ''
  };
}

function addHouse(point, houseCuspsData) {
  if (!point || !point.ok) return point;

  return {
    ...point,
    house: findHouseForDegree(point.fullDegree, houseCuspsData)
  };
}

function normalizePlanetNameForOutput(name) {
  const map = {
    Sun: 'Sun',
    Moon: 'Moon',
    Mercury: 'Mercury',
    Venus: 'Venus',
    Mars: 'Mars',
    Jupiter: 'Jupiter',
    Saturn: 'Saturn',
    Uranus: 'Uranus',
    Neptune: 'Neptune',
    Pluto: 'Pluto',
    Ascendant: 'Ascendant',
    Midheaven: 'Midheaven',
    Chiron: 'Chiron',
    'Mean North Node': 'North Node',
    'Mean South Node': 'South Node',
    'Mean Black Moon Lilith': 'Lilith',
    'Part of Fortune': 'Part of Fortune',
    Vertex: 'Vertex'
  };

  return map[name] || name;
}

function bodyType(name) {
  if (name === 'Sun' || name === 'Moon') return 'luminary';

  if (['Mercury', 'Venus', 'Mars'].includes(name)) return 'personal';

  if (['Jupiter', 'Saturn'].includes(name)) return 'social';

  if (['Uranus', 'Neptune', 'Pluto'].includes(name)) return 'transpersonal';

  if (['Ascendant', 'Midheaven'].includes(name)) return 'angle';

  return 'point';
}

function planetToAspectBody(planet) {
  const name = normalizePlanetNameForOutput(planet.name);

  return {
    name,
    type: bodyType(name),
    sign: planet.sign || '',
    degree: formatDegreeInSign(Number(planet.normDegree) || 0),
    house: planet.house || '',
    fullDegree: normalizeDegree(planet.fullDegree),
    motion: planet.isRetro === 'true' ? 'Retrograde' : 'Direct'
  };
}

function pointToAspectBody(point, outputName) {
  return {
    name: outputName || normalizePlanetNameForOutput(point.body),
    type: bodyType(outputName || normalizePlanetNameForOutput(point.body)),
    sign: point.sign || '',
    degree: point.degree || '',
    house: point.house || '',
    fullDegree: normalizeDegree(point.fullDegree),
    motion: point.motion || ''
  };
}

function smallestAngularDistance(a, b) {
  const raw = Math.abs(normalizeDegree(a) - normalizeDegree(b));
  return raw > 180 ? 360 - raw : raw;
}

function aspectNature(aspectName) {
  const map = {
    Conjunction: 'neutral',
    Sextile: 'harmonious',
    Square: 'tense',
    Trine: 'harmonious',
    Opposition: 'tense'
  };

  return map[aspectName] || '';
}

function orbLimitForBodies(bodyA, bodyB) {
  const types = [bodyA.type, bodyB.type];

  // Para puntos sensibles, usamos orbe más estricto.
  if (types.includes('point')) return 4;

  // Para ángulos, también estricto.
  if (types.includes('angle')) return 5;

  // Sol o Luna permiten más orbe.
  if (types.includes('luminary')) return 8;

  // Personales/sociales.
  if (types.includes('personal') || types.includes('social')) return 6;

  // Transpersonales entre sí.
  return 5;
}

function calculateAspects(bodies) {
  const ASPECTS = [
    { name: 'Conjunction', angle: 0 },
    { name: 'Sextile', angle: 60 },
    { name: 'Square', angle: 90 },
    { name: 'Trine', angle: 120 },
    { name: 'Opposition', angle: 180 }
  ];

  const aspects = [];

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];

      const separation = smallestAngularDistance(a.fullDegree, b.fullDegree);
      const maxOrb = orbLimitForBodies(a, b);

      for (const aspect of ASPECTS) {
        const orb = Math.abs(separation - aspect.angle);

        if (orb <= maxOrb) {
          aspects.push({
            planet_1: a.name,
            planet_1_sign: a.sign,
            planet_1_degree: a.degree,
            planet_1_house: a.house,
            aspect: aspect.name,
            aspect_angle: aspect.angle,
            planet_2: b.name,
            planet_2_sign: b.sign,
            planet_2_degree: b.degree,
            planet_2_house: b.house,
            orb_decimal: Number(orb.toFixed(4)),
            orb: formatOrb(orb),
            max_orb_used: maxOrb,
            separation_decimal: Number(separation.toFixed(4)),
            nature: aspectNature(aspect.name)
          });

          break;
        }
      }
    }
  }

  return aspects.sort((a, b) => a.orb_decimal - b.orb_decimal);
}

function buildAspectRows(aspects) {
  return aspects.map(a => [
    a.planet_1,
    a.aspect,
    a.planet_2,
    a.orb,
    a.nature
  ]);
}

function buildBodiesForAspects({ planetsData, houseCuspsData, premiumPoints }) {
  const baseOrder = [
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

  const bodies = [];

  for (const name of baseOrder) {
    const planet = findPlanet(planetsData, name);
    if (planet) bodies.push(planetToAspectBody(planet));
  }

  const midheavenDegree = normalizeDegree(houseCuspsData?.midheaven);
  const vertexDegree = normalizeDegree(houseCuspsData?.vertex);

  const midheaven = buildCalculatedPoint({
    body: 'Midheaven',
    fullDegree: midheavenDegree,
    houseCuspsData
  });

  const vertex = buildCalculatedPoint({
    body: 'Vertex',
    fullDegree: vertexDegree,
    houseCuspsData
  });

  bodies.push(pointToAspectBody(midheaven, 'Midheaven'));
  bodies.push(pointToAspectBody(premiumPoints.chiron, 'Chiron'));
  bodies.push(pointToAspectBody(premiumPoints.mean_black_moon_lilith, 'Lilith'));
  bodies.push(pointToAspectBody(premiumPoints.mean_north_node, 'North Node'));
  bodies.push(pointToAspectBody(premiumPoints.mean_south_node, 'South Node'));
  bodies.push(pointToAspectBody(premiumPoints.part_of_fortune, 'Part of Fortune'));
  bodies.push(pointToAspectBody(vertex, 'Vertex'));

  return bodies.filter(
    b =>
      b &&
      b.name &&
      Number.isFinite(Number(b.fullDegree))
  );
}

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({
        ok: false,
        error: 'Method not allowed. Usá GET o POST.'
      });
    }

    const source = req.method === 'GET' ? req.query : req.body || {};

    const trelloData = source.trello_text
      ? extractFromTrelloText(source.trello_text)
      : {};

    const nombre = source.nombre || trelloData.nombre || '';
    const fecha_nacimiento =
      source.fecha_nacimiento || trelloData.fecha_nacimiento || '';
    const hora_nacimiento =
      source.hora_nacimiento || trelloData.hora_nacimiento || '';
    const lugar_nacimiento =
      source.lugar_nacimiento || trelloData.lugar_nacimiento || '';

    if (!fecha_nacimiento || !hora_nacimiento || !lugar_nacimiento) {
      return res.status(400).json({
        ok: false,
        error: 'Faltan datos obligatorios.',
        required: ['fecha_nacimiento', 'hora_nacimiento', 'lugar_nacimiento'],
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

    const horaNormalizada = String(hora_nacimiento).trim().replace('.', ':');
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

    const geo = await ocGeocode(lugar_nacimiento);

    const timezoneData = await googleTimeZoneForBirth(
      geo.lat,
      geo.lon,
      year,
      month,
      day,
      hour,
      min
    );

    const payload = {
      day,
      month,
      year,
      hour,
      min,
      lat: geo.lat,
      lon: geo.lon,
      tzone: timezoneData.tzone,
      house_type: 'placidus'
    };

    const [planetsData, houseCuspsData] = await Promise.all([
      callAstrologyApi('planets/tropical', payload),
      callAstrologyApi('house_cusps/tropical', payload)
    ]);

    sweph.set_ephe_path(path.join(process.cwd(), 'ephe'));

    const utc = localBirthToUtcParts({
      year,
      month,
      day,
      hour,
      min,
      tzone: timezoneData.tzone
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
    const flagsSwiss = SEFLG_SWIEPH | SEFLG_SPEED;

    const BODY = {
      CHIRON: getConstant('SE_CHIRON', 15),
      MEAN_NODE: getConstant('SE_MEAN_NODE', 10),
      MEAN_LILITH: getConstant('SE_MEAN_APOG', 12)
    };

    const chiron = addHouse(
      calcBody({
        julianDay,
        bodyId: BODY.CHIRON,
        bodyName: 'Chiron',
        flags: flagsSwiss
      }),
      houseCuspsData
    );

    const meanNorthNode = addHouse(
      calcBody({
        julianDay,
        bodyId: BODY.MEAN_NODE,
        bodyName: 'Mean North Node',
        flags: flagsSwiss
      }),
      houseCuspsData
    );

    let meanSouthNode;

    if (meanNorthNode && meanNorthNode.ok) {
      const southFullDegree = normalizeDegree(meanNorthNode.fullDegree + 180);

      meanSouthNode = {
        ok: true,
        body: 'Mean South Node',
        ...degreeToSignData(southFullDegree),
        house: findHouseForDegree(southFullDegree, houseCuspsData),
        motion: meanNorthNode.motion || 'Retrograde'
      };
    } else {
      meanSouthNode = {
        ok: false,
        body: 'Mean South Node',
        error: 'No se pudo calcular porque falló Mean North Node.'
      };
    }

    const meanBlackMoonLilith = addHouse(
      calcBody({
        julianDay,
        bodyId: BODY.MEAN_LILITH,
        bodyName: 'Mean Black Moon Lilith',
        flags: flagsSwiss
      }),
      houseCuspsData
    );

    const partOfFortune = calculatePartOfFortune({
      planetsData,
      houseCuspsData
    });

    const premiumPoints = {
      chiron,
      mean_north_node: meanNorthNode,
      mean_south_node: meanSouthNode,
      mean_black_moon_lilith: meanBlackMoonLilith,
      part_of_fortune: partOfFortune
    };

    const bodies = buildBodiesForAspects({
      planetsData,
      houseCuspsData,
      premiumPoints
    });

    const aspects = calculateAspects(bodies);

    return res.status(200).json({
      ok: true,
      mode: 'premium_aspects',
      message:
        'Aspectos Premium calculados con planetas + puntos premium. Comparar contra Astro-Seek.',
      input: {
        nombre,
        fecha_nacimiento,
        hora_nacimiento: horaNormalizada,
        lugar_nacimiento,
        lugar_resuelto: geo.formatted,
        lat: geo.lat,
        lon: geo.lon,
        tzone: timezoneData.tzone,
        timezoneId: timezoneData.timezoneId,
        timezoneName: timezoneData.timezoneName,
        city: geo.city,
        state: geo.state,
        country: geo.country
      },
      sent_payload: payload,
      julianDay,
      bodies,
      aspects,
      sheet_aspects_rows: buildAspectRows(aspects),
      aspect_settings: {
        included_aspects: [
          'Conjunction',
          'Sextile',
          'Square',
          'Trine',
          'Opposition'
        ],
        orb_rules: {
          point: 4,
          angle: 5,
          luminary: 8,
          personal_or_social: 6,
          transpersonal: 5
        }
      },
      raw: {
        planets: planetsData,
        house_cusps: houseCuspsData,
        premium_points: premiumPoints
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: 'Error en premium-aspects.js',
      details: error.detail || error.message || error
    });
  }
}
