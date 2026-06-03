// api/wheel-page.js

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_MAIN = 'Georgia, "Times New Roman", serif';

function degreeWithMotion(degree, motion) {
  if (!degree) return '';
  return motion === 'Retrograde' ? `${degree} R` : degree;
}

function lineItem({ xLabel, xDeg, y, symbol, label, sign, degree, motion }) {
  const textLeft = `${symbol} ${label} in ${sign}`;
  const textRight = degreeWithMotion(degree, motion);

  return `
    <line x1="${xLabel}" y1="${y + 16}" x2="${xDeg + 28}" y2="${y + 16}"
      stroke="#e4d9d3" stroke-width="1"/>

    <text x="${xLabel}" y="${y}" 
      font-family="${FONT_MAIN}"
      font-size="21" font-weight="400"
      fill="#5d5652">${esc(textLeft)}</text>

    <text x="${xDeg}" y="${y}" 
      font-family="${FONT_MAIN}"
      font-size="18" font-weight="400"
      fill="#9b918b">${esc(textRight)}</text>
  `;
}

function buildSvg(query) {
  const wheelUrl = query.wheel_url || '';
  const proxiedWheelUrl =
    'https://mis-astros-geo-api.vercel.app/api/chart-proxy?u=' +
    encodeURIComponent(wheelUrl);

  const width = 794;
  const height = 1123;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f7eee9"/>

  <!-- ondas decorativas derecha -->
  <g opacity="0.38" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 34 }).map((_, i) => {
      const x = 720 + i * 3;
      return `<path d="M ${x} -40 C ${x - 50} 130, ${x + 40} 260, ${x - 10} 430 C ${x - 60} 630, ${x + 30} 840, ${x - 5} 1120"/>`;
    }).join('\n')}
  </g>

  <!-- ondas decorativas abajo izquierda -->
  <g opacity="0.22" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 30 }).map((_, i) => {
      const y = 1010 + i * 5;
      return `<path d="M -20 ${y} C 120 ${y - 70}, 250 ${y + 70}, 420 ${y - 10}"/>`;
    }).join('\n')}
  </g>

  <!-- imagen rueda -->
  <image href="${esc(proxiedWheelUrl)}"
    x="95" y="45" width="600" height="600"
    preserveAspectRatio="xMidYMid meet"/>

  <!-- columna izquierda -->
  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 720,
    symbol: '☉',
    label: 'Sun',
    sign: query.sun_sign || '',
    degree: query.sun_degree || '',
    motion: query.sun_motion || ''
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 775,
    symbol: '☽',
    label: 'Moon',
    sign: query.moon_sign || '',
    degree: query.moon_degree || '',
    motion: query.moon_motion || ''
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 830,
    symbol: '☿',
    label: 'Mercury',
    sign: query.mercury_sign || '',
    degree: query.mercury_degree || '',
    motion: query.mercury_motion || ''
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 885,
    symbol: '♀',
    label: 'Venus',
    sign: query.venus_sign || '',
    degree: query.venus_degree || '',
    motion: query.venus_motion || ''
  })}

  ${lineItem({
    xLabel: 85,
    xDeg: 300,
    y: 940,
    symbol: '♂',
    label: 'Mars',
    sign: query.mars_sign || '',
    degree: query.mars_degree || '',
    motion: query.mars_motion || ''
  })}

  <!-- columna derecha -->
  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 720,
    symbol: '♃',
    label: 'Jupiter',
    sign: query.jupiter_sign || '',
    degree: query.jupiter_degree || '',
    motion: query.jupiter_motion || ''
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 775,
    symbol: '♄',
    label: 'Saturn',
    sign: query.saturn_sign || '',
    degree: query.saturn_degree || '',
    motion: query.saturn_motion || ''
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 830,
    symbol: '♅',
    label: 'Uranus',
    sign: query.uranus_sign || '',
    degree: query.uranus_degree || '',
    motion: query.uranus_motion || ''
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 885,
    symbol: '♆',
    label: 'Neptune',
    sign: query.neptune_sign || '',
    degree: query.neptune_degree || '',
    motion: query.neptune_motion || ''
  })}

  ${lineItem({
    xLabel: 410,
    xDeg: 680,
    y: 940,
    symbol: '♇',
    label: 'Pluto',
    sign: query.pluto_sign || '',
    degree: query.pluto_degree || '',
    motion: query.pluto_motion || ''
  })}

  <!-- ascendente -->
  <line x1="260" y1="1006" x2="535" y2="1006"
    stroke="#e4d9d3" stroke-width="1"/>

  <text x="240" y="990"
    font-family="${FONT_MAIN}"
    font-size="17" font-weight="400"
    fill="#5d5652">Asc</text>

  <text x="280" y="990"
    font-family="${FONT_MAIN}"
    font-size="23" font-weight="600"
    fill="#5d5652">${esc(`Ascendant in ${query.asc_sign || ''}`)}</text>

  <text x="540" y="990"
    font-family="${FONT_MAIN}"
    font-size="18" font-weight="400"
    fill="#9b918b">${esc(query.asc_degree || '')}</text>
</svg>`;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    }

    const svg = buildSvg(req.query || {});

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline; filename="wheel-page.svg"');
    return res.end(svg);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({
      ok: false,
      error: error.message || 'Error generating wheel page'
    }));
  }
};
