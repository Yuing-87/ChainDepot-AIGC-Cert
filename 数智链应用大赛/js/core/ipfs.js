/* ===================================================================
 * ipfs.js — 内容寻址存储抽象
 * 真实部署对接 IPFS/Kubo 或 Pinata（需 API Key）；无 API Key 时自动降级为
 * 本地 CID 模拟：CID 由内容 SHA-256 派生，具备内容寻址属性，不阻塞主流程。
 * =================================================================== */
import { sha256Text } from './hash.js';
import { K, ls } from './util.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function toBase32(hex) {
  let bits = '';
  for (let i = 0; i < hex.length; i += 2) {
    bits += parseInt(hex.slice(i, i + 2), 16).toString(2).padStart(8, '0');
  }
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

/** 由内容派生 CID（本地模拟，无网络依赖） */
export async function deriveCid(content) {
  const h = await sha256Text(content);
  return 'bafkrei' + toBase32(h).slice(0, 40);
}

/** 记录（模拟）已 pin 的内容元信息 */
export function pinMeta(cid, meta) {
  const pins = ls.get(K.pins, {});
  pins[cid] = { at: Date.now(), ...meta };
  ls.set(K.pins, pins);
  return cid;
}

export function pinsInfo() {
  return ls.get(K.pins, {});
}

/**
 * 存原文：真实 IPFS 客户端可替换此处（上传 bytes -> 返回 cid）。
 * 演示模式：返回由内容派生的本地 CID，并记录文件大小（原文不持久化上传）。
 */
export async function storeOriginal(payload, { label = '原文' } = {}) {
  const cid = await deriveCid(payload);
  pinMeta(cid, { label, bytes: new Blob([payload]).size, mode: 'local-sim' });
  return cid;
}

export async function storeJson(obj) {
  const json = JSON.stringify(obj);
  return storeOriginal(json, { label: 'metadata' });
}

/** 计算任意对象/文本的 sha256（辅助上链前对原文求指纹） */
export { sha256Text };
