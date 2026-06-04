// api/aspects-page.js
// MIS ASTROS — Página visual SVG de aspectos
// Funciona como wheel-page.js / elements-page.js:
// Make llama este endpoint por HTTP y recibe una hoja SVG lista para subir a Drive.

import sweph from 'sweph';
import path from 'path';

const ALLOWED_ORIGINS = new Set([
  'https://misastros.com',
  'https://www.misastros.com',
  'https://misastrosargentina.com',
  'https://www.misastrosargentina.com',
  'https://jauxxx-v4.myshopify.com',
  'http://localhost:3000',
  'http://localhost:5173'
]);

function setCors(res, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeDegree(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

function formatDegreeInSign(decimalDegree) {
  let degree = Math.floor(Number(decimalDegree) || 0);
  let minutes = Math.round(((Number(decimalDegree) || 0) - degree) * 60);

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

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  if (req.body && typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', chunk => {
      raw += chunk;
    });

    req.on('end', () => {
      if (!raw) return resolve({});

      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });

    req.on('error', reject);
  });
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
    formatted: result.formatted || place
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
    tzone: totalOffsetSeconds / 3600
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
  } catch {
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

function getConstant(name, fallback) {
  return sweph?.constants?.[name] ?? sweph?.[name] ?? fallback;
}

function extractLongitude(result) {
  if (!result) return null;

  if (typeof result.longitude === 'number') return result.longitude;
  if (typeof result.lon === 'number') return result.lon;

  if (Array.isArray(result)) {
    if (typeof result[0] === 'number') return result[0];
    if (Array.isArray(result[0]) && typeof result[0][0] === 'number') return result[0][0];
  }

  if (Array.isArray(result.xx) && typeof result.xx[0] === 'number') return result.xx[0];
  if (Array.isArray(result.data) && typeof result.data[0] === 'number') return result.data[0];

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
  if (Array.isArray(result.data) && typeof result.data[3] === 'number') return result.data[3];
  if (Array.isArray(result.xx) && typeof result.xx[3] === 'number') return result.xx[3];
  if (Array.isArray(result) && typeof result[3] === 'number') return result[3];

  return 0;
}

function motionFromSpeed(speed) {
  return Number(speed) < 0 ? 'Retrograde' : 'Direct';
}

function calcBody({ julianDay, bodyId, bodyName, flags }) {
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
}

function buildHouseCuspsArray(houseCuspsData) {
  const houses = Array.isArray(houseCuspsData?.houses)
    ? houseCuspsData.houses
    : [];

  return houses
    .map(h => ({
      house: Number(h.house),
      degree: normalizeDegree(h.degree),
      sign: h.sign || ''
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
    return null;
  }

  const sunHouse = Number(sun?.house);
  const isDayChart = sunHouse >= 7 && sunHouse <= 12;

  const fortuneFullDegree = isDayChart
    ? normalizeDegree(asc + moonDegree - sunDegree)
    : normalizeDegree(asc + sunDegree - moonDegree);

  return {
    ok: true,
    body: 'Part of Fortune',
    ...degreeToSignData(fortuneFullDegree),
    house: findHouseForDegree(fortuneFullDegree, houseCuspsData),
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

function planetToAspectBody(planet) {
  const name = planet.name;

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

function pointToAspectBody(point, name, type = 'point') {
  if (!point || !point.ok) return null;

  return {
    name,
    type,
    sign: point.sign || '',
    degree: point.degree || '',
    house: point.house || '',
    fullDegree: normalizeDegree(point.fullDegree),
    motion: point.motion || ''
  };
}

function bodyType(name) {
  if (name === 'Sun' || name === 'Moon') return 'luminary';
  if (['Mercury', 'Venus', 'Mars'].includes(name)) return 'personal';
  if (['Jupiter', 'Saturn'].includes(name)) return 'social';
  if (['Uranus', 'Neptune', 'Pluto'].includes(name)) return 'transpersonal';
  if (['Ascendant', 'Midheaven'].includes(name)) return 'angle';
  return 'point';
}

function smallestAngularDistance(a, b) {
  const raw = Math.abs(normalizeDegree(a) - normalizeDegree(b));
  return raw > 180 ? 360 - raw : raw;
}

function orbLimitForBodies(bodyA, bodyB) {
  const types = [bodyA.type, bodyB.type];

  if (types.includes('point')) return 4;
  if (types.includes('angle')) return 5;
  if (types.includes('luminary')) return 8;
  if (types.includes('personal') || types.includes('social')) return 6;

  return 5;
}

function aspectSymbol(aspectName) {
  const map = {
    Conjunction: '☌',
    Sextile: '✶',
    Square: '□',
    Trine: '△',
    Opposition: '☍'
  };

  return map[aspectName] || '';
}

function planetSymbol(name) {
  const map = {
    Sun: '☉',
    Moon: '☽',
    Mercury: '☿',
    Venus: '♀',
    Mars: '♂',
    Jupiter: '♃',
    Saturn: '♄',
    Uranus: '♅',
    Neptune: '♆',
    Pluto: '♇',
    'North Node': '☊',
    Lilith: '⚸',
    Chiron: '⚷',
    'Part of Fortune': '⊗',
    Vertex: 'Vx',
    Ascendant: 'ASC',
    Midheaven: 'MC'
  };

  return map[name] || name;
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

function findAspectBetween(bodyA, bodyB, allowPointAspects = false) {
  if (!allowPointAspects && (bodyA.type === 'point' || bodyB.type === 'point')) {
    return null;
  }

  const ASPECTS = [
    { name: 'Conjunction', angle: 0 },
    { name: 'Sextile', angle: 60 },
    { name: 'Square', angle: 90 },
    { name: 'Trine', angle: 120 },
    { name: 'Opposition', angle: 180 }
  ];

  const separation = smallestAngularDistance(bodyA.fullDegree, bodyB.fullDegree);
  const maxOrb = orbLimitForBodies(bodyA, bodyB);

  for (const aspect of ASPECTS) {
    const orb = Math.abs(separation - aspect.angle);

    if (orb <= maxOrb) {
      return {
        name: aspect.name,
        symbol: aspectSymbol(aspect.name),
        orb,
        orbFormatted: formatOrb(orb),
        nature: aspectNature(aspect.name),
        separation
      };
    }
  }

  return null;
}

function calculateMainAspects(bodies) {
  const aspects = [];

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];

      const aspect = findAspectBetween(a, b, false);
      if (!aspect) continue;

      aspects.push({
        planet_1: a.name,
        aspect: aspect.name,
        planet_2: b.name,
        orb: aspect.orbFormatted,
        orb_decimal: Number(aspect.orb.toFixed(4)),
        nature: aspect.nature
      });
    }
  }

  return aspects.sort((a, b) => a.orb_decimal - b.orb_decimal);
}

function buildMainBodies(planetsData) {
  const order = [
    'Sun',
    'Moon',
    'Mercury',
    'Venus',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
    'Pluto'
  ];

  return order
    .map(name => findPlanet(planetsData, name))
    .filter(Boolean)
    .map(planetToAspectBody);
}

function buildGridBodies({ planetsData, premiumPoints, houseCuspsData }) {
  const bodies = [];

  const planetOrder = [
    'Sun',
    'Moon',
    'Mercury',
    'Venus',
    'Mars',
    'Jupiter',
    'Saturn',
    'Uranus',
    'Neptune',
    'Pluto'
  ];

  for (const name of planetOrder) {
    const planet = findPlanet(planetsData, name);
    if (planet) bodies.push(planetToAspectBody(planet));
  }

  const northNode = pointToAspectBody(premiumPoints.mean_north_node, 'North Node');
  const lilith = pointToAspectBody(premiumPoints.mean_black_moon_lilith, 'Lilith');
  const chiron = pointToAspectBody(premiumPoints.chiron, 'Chiron');
  const fortune = pointToAspectBody(premiumPoints.part_of_fortune, 'Part of Fortune');
  const vertex = pointToAspectBody(premiumPoints.vertex, 'Vertex');

  for (const p of [northNode, lilith, chiron, fortune, vertex]) {
    if (p) bodies.push(p);
  }

  const ascendant = findPlanet(planetsData, 'Ascendant');

  if (ascendant) {
    bodies.push({
      name: 'Ascendant',
      type: 'angle',
      sign: ascendant.sign || '',
      degree: formatDegreeInSign(Number(ascendant.normDegree) || 0),
      house: ascendant.house || 1,
      fullDegree: normalizeDegree(ascendant.fullDegree),
      motion: ''
    });
  }

  const mcDegree = normalizeDegree(houseCuspsData?.midheaven);

  bodies.push({
    name: 'Midheaven',
    type: 'angle',
    ...degreeToSignData(mcDegree),
    house: findHouseForDegree(mcDegree, houseCuspsData),
    motion: ''
  });

  return bodies.filter(b => b && Number.isFinite(Number(b.fullDegree)));
}

function buildAspectGridRows(bodies) {
  const rows = [];

  for (let i = 0; i < bodies.length; i++) {
    const row = [];

    for (let j = 0; j < bodies.length; j++) {
      if (j > i) {
        row.push('');
        continue;
      }

      if (i === j) {
        row.push(planetSymbol(bodies[i].name));
        continue;
      }

      const aspect = findAspectBetween(bodies[i], bodies[j], true);
      row.push(aspect ? aspect.symbol : '');
    }

    rows.push(row);
  }

  return rows;
}

function getAspectColor(symbol) {
  if (symbol === '△' || symbol === '✶') return '#3f63c8';
  if (symbol === '□' || symbol === '☍') return '#b85c5c';
  if (symbol === '☌') return '#5d5a5a';
  return '#8b8585';
}

function renderAspectTable(aspects) {
  const startX = 150;
  const startY = 118;
  const rowH = 27;

  const headers = [
    { x: startX, label: 'Planet' },
    { x: startX + 135, label: 'Aspect' },
    { x: startX + 315, label: 'Planet' },
    { x: startX + 475, label: 'Orb' }
  ];

  const rows = aspects.slice(0, 16);

  return `
    <g>
      ${headers.map(h => `
        <text x="${h.x}" y="${startY}" font-size="20" font-weight="700" fill="#1f1d1d">${esc(h.label)}</text>
      `).join('')}

      ${rows.map((a, i) => {
        const y = startY + 34 + i * rowH;
        const sym = aspectSymbol(a.aspect);
        const color = getAspectColor(sym);

        return `
          <g>
            <text x="${startX}" y="${y}" font-size="17" fill="#272424">${esc(a.planet_1)}</text>

            <text x="${startX + 135}" y="${y}" font-size="18" fill="${color}" font-weight="700">${esc(sym)}</text>
            <text x="${startX + 162}" y="${y}" font-size="17" fill="#e67800" font-weight="700">${esc(a.aspect)}</text>

            <text x="${startX + 315}" y="${y}" font-size="17" fill="#272424">${esc(a.planet_2)}</text>
            <text x="${startX + 475}" y="${y}" font-size="17" fill="#272424">${esc(a.orb)}</text>
          </g>
        `;
      }).join('')}
    </g>
  `;
}


function renderGrid(gridRows) {
  const cell = 24;
  const gridWidth = gridRows.length * cell;
  const gridHeight = gridRows.length * cell;
  const startX = (794 - gridWidth) / 2;
  const startY = 565;

  const panelPadX = 22;
  const panelPadY = 18;

  let out = `
    <g>
      <rect
        x="${startX - panelPadX}"
        y="${startY - panelPadY}"
        width="${gridWidth + panelPadX * 2}"
        height="${gridHeight + panelPadY * 2}"
        rx="18"
        ry="18"
        fill="#fbf6f3"
        stroke="#ded3cd"
        stroke-width="1.2"
      />
  `;

  for (let i = 0; i < gridRows.length; i++) {
    for (let j = 0; j <= i; j++) {
      const value = gridRows[i][j] || '';
      const x = startX + j * cell;
      const y = startY + i * cell;
      const isDiag = i === j;

      out += `
        <rect
          x="${x}"
          y="${y}"
          width="${cell}"
          height="${cell}"
          rx="2"
          ry="2"
          fill="${isDiag ? '#f4eeea' : '#fffaf8'}"
          stroke="#cfc6c1"
          stroke-width="1"
        />
      `;

      if (value) {
        out += `
          <text
            x="${x + cell / 2}"
            y="${y + 16}"
            text-anchor="middle"
            font-size="${String(value).length > 1 ? 9.5 : 15}"
            font-weight="${isDiag ? '700' : '500'}"
            fill="${isDiag ? '#4b4646' : getAspectColor(value)}"
          >${esc(value)}</text>
        `;
      }
    }
  }

  out += `</g>`;

  return out;
}


function buildSvg({ aspects, gridRows }) {
  const width = 794;
  const height = 1123;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="395pt" height="558pt" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f7eee9"/>

  <g opacity="0.28" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 42 }).map((_, i) => {
      const x = 705 + i * 3;
      return `<path d="M ${x} -80 C ${x - 70} 120, ${x + 35} 260, ${x - 35} 430 C ${x - 95} 620, ${x + 30} 850, ${x - 10} 1160"/>`;
    }).join('\n')}
  </g>

  <g opacity="0.23" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 42 }).map((_, i) => {
      const y = 1045 + i * 5;
      return `<path d="M -90 ${y} C 100 ${y - 85}, 260 ${y + 80}, 520 ${y - 10} S 700 ${y - 45}, 850 ${y + 5}"/>`;
    }).join('\n')}
  </g>

  <text x="397" y="70"
    text-anchor="middle"
    font-family="Georgia, 'Times New Roman', serif"
    font-size="26"
    font-weight="700"
    fill="#312b2d">Main aspects</text>

  <g font-family="Arial, Helvetica, sans-serif">
    ${renderAspectTable(aspects)}
  </g>



  <g font-family="Arial, Helvetica, sans-serif">
    ${renderGrid(gridRows)}
  </g>
