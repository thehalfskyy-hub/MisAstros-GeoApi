// api/premium-excel.js
// Endpoint de prueba para Carta Natal Premium.
// Objetivo: ver qué datos reales devuelve AstrologyAPI antes de armar el Excel final.
// NO reemplaza data-excel.js y NO rompe la carta natal normal.

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
      return res.status(405).json({
        ok: false,
        error: 'Method not allowed. Usá GET o POST.'
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
        tipo_producto_interno: getValue('Tipo de producto interno'),
        nombre: getValue('Nombre'),
        fecha_nacimiento: getValue('Fecha de nacimiento'),
        hora_nacimiento: getValue('Hora de nacimiento'),
        lugar_nacimiento: getValue('Lugar de nacimiento')
      };
    }

    const source = req.method === 'GET' ? req.query : (req.body || {});

    const trelloData = source.trello_text
      ? extractFromTrelloText(source.trello_text)
      : {};

    const nombre = source.nombre || trelloData.nombre;
    const fecha_nacimiento = source.fecha_nacimiento || trelloData.fecha_nacimiento;
    const hora_nacimiento = source.hora_nacimiento || trelloData.hora_nacimiento;
    const lugar_nacimiento = source.lugar_nacimiento || trelloData.lugar_nacimiento;
    const tipo_producto_interno =
      source.tipo_producto_interno ||
      trelloData.tipo_producto_interno ||
      'carta_natal_premium';

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
          tipo_producto_interno,
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

    let geo;
    let timezoneData;

    try {
      geo = await ocGeocode(lugar_nacimiento);

      timezoneData = await googleTimeZoneForBirth(
        geo.lat,
        geo.lon,
        year,
        month,
        day,
        hour,
        min
      );
    } catch (error) {
      return res.status(error.status || 400).json({
        ok: false,
        error: 'Error resolviendo lugar o zona horaria.',
        lugar_nacimiento,
        details: error.detail || error.message || error
      });
    }

    const location = {
      lat: geo.lat,
      lon: geo.lon,
      tzone: timezoneData.tzone,
      formatted: geo.formatted,
      city: geo.city,
      state: geo.state,
      country: geo.country,
      timezoneId: timezoneData.timezoneId,
      timezoneName: timezoneData.timezoneName
    };

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

      const text = await response.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = text;
      }

      if (!response.ok) {
        return {
          ok: false,
          endpoint,
          status: response.status,
          data
        };
      }

      return {
        ok: true,
        endpoint,
        status: response.status,
        data
      };
    }

    const [
      planetsResponse,
      houseCuspsResponse,
      westernChartResponse
    ] = await Promise.all([
      callAstrologyApi('planets/tropical'),
      callAstrologyApi('house_cusps/tropical'),
      callAstrologyApi('western_chart_data')
    ]);

    function listTopLevelKeys(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
      return Object.keys(obj);
    }

    function listBodyNamesFromArray(arr) {
      if (!Array.isArray(arr)) return [];

      return arr
        .map(item => item?.name || item?.planet || item?.body || item?.label || '')
        .filter(Boolean);
    }

    function findPossibleArrays(obj, path = '') {
      const found = [];

      if (!obj || typeof obj !== 'object') return found;

      if (Array.isArray(obj)) {
        found.push({
          path: path || 'root',
          length: obj.length,
          sample_keys:
            obj[0] && typeof obj[0] === 'object'
              ? Object.keys(obj[0])
              : [],
          possible_names: listBodyNamesFromArray(obj).slice(0, 40)
        });

        return found;
      }

      for (const key of Object.keys(obj)) {
        const value = obj[key];
        const nextPath = path ? `${path}.${key}` : key;

        if (Array.isArray(value)) {
          found.push({
            path: nextPath,
            length: value.length,
            sample_keys:
              value[0] && typeof value[0] === 'object'
                ? Object.keys(value[0])
                : [],
            possible_names: listBodyNamesFromArray(value).slice(0, 40)
          });
        } else if (value && typeof value === 'object') {
          found.push(...findPossibleArrays(value, nextPath));
        }
      }

      return found;
    }

    function extractAspectLikeArrays(obj) {
      const arrays = findPossibleArrays(obj);

      return arrays.filter(item => {
        const path = String(item.path || '').toLowerCase();
        const keys = item.sample_keys.map(k => String(k).toLowerCase());

        return (
          path.includes('aspect') ||
          keys.includes('aspect') ||
          keys.includes('aspect_name') ||
          keys.includes('orb') ||
          keys.includes('planet_one') ||
          keys.includes('planet_two') ||
          keys.includes('planet1') ||
          keys.includes('planet2')
        );
      });
    }

    function extractPremiumBodyHints(obj) {
      const wantedWords = [
        'chiron',
        'quiron',
        'lilith',
        'fortune',
        'fortuna',
        'vertex',
        'midheaven',
        'mc',
        'rahu',
        'ketu',
        'node',
        'nodo'
      ];

      const arrays = findPossibleArrays(obj);
      const matches = [];

      for (const arrInfo of arrays) {
        for (const name of arrInfo.possible_names || []) {
          const low = String(name).toLowerCase();

          if (wantedWords.some(word => low.includes(word))) {
            matches.push({
              path: arrInfo.path,
              name
            });
          }
        }
      }

      return matches;
    }

    const debug = {
      planets: {
        ok: planetsResponse.ok,
        status: planetsResponse.status,
        top_level_keys: listTopLevelKeys(planetsResponse.data),
        arrays: findPossibleArrays(planetsResponse.data),
        premium_body_hints: extractPremiumBodyHints(planetsResponse.data)
      },
      house_cusps: {
        ok: houseCuspsResponse.ok,
        status: houseCuspsResponse.status,
        top_level_keys: listTopLevelKeys(houseCuspsResponse.data),
        arrays: findPossibleArrays(houseCuspsResponse.data),
        premium_body_hints: extractPremiumBodyHints(houseCuspsResponse.data)
      },
      western_chart_data: {
        ok: westernChartResponse.ok,
        status: westernChartResponse.status,
        top_level_keys: listTopLevelKeys(westernChartResponse.data),
        arrays: findPossibleArrays(westernChartResponse.data),
        aspect_like_arrays: extractAspectLikeArrays(westernChartResponse.data),
        premium_body_hints: extractPremiumBodyHints(westernChartResponse.data)
      }
    };

    return res.status(200).json({
      ok: true,
      mode: 'premium_test',
      message:
        'Este endpoint es solo para probar qué datos trae AstrologyAPI para Carta Natal Premium.',
      input: {
        tipo_producto_interno,
        nombre,
        fecha_nacimiento,
        hora_nacimiento: horaNormalizada,
        lugar_nacimiento,
        lugar_resuelto: location.formatted,
        lat: location.lat,
        lon: location.lon,
        tzone: location.tzone,
        timezoneId: location.timezoneId,
        timezoneName: location.timezoneName,
        city: location.city,
        state: location.state,
        country: location.country
      },
      sent_payload: payload,
      debug,
      raw: {
        planets_tropical: planetsResponse,
        house_cusps_tropical: houseCuspsResponse,
        western_chart_data: westernChartResponse
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      error: 'Error en premium-excel.js',
      details: error.detail || error.message || error
    });
  }
}
