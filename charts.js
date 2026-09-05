/* ===================================================================
 * charts.js — 零依赖 SVG 图表（趋势柱图 / 环形）
 * 手写 SVG，克制留白，跟随设计系统配色。
 * =================================================================== */

/** 近 N 日双系列柱状图（存证 sage / 证据 clay） */
export function svgBarChart(series, { h = 210, compact = false } = {}) {
  const n = series.length;
  const padL = 30, padB = 22, padT = 10, padR = 6;
  const w = compact ? 520 : 760;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const max = Math.max(1, ...series.map((d) => Math.max(d.works, d.evidence)));
  const niceMax = Math.ceil(max / 2) * 2;
  const step = plotW / n;
  const bw = Math.min(10, (step - 6) / 2);

  const gridLines = [];
  for (let g = 0; g <= 3; g++) {
    const y = padT + plotH - (plotH * g) / 3;
    gridLines.push(`<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#EFEBE3" stroke-width="1"/>`);
    gridLines.push(`<text x="${padL - 5}" y="${y + 3}" text-anchor="end" font-size="9" fill="#9A938A">${Math.round((niceMax * g) / 3)}</text>`);
  }

  const bars = [];
  series.forEach((d, i) => {
    const cx = padL + step * i + step / 2;
    const hw = Math.max(2, (d.works / niceMax) * plotH);
    const he = Math.max(2, (d.evidence / niceMax) * plotH);
    if (d.works > 0) {
      bars.push(`<rect x="${cx - bw - 1.5}" y="${padT + plotH - hw}" width="${bw}" height="${hw}" rx="2" fill="#3F6053"><title>${d.label} 存证 ${d.works}</title></rect>`);
    }
    if (d.evidence > 0) {
      bars.push(`<rect x="${cx + 1.5}" y="${padT + plotH - he}" width="${bw}" height="${he}" rx="2" fill="#A85640" opacity=".85"><title>${d.label} 证据 ${d.evidence}</title></rect>`);
    }
    if (i % 2 === 0 || n <= 8) {
      bars.push(`<text x="${cx}" y="${h - 7}" text-anchor="middle" font-size="9" fill="#9A938A">${d.label}</text>`);
    }
  });

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto" role="img" aria-label="近14日趋势">
    ${gridLines.join('')}
    ${bars.join('')}
  </svg>`;
}

/** 环形进度 */
export function svgRing(percent, { size = 76, stroke = 7, color = '#3F6053', track = '#EFEBE3', sub } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return `
  <div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/>
    </svg>
    <div class="ring-txt">${Math.round(p)}${sub || '%'}</div>
  </div>`;
}

/** 迷你横向差异条 */
export function miniBars(sim, color) {
  return `<div class="sim-bar ${color ? 'clay' : ''}" style="flex:1 1 120px"><i style="width:${Math.max(1, Math.min(100, sim))}%"></i></div>`;
}