</svg>`;
}

export default async function handler(req, res) {
  try {
    const origin = req.headers.origin || '';
    setCors(res, origin);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    let body = {};

    if (req.method === 'POST') {
      body = await parseBody(req);
    } else if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    }

    const source = req.method === 'GET' ? req.query || {} : body;

    const trelloData = source.trello_text
      ? extractFromTrelloText(source.trello_text)
      : {};

    const fecha_nacimiento = source.fecha_nacimiento || trelloData.fecha_nacimiento || '';
    const hora_nacimiento = source.hora_nacimiento || trelloData.hora_nacimiento || '';
    const lugar_nacimiento = source.lugar_nacimiento || trelloData.lugar_nacimiento || '';

    if (!fecha_nacimiento || !hora_nacimiento || !lugar_nacimiento) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({
        ok: false,
        error: 'Faltan datos.',
        required: ['fecha_nacimiento', 'hora_nacimiento', 'lugar_nacimiento'],
        received: { fecha_nacimiento, hora_nacimiento, lugar_nacimiento }
      }, null, 2));
    }

    const [year, month, day] = String(fecha_nacimiento).split('-').map(Number);
    const horaNormalizada = String(hora_nacimiento).trim().replace('.', ':');
    const [hour, min] = horaNormalizada.split(':').map(Number);

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

    const vertexDegree = normalizeDegree(houseCuspsData?.vertex);

    const vertex = {
      ok: true,
      body: 'Vertex',
      ...degreeToSignData(vertexDegree),
      house: findHouseForDegree(vertexDegree, houseCuspsData),
      motion: ''
    };

    const premiumPoints = {
      chiron,
      mean_north_node: meanNorthNode,
      mean_black_moon_lilith: meanBlackMoonLilith,
      part_of_fortune: partOfFortune,
      vertex
    };

    const mainBodies = buildMainBodies(planetsData);
    const aspects = calculateMainAspects(mainBodies);

    const gridBodies = buildGridBodies({
      planetsData,
      premiumPoints,
      houseCuspsData
    });

    const gridRows = buildAspectGridRows(gridBodies);

    const svg = buildSvg({
      aspects,
      gridRows
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline; filename="aspects-page.svg"');
    return res.end(svg);
  } catch (error) {
    res.statusCode = error.status || 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({
      ok: false,
      error: 'Error generating aspects page',
      details: error.detail || error.message || error
    }, null, 2));
  }
}
