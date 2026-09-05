/* ===================================================================
 * art.js — 确定性程序化「AI 作品」生成器（Canvas）
 * 用途：1) 初始化演示数据时构造种子作品 2) 侵权检测页「一键示例」
 * 纯演示工具：生成柔和几何渐变抽象画；同一 seed 永远得到同一画面，
 * 便于现场复现「原作 vs 疑似侵权变体」。
 * =================================================================== */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 克制调色：鼠尾草绿系 × 暖纸色系，附陶土点缀 */
const PALETTES = [
  { bg: '#F2EFE7', tones: ['#3F6053', '#8AA08C', '#C9B8A2', '#6E685F'], accent: '#A85640' },
  { bg: '#EAEFE9', tones: ['#32503F', '#5F7A6C', '#D9CDBB', '#9A938A'], accent: '#B4654C' },
  { bg: '#F1EEE6', tones: ['#6E685F', '#A0AC9F', '#E0D6C6', '#3F6053'], accent: '#8C4431' },
  { bg: '#EDF0E9', tones: ['#3F6053', '#C6BFAF', '#7E8B8C', '#E3E0D3'], accent: '#A85640' },
];

/**
 * 生成确定性抽象「作品」
 * @returns {string} image/jpeg dataURL
 */
export function generateArtwork({ seed = 1, w = 560, h = 560, palette = 0, complexity = 1 }) {
  const rand = mulberry32(seed * 2654435761 + palette * 7919);
  const P = PALETTES[palette % PALETTES.length];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // 纸面底
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, w, h);

  // 大块柔和渐变（透明度层叠）
  const layers = 6 + Math.floor(rand() * 5 * complexity);
  for (let i = 0; i < layers; i++) {
    const col = P.tones[Math.floor(rand() * P.tones.length)];
    const x = rand() * w, y = rand() * h;
    const r = (0.3 + rand() * 0.7) * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexA(col, 0.16 + rand() * 0.2));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 几何线簇（圆头细线，克制的韵律）
  const strokes = 6 + Math.floor(rand() * 10);
  ctx.lineCap = 'round';
  for (let i = 0; i < strokes; i++) {
    ctx.save();
    ctx.translate(w / 2 + (rand() - 0.5) * w * 0.2, h / 2 + (rand() - 0.5) * h * 0.2);
    ctx.rotate((rand() - 0.5) * 1.4);
    const col = rand() < 0.72 ? P.tones[Math.floor(rand() * P.tones.length)] : P.accent;
    ctx.strokeStyle = hexA(col, 0.5 + rand() * 0.4);
    ctx.lineWidth = 0.8 + rand() * 1.6;
    const len = (0.4 + rand() * 0.7) * Math.min(w, h);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.bezierCurveTo(-len / 6, -len * 0.1, len / 6, len * 0.08, len / 2, -len * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  // 少量细圆环
  const rings = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < rings; i++) {
    ctx.strokeStyle = hexA(P.accent, 0.25 + rand() * 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const r = (0.08 + rand() * 0.3) * Math.min(w, h);
    ctx.arc(w / 2 + (rand() - 0.5) * w * 0.5, h / 2 + (rand() - 0.5) * h * 0.5, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 微弱噪点
  if (complexity > 0.4) {
    const grain = 900;
    for (let i = 0; i < grain; i++) {
      ctx.fillStyle = 'rgba(26,25,24,' + (0.02 + rand() * 0.05).toFixed(3) + ')';
      ctx.fillRect(rand() * w, rand() * h, 1.2, 1.2);
    }
  }
  return c.toDataURL('image/jpeg', 0.88);
}

/* ---------- 变体生成（疑似侵权 / 二次创作） ---------- */

/** 对原作生成各类「疑似侵权变体」，用于检测演示 */
export async function variantOf(src, kind = 'reencode') {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');

  if (kind === 'crop') { // 中心裁切后放大（二次构图搬运）
    const s = 0.82;
    c.width = Math.round(W * s); c.height = Math.round(H * s);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, (W - c.width) / 2, (H - c.height) / 2, c.width, c.height, 0, 0, c.width, c.height);
  } else if (kind === 'text') { // 加水印/标题栏后搬运
    c.width = W; c.height = H;
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(246,244,240,.86)';
    ctx.fillRect(0, H - 42, W, 42);
    ctx.fillStyle = '#3F6053';
    ctx.font = '600 17px sans-serif';
    ctx.fillText('每日AI灵感 · @trend_pick', 16, H - 14);
  } else if (kind === 'bright') { // 调色（亮度/对比度）
    c.width = W; c.height = H;
    ctx.filter = 'brightness(1.14) contrast(1.08) saturate(0.94)';
    ctx.drawImage(img, 0, 0);
  } else { // reencode: 转码压缩（默认）
    c.width = W; c.height = H;
    ctx.drawImage(img, 0, 0);
  }
  const type = kind === 'text' ? 'image/png' : 'image/jpeg';
  const q = kind === 'reencode' ? 0.55 : 0.86;
  return c.toDataURL(type, q);
}

/** 生成「取证截图」画面：把任意 DOM 元素绘制到画布（用于证据截图） */
export function elementToCanvas(el, { w = 760, pad = 20 } = {}) {
  return new Promise((res) => {
    const scale = w / el.offsetWidth || 2;
    const W = Math.round(el.offsetWidth * scale) || w;
    const H = Math.round((el.offsetHeight + pad * 2) * scale) || Math.round(w * 0.75);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#F6F4F0';
    ctx.fillRect(0, 0, W, H);
    // 简单克隆渲染：foreignObject
    const clone = el.cloneNode(true);
    clone.style.transform = `scale(${scale})`;
    clone.style.transformOrigin = 'top left';
    clone.style.position = 'absolute';
    clone.style.left = '0'; clone.style.top = String(pad) + 'px';
    clone.style.width = el.offsetWidth + 'px';
    clone.style.margin = '0';
    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-10000px';
    holder.style.top = '0';
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const xml = new XMLSerializer().serializeToString(holder);
    holder.remove();
    const data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`
    );
    const img = new Image();
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, W, H);
        res(c.toDataURL('image/jpeg', 0.86));
      } catch (e) { console.warn(e); res(null); }
    };
    img.onerror = () => res(null);
    img.src = data;
  });
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
