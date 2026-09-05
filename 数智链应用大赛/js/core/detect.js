/* ===================================================================
 * detect.js — 侵权检测两级比对管线
 *   L1 指纹粗筛：SHA-256 精确命中 / pHash·SimHash 海明距离
 *   L2 语义精排：图像=色块布局余弦（演示），文本=TF-IDF 余弦（演示）
 *   全部本地计算。L2 的真实产品形态可替换 CLIP 等跨模态嵌入。
 * =================================================================== */
import { hammingSim, tfidfCosine } from './simhash.js';
import { cosine } from './phash.js';

/** 针对一件候选作品计算两级相似度，返回 {exact,l1,l2,sim,labels} */
export function scoreAgainst(query, cand) {
  const out = { exact: false, l1: 0, l2: 0, l1Label: '', l2Label: '' };

  if (query.type === 'image' && cand.kind === 'image') {
    // L1：pHash 海明相似
    out.l1 = hammingSim(query.phash, cand.fp.phash);
    out.l1Label = 'pHash 海明相似';
    // 若 SHA-256 完全一致 → 像素级相同
    if (query.sha && cand.sha256 && query.sha === cand.sha256) {
      out.exact = true;
      out.l1 = 1;
    }
    // L2：色块布局余弦（演示 CLIP 位置）
    out.l2 = cand.fp.vec && query.vec ? cosine(query.vec, cand.fp.vec) : 0;
    out.l2Label = '色块语义余弦';
    out.sim = out.exact ? 100 : Math.round((out.l1 * 0.6 + out.l2 * 0.4) * 100);
  } else if (query.type === 'text' && cand.kind === 'text') {
    out.l1 = hammingSim(query.simhash, cand.fp.simhash);
    out.l1Label = 'SimHash 海明相似';
    if (query.sha && cand.sha256 && query.sha === cand.sha256) {
      out.exact = true;
      out.l1 = 1;
    }
    // L2：候选词项 TF-IDF 余弦
    const qText = query.text;
    const cText = cand.text;
    if (qText && cText) {
      out.l2 = tfidfCosine(qText, cText);
      out.l2Label = 'TF-IDF 语义余弦';
    }
    out.sim = out.exact ? 100 : Math.round((out.l1 * 0.5 + out.l2 * 0.5) * 100);
  }
  return out;
}

/**
 * 全量比对：query -> 返回与每件同类型作品的两级分数
 * query: image: {type:'image', sha, phash, vec, thumb?, text?''} | text: {type:'text', sha, simhash, text}
 * works: 存证作品数组
 */
export function compareQuery(query, works) {
  const results = [];
  for (const w of works) {
    if (w.kind !== query.type) continue;
    const s = scoreAgainst(query, w);
    if (s.l1 === 0 && s.l2 === 0 && !s.exact) continue;
    results.push({
      work: w,
      exact: s.exact,
      l1: s.l1,
      l2: s.l2,
      l1Label: s.l1Label,
      l2Label: s.l2Label,
      sim: s.sim,
      verdict: s.exact ? 'exact' : s.sim >= 70 ? 'high' : s.sim >= 55 ? 'medium' : 'low',
    });
  }
  results.sort((a, b) => b.sim - a.sim);
  return results;
}

/** 按阈值过滤命中（阈值 0-100，语义为「相似度下限」） */
export const filterByThreshold = (results, t) => results.filter((r) => r.sim >= t);

/* ---------------- 差异可视化 ---------------- */

/** 8×8 网格像素差显著块 -> 差异区域（百分比坐标） */
export function imageDiffRegions(qVec, cVec, thr = 26) {
  // qVec/cVec: 192 维色块向量
  const boxes = [];
  for (let i = 0; i < 64; i++) {
    const a = qVec[i * 3], b = qVec[i * 3 + 1], cc = qVec[i * 3 + 2];
    const d = Math.abs(a - cVec[i * 3]) + Math.abs(b - cVec[i * 3 + 1]) + Math.abs(cc - cVec[i * 3 + 2]);
    if (d / 3 > thr) {
      const row = Math.floor(i / 8), col = i % 8;
      boxes.push({ x: col * 12.5, y: row * 12.5, w: 12.5, h: 12.5 });
    }
  }
  // 相邻块合并（粗）
  const merged = [];
  for (const b of boxes) {
    const hit = merged.find((m) => Math.abs(m.x - b.x) <= 13 && Math.abs(m.y - b.y) <= 13);
    if (hit) {
      const x1 = Math.min(hit.x, b.x), y1 = Math.min(hit.y, b.y);
      const x2 = Math.max(hit.x + hit.w, b.x + b.w), y2 = Math.max(hit.y + hit.h, b.y + b.h);
      hit.x = x1; hit.y = y1; hit.w = x2 - x1; hit.h = y2 - y1;
    } else merged.push({ ...b });
  }
  return merged;
}

/** 文本差异区间：找共同前缀/后缀，返回 [start,end]（针对 b 文本），无差异返回 null */
export function textDiffRange(a, b) {
  if (a === b) return null;
  let s = 0;
  const max = Math.min(a.length, b.length);
  while (s < max && a[s] === b[s]) s++;
  let e1 = a.length - 1, e2 = b.length - 1;
  while (e1 >= s && e2 >= s && a[e1] === b[e2]) { e1--; e2--; }
  return [s, e2 + 1]; // b 中的差异片段 [s, e2+1)
}
