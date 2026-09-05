/* ===================================================================
 * simhash.js — 文本 SimHash 局部敏感哈希 + TF-IDF 语义向量
 * level1: SimHash 海明距离粗筛（64 bit）
 * level2: 词项 TF-IDF 余弦精排（浏览器端轻量实现，注释标注为演示）
 * =================================================================== */

/** 文本分词：拉丁词（小写）+ CJK 单字与相邻二元组 */
export function tokenize(text) {
  if (!text) return [];
  const out = [];
  // 拉丁/数字词
  const runs = text.match(/[A-Za-z0-9_]+/g) || [];
  for (const r of runs) out.push(r.toLowerCase());
  // CJK 字符（含扩展）
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || [];
  for (const seg of cjk) {
    const chars = Array.from(seg);
    for (const c of chars) out.push(c);
    for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
  }
  return out;
}

/** FNV-1a 32bit 简易字符串哈希 */
function fnv1a(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 词项 64bit 特征哈希（两个不同 seed 的 fnv 拼合） */
function feat64(tok) {
  const lo = fnv1a(tok, 0x811c9dc5) >>> 0;
  const hi = fnv1a(tok, 0x9e3779b9) >>> 0;
  return (BigInt(hi) << 32n) | BigInt(lo);
}

/** 计算文本 SimHash（64 bit hex 字符串） */
export function textSimhash(text) {
  const tokens = tokenize(text);
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);

  const sums = new Array(64).fill(0);
  for (const [tok, count] of freq) {
    const weight = 1 + Math.log1p(count); // 词频加权（演示近似，可替换为学习权重）
    const h = feat64(tok);
    for (let b = 0; b < 64; b++) {
      sums[b] += (h & (1n << BigInt(b))) ? weight : -weight;
    }
  }
  let bits = 0n;
  for (let b = 0; b < 64; b++) if (sums[b] > 0) bits |= 1n << BigInt(b);
  return bits.toString(16).padStart(16, '0');
}

/** 两个 64bit hex 的海明距离 */
export function hamming(aHex, bHex) {
  const a = BigInt('0x' + aHex);
  const b = BigInt('0x' + bHex);
  let x = a ^ b;
  let d = 0;
  while (x) { x &= x - 1n; d++; }
  return d;
}

/** 海明相似度（0-1） */
export const hammingSim = (aHex, bHex) => 1 - hamming(aHex, bHex) / 64;

/** 词频表 */
export function termFreq(text) {
  const tf = new Map();
  for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/**
 * 语义级 TF-IDF 余弦相似度（0-1）
 * @param {string} qText  查询文本
 * @param {string} dText  候选文本
 * @param {string[]} corpus 其它作品文本（用于 idf，可空）
 */
export function tfidfCosine(qText, dText, corpus = []) {
  const docs = [qText, dText, ...corpus].map(termFreq);
  // idf
  const df = new Map();
  for (const tf of docs) for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;

  const vec = (tf) => {
    const v = new Map();
    for (const [t, c] of tf) v.set(t, c * idf(t));
    return v;
  };
  const va = vec(docs[0]);
  const vb = vec(docs[1]);
  let dot = 0, na = 0, nb = 0;
  for (const x of va.values()) na += x * x;
  for (const x of vb.values()) nb += x * x;
  // 只需公共词项算点积
  for (const [t, a] of va) {
    const b = vb.get(t);
    if (b) dot += a * b;
  }
  if (dot === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
