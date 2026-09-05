/* ===================================================================
 * phash.js — 图像感知哈希（pHash, DCT）与色块语义向量
 * 说明：真实产品中 level-2 可替换为 CLIP 等跨模态嵌入；
 *       此处为纯浏览器演示实现（色块布局余弦），代码注释标注。
 * =================================================================== */

/** 加载图片（dataURL / objectURL / src） */
export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/** 图片缩放绘制到指定尺寸画布（背景铺白，处理透明 PNG） */
export function drawToCanvas(src, w, h) {
  return new Promise(async (res, rej) => {
    try {
      const img = await loadImage(src);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      res(c);
    } catch (e) { rej(e); }
  });
}

/** 等比缩放到最大边 */
export async function scaleImageDataUrl(src, maxSide, quality = 0.86, type = 'image/jpeg') {
  const img = await loadImage(src);
  const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL(type, quality);
}

/** 从源图（dataURL/src）取灰度 32×32 与 8×8 色块布局向量 */
async function canvas32(src) {
  const small = await drawToCanvas(src, 32, 32);
  const ctx = small.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, 32, 32).data;
  // gray 亮度（BT.709）
  const gray = new Float64Array(32 * 32);
  for (let i = 0; i < 32 * 32; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // 8×8 色块平均 -> 192 维向量
  const vec = new Float64Array(192);
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      let r = 0, g = 0, b = 0;
      for (let y = cy * 4; y < cy * 4 + 4; y++) {
        for (let x = cx * 4; x < cx * 4 + 4; x++) {
          const idx = (y * 32 + x) * 4;
          r += data[idx]; g += data[idx + 1]; b += data[idx + 2];
        }
      }
      const n = 16;
      vec[(cy * 8 + cx) * 3] = r / n;
      vec[(cy * 8 + cx) * 3 + 1] = g / n;
      vec[(cy * 8 + cx) * 3 + 2] = b / n;
    }
  }
  return { gray, vec };
}

/** 一维 DCT-II */
function dct1d(x) {
  const n = x.length;
  const out = new Float64Array(n);
  const scale = Math.SQRT2 / Math.sqrt(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[i] * Math.cos((Math.PI * (2 * i + 1) * k) / (2 * n));
    out[k] = (k === 0 ? s / Math.sqrt(2) : s) * scale;
  }
  return out;
}

/** 二维 DCT（可分实现） */
function dct2d(m) {
  const n = m.length;
  const rows = new Array(n);
  for (let y = 0; y < n; y++) rows[y] = dct1d(m[y]);
  const cols = new Array(n);
  for (let x = 0; x < n; x++) {
    const col = new Float64Array(n);
    for (let y = 0; y < n; y++) col[y] = rows[y][x];
    const t = dct1d(col);
    for (let y = 0; y < n; y++) rows[y][x] = t[y];
  }
  // 取低频 8×8（去 DC）
  const block = [];
  for (let y = 1; y <= 8; y++) {
    const row = [];
    for (let x = 1; x <= 8; x++) row.push(rows[y][x]);
    block.push(row);
  }
  return block;
}

/** 计算源图 pHash（64bit hex）与 192 维色块向量 */
export async function imageSignatures(src) {
  const { gray, vec } = await canvas32(src);
  const m = [];
  for (let y = 0; y < 32; y++) {
    const row = new Float64Array(32);
    for (let x = 0; x < 32; x++) row[x] = gray[y * 32 + x];
    m.push(row);
  }
  const low = dct2d(m);
  const vals = [];
  for (const row of low) for (const v of row) vals.push(v);
  vals.sort((a, b) => a - b);
  const median = vals[32]; // 64 个值的中位
  let bits = 0n;
  let idx = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (low[y][x] > median) bits |= 1n << BigInt(idx);
      idx++;
    }
  }
  return { phash: bits.toString(16).padStart(16, '0'), vec };
}

/** 余弦相似度 */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (dot === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
