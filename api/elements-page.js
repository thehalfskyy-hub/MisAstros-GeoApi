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

// arco arrancando desde abajo
function describeArcFromBottom(cx, cy, r, percent) {
  const p = clamp(Number(percent) || 0, 0, 100);
  if (p <= 0) return '';

  const startAngle = 180; // abajo
  const sweepAngle = p >= 100 ? 359.99 : (p / 100) * 360;
  const endAngle = startAngle + sweepAngle;

  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = sweepAngle <= 180 ? '0' : '1';

  return [
    'M', start.x, start.y,
    'A', r, r, 0, largeArcFlag, 1, end.x, end.y
  ].join(' ');
}

function roundPercent(value) {
  return Math.round(numberOrDefault(value, 0));
}

const FONT_MAIN = '&quot;Ruwaya Informal&quot;, &quot;Cormorant Garamond&quot;, Georgia, &quot;Times New Roman&quot;, serif';

function elementBlock({ label, percent, color, x, y, symbol }) {
  const cx = x;
  const cy = y + 100;
  const radius = 68; // un poco más grande
  const arc = describeArcFromBottom(cx, cy, radius, percent);
  const display = roundPercent(percent);

  let symbolSvg = '';

  // más separación con respecto al círculo
const symbolTop = y + 205;
const symbolBottom = y + 292;
const lineY = y + 248;
const symbolHalf = 55;
const symbolStroke = 1;

if (symbol === 'fire') {
  symbolSvg = `
    <path d="M ${x - symbolHalf} ${symbolBottom} L ${x} ${symbolTop} L ${x + symbolHalf} ${symbolBottom} Z"
      fill="none" stroke="#111111" stroke-width="${symbolStroke}"
      stroke-linejoin="round" stroke-linecap="round"/>
  `;
}

if (symbol === 'water') {
  symbolSvg = `
    <path d="M ${x - symbolHalf} ${symbolTop} L ${x} ${symbolBottom} L ${x + symbolHalf} ${symbolTop} Z"
      fill="none" stroke="#111111" stroke-width="${symbolStroke}"
      stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${x - symbolHalf - 8}" y1="${lineY}" x2="${x + symbolHalf + 8}" y2="${lineY}"
      stroke="#111111" stroke-width="${symbolStroke}"
      stroke-linecap="round"/>
  `;
}

if (symbol === 'air') {
  symbolSvg = `
    <path d="M ${x - symbolHalf} ${symbolBottom} L ${x} ${symbolTop} L ${x + symbolHalf} ${symbolBottom} Z"
      fill="none" stroke="#111111" stroke-width="${symbolStroke}"
      stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${x - symbolHalf - 8}" y1="${lineY}" x2="${x + symbolHalf + 8}" y2="${lineY}"
      stroke="#111111" stroke-width="${symbolStroke}"
      stroke-linecap="round"/>
  `;
}

if (symbol === 'earth') {
  symbolSvg = `
    <path d="M ${x - symbolHalf} ${symbolTop} L ${x} ${symbolBottom} L ${x + symbolHalf} ${symbolTop} Z"
      fill="none" stroke="#111111" stroke-width="${symbolStroke}"
      stroke-linejoin="round" stroke-linecap="round"/>
  `;
}
  return `
    <g>
      <text x="${x}" y="${y}" text-anchor="middle"
        font-family="${FONT_MAIN}"
        font-size="44" font-style="italic" font-weight="400"
        fill="#7b6380">${label}</text>

      <circle cx="${cx}" cy="${cy}" r="${radius}"
        fill="none" stroke="#bdb5b2" stroke-width="3"/>

      <path d="${arc}"
        fill="none" stroke="${color}" stroke-width="5"
        stroke-linecap="round"/>

      <text x="${cx}" y="${cy + 12}" text-anchor="middle"
        font-family="${FONT_MAIN}"
        font-size="36" font-style="italic" font-weight="400"
        fill="#7b6380">${display}%</text>

      ${symbolSvg}
    </g>
  `;
}

function buildSvg({ fire, water, air, earth }) {
  const width = 794;
  const height = 1123;

  // posiciones con separación uniforme
  const x1 = 120;
  const x2 = 298;
  const x3 = 496;
  const x4 = 674;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="467.72pt" height="660.47pt" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
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

  <text x="397" y="165" text-anchor="middle"
    font-family="${FONT_MAIN}"
    font-size="60" font-style="italic" font-weight="400"
    fill="#7b6380">Balance de elementos</text>

  ${elementBlock({
    label: 'Fuego',
    percent: fire,
    color: '#ff1e1e',
    x: x1,
    y: 285,
    symbol: 'fire'
  })}

  ${elementBlock({
    label: 'Agua',
    percent: water,
    color: '#9484d8',
    x: x2,
    y: 285,
    symbol: 'water'
  })}

  ${elementBlock({
    label: 'Aire',
    percent: air,
    color: '#42c7d9',
    x: x3,
    y: 285,
    symbol: 'air'
  })}

  ${elementBlock({
    label: 'Tierra',
    percent: earth,
    color: '#67bc7a',
    x: x4,
    y: 285,
    symbol: 'earth'
  })}

  <!-- texto con más margen lateral -->
  <text x="397" y="720" text-anchor="middle"
    font-family="${FONT_MAIN}"
    font-size="22" font-style="italic" font-weight="400"
    fill="#7b6380">
    <tspan x="397" dy="0">En astrología, los elementos (Fuego, Tierra, Aire y Agua)</tspan>
    <tspan x="397" dy="38">son fundamentales para entender cómo se manifiestan las</tspan>
    <tspan x="397" dy="38">energías en tu vida. Cada elemento tiene sus</tspan>
    <tspan x="397" dy="38">características únicas y juega un papel crucial en la</tspan>
    <tspan x="397" dy="38">conformación de tu personalidad y comportamiento.</tspan>
    <tspan x="397" dy="38">Vamos a explorar cómo estos elementos influyen en tu</tspan>
    <tspan x="397" dy="38">carta astral y en tu vida.</tspan>
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
