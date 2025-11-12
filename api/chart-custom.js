// ——— Inyecta 12 divisores blancos en el aro externo (alineados a los límites de signo)
function injectWhiteDividers(svgText) {
  const vb = /viewBox="\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*"/i.exec(svgText);
  let x = 0, y = 0, w = 500, h = 500;
  if (vb) {
    x = parseFloat(vb[1]); y = parseFloat(vb[2]);
    w = parseFloat(vb[3]); h = parseFloat(vb[4]);
  } else {
    const mW = /width="([\d.]+)"/i.exec(svgText);
    const mH = /height="([\d.]+)"/i.exec(svgText);
    if (mW) w = parseFloat(mW[1]);
    if (mH) h = parseFloat(mH[1]);
  }

  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = Math.min(w, h) / 2;

  // radios dentro del aro exterior negro
  const r1 = half * 0.82;
  const r2 = half * 0.96;

  // 👉 Desfase para alinear exactamente con las fronteras de signo
  //    Si lo ves 1/2 sector corrido, probá +15 o -15. Aquí uso -15 que suele coincidir.
  const SHIFT_DEG = +21;

  const lines = [];
  for (let i = 0; i < 12; i++) {
    // antes: const ang = (-90 + i * 30) * Math.PI / 180;
    const ang = (-90 + SHIFT_DEG + i * 30) * Math.PI / 180;
    const x1 = cx + r1 * Math.cos(ang);
    const y1 = cy + r1 * Math.sin(ang);
    const x2 = cx + r2 * Math.cos(ang);
    const y2 = cy + r2 * Math.sin(ang);
    lines.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />`
    );
  }

  const group =
    `<g id="mis-divisores-blancos" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round">${lines.join("")}</g>`;

  return svgText.replace(/<\/svg>\s*$/i, `${group}\n</svg>`);
}
