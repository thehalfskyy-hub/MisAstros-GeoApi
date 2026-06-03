// api/elements-page.js
// Genera una página SVG automática con los porcentajes de elementos.

function numberOrDefault(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function polarToCartesian(cx, cy, r, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;

  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians)
  };
}

function describeArc(cx, cy, r, percent) {
  const p = clamp(Number(percent) || 0, 0, 100);

  if (p <= 0) return '';

  const endAngle = p >= 100 ? 359.99 : (p / 100) * 360;
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, 0);
  const largeArcFlag = endAngle <= 180 ? '0' : '1';

  return [
    'M',
    start.x,
    start.y,
    'A',
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y
  ].join(' ');
}

function roundPercent(value) {
  return Math.round(numberOrDefault(value, 0));
}

function elementBlock({ label, percent, color, x, y, symbol }) {
  const cx = x;
  const cy = y + 100;
  const radius = 54;
  const arc = describeArc(cx, cy, radius, percent);
  const display = roundPercent(percent);

  let symbolSvg = '';

  if (symbol === 'fire') {
    symbolSvg = `
      <path d="M ${x - 48} ${y + 230} L ${x} ${y + 150} L ${x + 48} ${y + 230} Z"
        fill="none" stroke="#111111" stroke-width="3"/>
    `;
  }

  if (symbol === 'water') {
    symbolSvg = `
      <path d="M ${x - 48} ${y + 150} L ${x} ${y + 230} L ${x + 48} ${y + 150} Z"
        fill="none" stroke="#111111" stroke-width="3"/>
      <line x1="${x - 55}" y1="${y + 188}" x2="${x + 55}" y2="${y + 188}"
        stroke="#111111" stroke-width="3"/>
    `;
  }

  if (symbol === 'air') {
    symbolSvg = `
      <path d="M ${x - 48} ${y + 230} L ${x} ${y + 150} L ${x + 48} ${y + 230} Z"
        fill="none" stroke="#111111" stroke-width="3"/>
      <line x1="${x - 55}" y1="${y + 188}" x2="${x + 55}" y2="${y + 188}"
        stroke="#111111" stroke-width="3"/>
    `;
  }

  if (symbol === 'earth') {
    symbolSvg = `
      <path d="M ${x - 48} ${y + 150} L ${x} ${y + 230} L ${x + 48} ${y + 150} Z"
        fill="none" stroke="#111111" stroke-width="3"/>
    `;
  }

  return `
    <g>
      <text x="${x}" y="${y}" text-anchor="middle"
        font-family="Georgia, serif" font-size="42" font-style="italic"
        fill="#7b6380">${label}</text>

      <circle cx="${cx}" cy="${cy}" r="${radius}"
        fill="none" stroke="#c9c1bd" stroke-width="4"/>

      <path d="${arc}"
        fill="none" stroke="${color}" stroke-width="7"
        stroke-linecap="round"/>

      <text x="${cx}" y="${cy + 12}" text-anchor="middle"
        font-family="Georgia, serif" font-size="38" font-style="italic"
        fill="#7b6380">${display}%</text>

      ${symbolSvg}
    </g>
  `;
}

function buildSvg({ fire, water, air, earth }) {
  const width = 794;
  const height = 1123;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f7eee9"/>

  <!-- ondas decorativas superiores -->
  <g opacity="0.35" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 34 }).map((_, i) => {
      const y = -40 + i * 4;
      return `<path d="M -80 ${y} C 120 ${y + 80}, 250 ${y - 80}, 440 ${y + 20} S 760 ${y + 80}, 900 ${y - 20}"/>`;
    }).join('\n')}
  </g>

  <!-- ondas decorativas inferiores -->
  <g opacity="0.22" fill="none" stroke="#7b6380" stroke-width="1">
    ${Array.from({ length: 36 }).map((_, i) => {
      const y = 1030 + i * 5;
      return `<path d="M -60 ${y} C 120 ${y - 70}, 260 ${y + 70}, 440 ${y - 20} S 710 ${y - 70}, 870 ${y + 10}"/>`;
    }).join('\n')}
  </g>

  <text x="397" y="175" text-anchor="middle"
    font-family="Georgia, serif" font-size="58" font-style="italic"
    fill="#7b6380">Balance de elementos</text>

  ${elementBlock({
    label: 'Fuego',
    percent: fire,
    color: '#ff1e1e',
    x: 110,
    y: 285,
    symbol: 'fire'
  })}

  ${elementBlock({
    label: 'Agua',
    percent: water,
    color: '#9484d8',
    x: 278,
    y: 285,
    symbol: 'water'
  })}

  ${elementBlock({
    label: 'Aire',
    percent: air,
    color: '#42c7d9',
    x: 484,
    y: 285,
    symbol: 'air'
  })}

  ${elementBlock({
    label: 'Tierra',
    percent: earth,
    color: '#67bc7a',
    x: 652,
    y: 285,
    symbol: 'earth'
  })}

  <text x="397" y="735" text-anchor="middle"
    font-family="Georgia, serif" font-size="25" font-style="italic"
    fill="#7b6380">
    <tspan x="397" dy="0">En astrología, los elementos (Fuego, Tierra, Aire y Agua) son</tspan>
    <tspan x="397" dy="44">fundamentales para entender cómo se manifiestan las energías en</tspan>
    <tspan x="397" dy="44">tu vida. Cada elemento tiene sus características únicas y juega un</tspan>
    <tspan x="397" dy="44">papel crucial en la conformación de tu personalidad y</tspan>
    <tspan x="397" dy="44">comportamiento. Vamos a explorar cómo estos elementos influyen</tspan>
    <tspan x="397" dy="44">en tu carta astral y en tu vida.</tspan>
  </text>
</svg>`;
}

module.exports = async (req, res) => {
  try {
    let fire = 0;
    let water = 0;
    let air = 0;
    let earth = 0;

    if (req.method === 'GET') {
      fire = numberOrDefault(req.query.fire);
      water = numberOrDefault(req.query.water);
      air = numberOrDefault(req.query.air);
      earth = numberOrDefault(req.query.earth);
    } else if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      fire = numberOrDefault(body.fire);
      water = numberOrDefault(body.water);
      air = numberOrDefault(body.air);
      earth = numberOrDefault(body.earth);
    } else if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    } else {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
    }

    const svg = buildSvg({ fire, water, air, earth });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline; filename="elements-page.svg"');
    return res.end(svg);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({
      ok: false,
      error: error.message || 'Error generating elements page'
    }));
  }
};
