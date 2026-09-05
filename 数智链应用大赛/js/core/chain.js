/* ===================================================================
 * chain.js — 链门面（核心业务中枢）
 * 统一抽象「模拟链 / 真实链」，管理：
 *   账户与身份(RBAC)、存证登记、版本链、授权、侵权证据、检测记录、
 *   区块与交易台账、14 日趋势、演示数据种子。
 * =================================================================== */
import { K, ls, uid, txGas } from './util.js';
import { sha256Bytes, sha256Text, sha256Sync } from './hash.js';
import { textSimhash } from './simhash.js';
import { imageSignatures, scaleImageDataUrl } from './phash.js';
import { storeJson } from './ipfs.js';
import * as real from './realchain.js';
import { mulberry32, generateArtwork } from './art.js';

/* ---------------- 事件总线 ---------------- */
const listeners = new Set();
function notify(evt, payload) { for (const fn of listeners) { try { fn(evt, payload); } catch (e) { console.warn(e); } } }
export function on(evt, fn) { listeners.add((e, p) => { if (e === evt) fn(p); }); return () => listeners.delete(fn); }
export function emit(evt, payload) { notify(evt, payload); }

/* ---------------- 预设身份常量 ---------------- */
export const PRESETS = [
  { addr: '0x7a43c9b1e8d2f4065a17c30e51d24b77f5c2a8a0', name: '平台管理员', role: 'admin', tone: 'slate' },
  { addr: '0x3f9b81d26c4a07e5b1a8f3c2d9e60473aa2f51bc', name: '林之夏 · 创作者', role: 'creator', tone: 'sage' },
  { addr: '0x5c2e7a14b6f930d28e1c4a75d03f9b62c8e4a1d7', name: '云鉴监测中心', role: 'monitor', tone: 'clay' },
  { addr: '0x1ab3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5', name: '顾北辰 · 普通用户', role: 'user', tone: 'sand' },
];
const ADMIN = PRESETS[0].addr, CREATOR = PRESETS[1].addr, MONITOR = PRESETS[2].addr, VIEWER = PRESETS[3].addr;

/* ---------------- 持久化状态 ---------------- */
let mode = 'mock';
let data = emptyData();
let mock = null;

function emptyData() {
  return {
    works: [], evidence: [], authzs: [], detections: [],
    tokens: { balances: {}, ledger: [] }, rwBackfilled: false,
    counters: { work: 0, evidence: 0, authz: 0, det: 0, token: 0 },
  };
}
function emptyMock() {
  return {
    accounts: PRESETS.map((p) => ({ ...p, createdAt: Date.now() })),
    activeAddr: ADMIN,
    blocks: [], txs: [], genesis: Date.now(), contracts: { vault: '', anchor: '' },
  };
}
function saveData() { ls.set(K.data, data); }
function saveMock() { if (mock) ls.set(K.mock, mock); }
export function persist() { saveData(); saveMock(); }

/* ===================================================================
 * 奖励机制（链证积分 CVT）
 * 平台级激励积分：关键上链行为自动奖励，账本持久化于本地，
 * 同时适用于模拟链与真实链模式（真实链上链交易哈希关联到账）。
 * =================================================================== */
export const TOKEN = { symbol: 'CVT', name: '链证积分' };
export const REWARD_RULES = [
  { kind: 'register', amount: 60, label: '作品确权存证', desc: '首次将作品上链确权' },
  { kind: 'version', amount: 30, label: '版本迭代存证', desc: '为已存证作品登记新版本' },
  { kind: 'evidence', amount: 120, label: '侵权证据固定', desc: '检测命中并固定维权证据' },
  { kind: 'detectHit', amount: 20, label: '命中监测', desc: '一次检测判定为命中' },
  { kind: 'airdrop', amount: 500, label: '演示空投', desc: '新账户演示体验金（每个账户一次）' },
];
const REWARD_MAP = Object.fromEntries(REWARD_RULES.map((r) => [r.kind, r]));
const rewardAmount = (kind) => (REWARD_MAP[kind] ? REWARD_MAP[kind].amount : 0);
const rewardLabel = (kind) => (REWARD_MAP[kind] ? REWARD_MAP[kind].label : kind);

function ensureTokens() {
  if (!data.tokens) {
    data.tokens = { balances: {}, ledger: [] };
    data.counters.token = 0;
  }
}

/** 发放奖励并记账（仅内部调用） */
function creditReward(addr, kind, { label, refId = '', ts = Date.now(), tx = '' } = {}) {
  ensureTokens();
  const amount = rewardAmount(kind);
  if (!amount || !addr) return 0;
  data.tokens.balances[addr] = (data.tokens.balances[addr] || 0) + amount;
  data.tokens.ledger.push({
    id: ++data.counters.token, addr, kind, amount, label: label || rewardLabel(kind),
    refId, ts, tx,
  });
  saveData();
  notify('token', { addr });
  return amount;
}

/** 某账户当前积分余额 */
export function tokenBalance(addr) {
  ensureTokens();
  return data.tokens.balances[addr] || 0;
}
/** 某账户积分流水（最新在前） */
export function tokenLedger(addr) {
  ensureTokens();
  return data.tokens.ledger.filter((l) => l.addr === addr).sort((a, b) => b.ts - a.ts);
}
export function tokenStats(addr) {
  ensureTokens();
  const list = tokenLedger(addr);
  return { balance: tokenBalance(addr), earned: list.reduce((s, l) => s + l.amount, 0), count: list.length };
}
/** 账户是否已领取过演示空投 */
export function airdropClaimed(addr) {
  ensureTokens();
  return data.tokens.ledger.some((l) => l.addr === addr && l.kind === 'airdrop');
}
/** 领取演示空投（每个账户一次） */
export function claimAirdrop(addr) {
  if (airdropClaimed(addr)) return false;
  creditReward(addr, 'airdrop', { label: '新手演示空投', refId: 'airdrop-' + addr.slice(2, 8) });
  return true;
}

/** 将历史数据补算奖励（幂等：仅在升级/首次运行时执行一次） */
function backfillRewards() {
  ensureTokens();
  if (data.rwBackfilled) return;
  const events = [];
  for (const w of data.works) {
    events.push({ ts: w.anchored.ts, addr: w.author, kind: w.parentId ? 'version' : 'register', refId: w.id, tx: w.anchored.hash });
  }
  for (const e of data.evidence) {
    events.push({ ts: e.anchored.ts, addr: e.reporter, kind: 'evidence', refId: e.id, tx: e.anchored.hash });
  }
  for (const d of data.detections) {
    if (d.hit) events.push({ ts: d.ts, addr: d.by, kind: 'detectHit', refId: d.id });
  }
  events.sort((a, b) => a.ts - b.ts);
  for (const e of events) creditReward(e.addr, e.kind, { refId: e.refId, ts: e.ts, tx: e.tx });
  data.rwBackfilled = true;
  saveData();
}

export function roleOf(addr) { const a = (mock && mock.accounts.find((x) => x.addr === addr)) || {}; return a.role || 'user'; }
export function nameOf(addr) { const a = (mock && mock.accounts.find((x) => x.addr === addr)) || {}; return a.name || short(addr); }

/* ---------------- 区块/交易（模拟挖矿） ---------------- */
export function blockHeight() { return mock ? mock.blocks.length : 0; }
export function txCount() { return mock ? mock.txs.length : 0; }
export function txHashFor(seedStr) { return '0x' + sha256Sync('cv|' + seedStr).slice(0, 64); }
function pushBlock(ts) {
  const number = mock.blocks.length + 1;
  const hash = '0x' + sha256Sync('blk|' + number + '|' + ts).slice(0, 64);
  mock.blocks.push({ number, hash, ts, count: 0, gasUsed: 0 });
  return mock.blocks[mock.blocks.length - 1];
}
/** 模拟：打包并确认一条交易（同步生成，供业务与种子共用） */
function mineTx({ type, label, from, refId, ts = Date.now(), action }) {
  if (!mock) mock = emptyMock();
  let block = mock.blocks[mock.blocks.length - 1];
  const gap = ts - (block ? block.ts : mock.genesis);
  if (!block || gap > 3000) block = pushBlock(ts);
  block.count++;
  const tx = {
    id: uid('tx'), hash: txHashFor(type + '|' + refId + '|' + ts + '|' + txCount()),
    type, action: action || label, label, from, refId, block: block.number, ts, status: 'confirmed',
  };
  // EVM 风格 Gas：由类型与哈希确定性派生
  tx.gas = txGas(tx);
  block.gasUsed = (block.gasUsed || 0) + tx.gas.gasUsed;
  mock.txs.push(tx);
  const a = mock.accounts.find((x) => x.addr === from);
  if (a) a.txs = (a.txs || 0) + 1;
  saveMock();
  notify('tx', tx);
  return { hash: tx.hash, block: block.number, ts, gas: tx.gas };
}

/* ---------------- 账户 ---------------- */
export function accounts() { return (mock && mock.accounts) || []; }
export function active() {
  if (!mock) mock = emptyMock();
  return mock.accounts.find((a) => a.addr === mock.activeAddr) || mock.accounts[0];
}
export function addAccount({ name, role }) {
  if (!mock) mock = emptyMock();
  let addr = '0x' + sha256Sync('acct|' + name + '|' + Date.now()).slice(0, 40);
  const acc = { addr, name, role: role || 'user', tone: toneOfRole(role), createdAt: Date.now(), txs: 0 };
  mock.accounts.push(acc);
  mock.activeAddr = addr;
  mineTx({ type: 'account', label: '创建账户', action: '账户注册', from: addr, refId: 'acc-' + addr.slice(0, 6) });
  saveSession();
  persist();
  notify('accounts');
  return acc;
}
export function switchAccount(addr) {
  if (!mock) mock = emptyMock();
  const a = mock.accounts.find((x) => x.addr === addr);
  if (!a) return false;
  mock.activeAddr = addr;
  saveMock(); saveSession();
  notify('session');
  return true;
}
export function renameAccount(addr, name) {
  if (!mock) mock = emptyMock();
  const a = mock.accounts.find((x) => x.addr === addr);
  if (!a) return false;
  a.name = name;
  saveMock();
  notify('session');
  return true;
}
function toneOfRole(r) { return ({ admin: 'slate', creator: 'sage', monitor: 'clay', user: 'sand' })[r] || 'sage'; }
function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }

/* ---------------- 会话 ---------------- */
export function modeNow() { return mode; }
export function setModeRaw(m) { mode = m; ls.set(K.session, { addr: active().addr, mode: m }); notify('mode'); }
async function syncActiveFromWallet() {
  if (!window.ethereum) return false;
  try {
    const req = await window.ethereum.request({ method: 'eth_accounts' });
    if (req && req[0]) return req[0];
  } catch {}
  return false;
}

/** 一键模式切换：返回 {ok, msg} */
export async function setMode(target) {
  if (target === mode) return { ok: true };
  if (target === 'real') {
    if (!real.hasEthers()) return { ok: false, msg: '未检测到 MetaMask。请安装浏览器钱包扩展，或继续使用模拟链演示。' };
    const cfg = real.config();
    if (!cfg.vault || !cfg.anchor) return { ok: false, msg: '请先在「区块链管理 → 合约配置」填入已部署合约地址。' };
    try {
      await real.getSigner();
      const req = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (req && req[0]) setActiveAddrFromWallet(req[0], active().role, active().name);
    } catch (e) { return { ok: false, msg: e.message }; }
    mode = 'real';
    saveSession();
    notify('mode'); notify('session');
    return { ok: true, msg: '已切换至真实链：MetaMask' };
  }
  mode = 'mock';
  const w = await syncActiveFromWallet();
  if (!w) switchAccount(mock.activeAddr); else setActiveAddrFromWallet(w, active().role, active().name);
  saveSession();
  notify('mode'); notify('session');
  return { ok: true, msg: '已切换至模拟链模式' };
}
function setActiveAddrFromWallet(w, role = 'creator', nm = 'MetaMask 账户') {
  const existing = mock.accounts.find((x) => x.addr.toLowerCase() === w.toLowerCase());
  if (!existing) {
    mock.accounts.unshift({ addr: w, name: nm, role, tone: toneOfRole(role), createdAt: Date.now(), txs: 0 });
  } else { existing.role = role; }
  mock.activeAddr = w;
  saveMock();
}
export function saveSession() { ls.set(K.session, { addr: active().addr, mode }); }

/* ---------------- 状态查询 ---------------- */
export function chainStatus() {
  return { mode, block: blockHeight(), txs: txCount(), accounts: accounts().length, real: real.hasEthers() };
}
export function contracts() {
  const c = mock ? mock.contracts : { vault: '', anchor: '' };
  const rc = real.config();
  return {
    vault: { mock: c.vault, real: rc.vault },
    anchor: { mock: c.anchor, real: rc.anchor },
  };
}
export function txs() { return mock ? [...mock.txs].reverse() : []; }
export function blocks() { return mock ? [...mock.blocks].reverse() : []; }
export function realCfg() { return real.config(); }

/* ---------------- 数据读取 ---------------- */
export const works = () => [...data.works].sort((a, b) => b.id - a.id);
export const workById = (id) => data.works.find((w) => w.id === id);
export const worksOf = (addr) => works().filter((w) => w.author === addr);
export const evidence = () => [...data.evidence].sort((a, b) => b.id - a.id);
export const authzs = () => [...data.authzs].sort((a, b) => b.id - a.id);
export const detections = () => [...data.detections].sort((a, b) => b.ts - a.ts);
export function versionsOfRoot(rootId) {
  const root = workById(rootId);
  if (!root) return [];
  return data.works.filter((w) => w.rootId === rootId || w.id === rootId).sort((a, b) => a.id - b.id);
}

export const scopeLabel = (s) => ({ commercial: '商用授权', repost: '转载授权', remix: '改编授权', all: '全权授权' })[s] || s;

/* ---------------- 数据写入（全部为本地模拟；真实链模式下先上链） ---------------- */

let busy = false;

/** 通用「上链事务」包装：真实链提交或模拟挖矿 */
async function anchor({ type, action, from, label, refId, realOp, mockTs }) {
  if (mode === 'real') {
    if (!realOp) throw new Error('该操作暂未接入真实链，请在模拟链下演示');
    notify('busy', { label, phase: '待钱包确认…' });
    const res = await realOp();
    notify('busy', { label, phase: `已确认 · 区块 #${res.block}` });
    // 真实链 Gas 从回执派生（若无回执，用 txGas 计算）
    const gas = (res.gasReceipt) ? { gasUsed: Number(res.gasReceipt.gasUsed), gasPriceGwei: Number(res.gasReceipt.effectiveGasPrice) / 1e9, feeEth: Number(res.gasReceipt.gasUsed) * Number(res.gasReceipt.effectiveGasPrice) / 1e18 }
      : txGas({ type, hash: res.txHash });
    return { hash: res.txHash, block: res.block, ts: res.ts, real: true, from: res.from, gas };
  }
  notify('busy', { label, phase: '交易打包中…' });
  await sleep(320);
  notify('busy', { label, phase: '验证签名 / 广播…' });
  await sleep(240);
  const mined = mineTx({ type, action, from, label, refId, ts: mockTs });
  return { hash: mined.hash, block: mined.block, ts: mined.ts, real: false, gas: mined.gas };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 存证登记（首版或版本）。input:
 *  kind image: {title,model,prompt,genTime, src(原始dataURL), bytes(Uint8Array), width,height}
 *  kind text : {title,model,prompt,genTime, text, bytes?}
 */
export async function registerWork(input, { parentId = 0 } = {}) {
  if (busy) throw new Error('上链操作进行中，请稍候');
  busy = true;
  try {
    const author = active().addr;
    const isVersion = !!parentId && workById(parentId);
    if (isVersion && workById(parentId).author !== author) throw new Error('仅作品著作权人可为该作品登记版本');

    const base = {
      title: (input.title || '').trim(), model: (input.model || '').trim() || '未知模型',
      prompt: (input.prompt || '').trim(), genTime: input.genTime || Date.now(), author,
    };
    let fin;
    if (input.kind === 'image') {
      const t = await scaleImageDataUrl(input.src, 320, 0.8);
      const sha = await sha256Bytes(input.bytes);
      const sig = await imageSignatures(input.src);
      fin = {
        kind: 'image', thumb: t, width: input.width, height: input.height,
        sizeBytes: input.bytes.length, sha256: sha,
        fp: { phash: sig.phash, vec: Array.from(sig.vec) }, fileName: input.fileName,
      };
    } else {
      const f = await sha256Text(input.text);
      fin = {
        kind: 'text', text: input.text.slice(0, 4000), sizeBytes: new Blob([input.text]).size,
        sha256: f, fp: { simhash: textSimhash(input.text) },
      };
    }

    const meta = { ...base, sha256: fin.sha256, fp: fin.fp, sizeBytes: fin.sizeBytes };
    const cid = await storeJson(meta); // 原文/元数据存 IPFS（CID 由内容派生）
    const id = ++data.counters.work;

    const anchored = await anchor({
      type: isVersion ? 'version' : 'register', label: isVersion ? '登记迭代版本' : '内容存证登记',
      action: isVersion ? 'registerVersion' : 'registerWork',
      from: author, refId: id,
      realOp: mode === 'real'
        ? (isVersion
            ? () => real.registerVersion(parentId, { ...realPayload(fin), cid, genTimeSeconds: Math.floor(base.genTime / 1000) })
            : () => real.registerWork({ ...realPayload(fin), cid, genTimeSeconds: Math.floor(base.genTime / 1000) }))
        : undefined,
    });

    const root = isVersion ? parentId : id;
    const versionNo = data.works.filter((w) => w.id === root || w.rootId === root).length + 1;
    const rec = {
      id, rootId: root, parentId: isVersion ? parentId : 0, versionNo,
      ...base, ...fin, cid, anchored: { ...anchored }, authorsName: nameOf(author),
    };
    data.works.push(rec);
    saveData();
    notify('data');
    // 奖励：作品确权存证 / 版本迭代存证
    creditReward(author, isVersion ? 'version' : 'register', { refId: id, ts: rec.anchored.ts, tx: rec.anchored.hash });
    return rec;
  } finally { busy = false; }
}
function realPayload(fin) {
  return fin.kind === 'image'
    ? { kind: 'image', sha256: fin.sha256, perceptual: fin.fp.phash }
    : { kind: 'text', sha256: fin.sha256, perceptual: fin.fp.simhash };
}

/** 授权登记 */
export async function grantAuthz({ workId, granteeName, granteeAddr, scope, years }) {
  const work = workById(workId);
  if (!work) throw new Error('作品不存在');
  if (work.author !== active().addr) throw new Error('仅著作权人可授予授权（操作级权限守卫）');
  const granteeAddrOk = (granteeAddr || '').length >= 40 ? granteeAddr : (mock.accounts.find((a) => a.name === granteeName) || {}).addr || '';
  const granteeAddress = granteeAddrOk || granteeAddr || '';
  const expiresAt = years ? Date.now() + years * 365 * 86400000 : 0;
  const id = ++data.counters.authz;
  const anchored = await anchor({
    type: 'authz', action: 'grantAuthorization', label: '登记授权', from: work.author, refId: id,
    realOp: mode === 'real' ? () => real.grantAuthz({ workId, granteeAddr: granteeAddress || undefined, scope, expiresAt: expiresAt ? Math.floor(expiresAt / 1000) : 0 }) : undefined,
  });
  const rec = {
    id, workId, grantor: work.author, grantorName: nameOf(work.author),
    granteeName: granteeName || short(granteeAddress), granteeAddr: granteeAddress,
    scope, expiresAt, grantedAt: anchored.ts, anchored, active: true,
  };
  data.authzs.push(rec);
  saveData();
  notify('data');
  return rec;
}
export async function revokeAuthz(id) {
  const a = data.authzs.find((x) => x.id === id);
  if (!a) throw new Error('授权不存在');
  if (a.grantor !== active().addr) throw new Error('仅授权人可撤销（操作级权限守卫）');
  await anchor({ type: 'revoke', action: 'revokeAuthorization', label: '撤销授权', from: a.grantor, refId: id });
  a.active = false;
  saveData();
  notify('data');
}

/** 固定侵权证据（二次上链） */
export async function anchorEvidence({ workId, reporter, sim, reportJson, query }) {
  const work = workById(workId);
  const reportCid = await storeJson(reportJson);
  const reportHash = await sha256Text(JSON.stringify(reportJson));
  const contentHash = await sha256Text(JSON.stringify(query.sample || {}));
  const id = ++data.counters.evidence;
  const anchored = await anchor({
    type: 'evidence', action: 'anchorEvidence', label: '固定侵权证据', from: reporter, refId: id,
    realOp: mode === 'real' ? () => real.anchorEvidence({ workId, contentHash, reportHash, reportCid, simBp: Math.round(sim * 100) }) : undefined,
  });
  const rec = {
    id, workId, reporter, reporterName: nameOf(reporter), sim, simBp: Math.round(sim * 100),
    reportHash, reportCid, reportJson, query, anchored,
    verdict: sim >= 99.5 ? 'exact' : sim >= 70 ? 'high' : 'medium',
  };
  data.evidence.push(rec);
  saveData();
  notify('data');
  // 奖励：侵权证据固定
  creditReward(reporter, 'evidence', { refId: id, ts: rec.anchored.ts, tx: rec.anchored.hash });
  return rec;
}

/** 记录一次检测（不入链；命中即发放监测奖励） */
export function saveDetection(det) {
  const id = ++data.counters.det;
  const now = Date.now();
  data.detections.push({ id, ...det, ts: now });
  saveData();
  notify('data');
  if (det.hit && det.by) creditReward(det.by, 'detectHit', { refId: id, ts: now });
  return id;
}

/* ---------------- 统计 ---------------- */
export function statsGlobal() {
  const w = data.works.length, e = data.evidence.length, a = data.authzs.filter((x) => x.active).length;
  const d = data.detections;
  const hits = d.filter((x) => x.hit).length;
  return {
    works: w, evidence: e, authzs: a, detections: d.length,
    blocks: mock.blocks.length, txs: mock.txs.length,
    hitRate: d.length ? Math.round((hits / d.length) * 100) : 0,
    hitWorks: data.works.filter((x) => x.exposureHits).length,
  };
}
/** 近 14 日存证 / 证据双序列 */
export function daily14() {
  const out = [];
  const DAY = 86400000;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const lo = start.getTime() - i * DAY, hi = lo + DAY;
    out.push({
      key: new Date(lo).toISOString().slice(5, 10),
      label: (new Date(lo).getMonth() + 1) + '/' + new Date(lo).getDate(),
      works: data.works.filter((w) => w.anchored.ts >= lo && w.anchored.ts < hi).length,
      evidence: data.evidence.filter((x) => x.anchored.ts >= lo && x.anchored.ts < hi).length,
    });
  }
  return out;
}

/* ---------------- 初始化与重置 ---------------- */
let ready = null;
export function init() {
  if (ready) return ready;
  ready = (async () => {
    mode = (ls.get(K.session, { mode: 'mock' })).mode || 'mock';
    data = ls.get(K.data, emptyData());
    mock = ls.get(K.mock, null);
    if (!mock) mock = emptyMock();
    if (!ls.get(K.seedTag, false) && data.works.length === 0) await seedDemo();
    // 奖励账本：旧数据升级 / 首次播种后统一补算一次（幂等）
    backfillRewards();
    // 恢复最近身份
    const sess = ls.get(K.session, null);
    if (sess && sess.addr && mock.accounts.find((x) => x.addr === sess.addr)) mock.activeAddr = sess.addr;
    else mock.activeAddr = ADMIN;
    persist();
    notify('ready');
    return true;
  })();
  return ready;
}
export function readyP() { return init(); }

/** 链重置（管理员）——清空后重建演示数据 */
export async function resetChain(keepAccounts = false) {
  const keep = keepAccounts ? accounts() : [];
  data = emptyData();
  mock = emptyMock();
  if (keepAccounts) mock.accounts = keep;
  ls.set(K.seedTag, true);
  ls.del(K.pins);
  await seedDemo();
  backfillRewards();
  persist();
  notify('data');
  notify('chain');
}

/* ===================================================================
 * 演示数据种子：构成「一眼丰富」的可复现现场数据
 * =================================================================== */
const DAY = 86400000;
function daysAgo(n, hour = 14, min = 0) {
  const d = new Date(); d.setHours(hour, min, 0, 0);
  return d.getTime() - n * DAY;
}
const randOf = mulberry32(20240901);

const IMAGE_TITLES = [
  { t: '雾中山脊', p: 'low angle misty mountain ridge at dawn, ink-wash aesthetic, soft sage green palette, minimalist, 8k' },
  { t: '纸鸢与暮色', p: 'paper kite above wheat field at dusk, muted terracotta accent, fine art print, cinematic' },
  { t: '湖心的几何', p: 'abstract geometry floating above still lake, sage and sand tones, ultra minimal, museum quality' },
  { t: '候鸟的航线', p: 'migrating birds drawn as flowing hairline curves over linen textured sky, quiet, editorial' },
  { t: '雨后木屋', p: 'rain-soaked wooden cabin in moss forest, warm neutral light, calm and meditative, photography' },
  { t: '潮汐的刻度', p: 'tidal pattern carved on wet sand, aerial minimal view, muted greens and greys, fine texture' },
  { t: '静物的秩序', p: 'arrangement of ceramic vessels in still life, soft shadow, warm paper background, refined' },
  { t: '夜航星图', p: 'nocturne of gliding light trails over dark mountain silhouette, restrained palette, elegant' },
  { t: '山谷回音', p: 'layered fog valleys with single thin footpath, eastern minimal painting, breathing whitespace' },
];
const TEXT_TITLES = [
  { t: '《机器的梦境地图》', b: '人工智能不会梦见电子羊。它梦见的是语义的暗流、参数的季风，以及一条从海量语料中浮起的、从未被命名的河。每当我追问它,它便交出一张更精致的梦境地图——上面没有坐标,只有概率的等高线。' },
  { t: '《生成式十四行》', b: '在代码的田野里我种下提示词,收获的是发光的歧义。模型吞下整个图书馆,只为偿还一句准确的抒情。我们互为译者:你给它语法,它还你从未写下的句。' },
  { t: '《数据之海的岸线》', b: '创作曾是孤独的勘探,如今是与潮汐的合谋。每一次生成都是向数据之海抛出的锚,打捞上来的是无数匿名者的回声。著作权该属于谁?提问的人,调参的手,还是那些沉默的词语本身。' },
];

async function seedDemo() {
  ls.set(K.seedTag, true);
  mock = emptyMock();
  data = emptyData();
  persist();
  const dayNow = () => { const d = new Date(); d.setHours(9, 0, 0, 0); return d.getTime(); };

  // 背景：最近交易历史区块（过去 2 小时零星区块撑起"区块高度"）
  const baseBlocks = Math.floor(randOf() * 6) + 6;
  for (let i = 0; i < baseBlocks; i++) {
    const blkTs = dayNow() - 3600000 * (i * (0.5 + randOf())) ;
    pushBlockAt(blkTs);
  }
  function pushBlockAt(ts) {
    const number = mock.blocks.length + 1;
    const hash = '0x' + sha256Sync('blk|' + number + '|' + ts).slice(0, 64);
    mock.blocks.push({ number, hash, ts, count: 0, gasUsed: 0 });
    return mock.blocks[mock.blocks.length - 1];
  }

  // ① 作品：过去 13 天逐步产出（图片为主 + 文本）
  const today = dayNow();
  for (let i = 0; i < 9; i++) {
    const dAgo = [13, 11, 10, 8, 6, 5, 3, 2, 0][i];
    const ts = today - dAgo * DAY - Math.floor(randOf() * 4) * 3600000;
    const seedNo = 410 + i;
    const cfg = IMAGE_TITLES[i];
    const src = generateArtwork({ seed: seedNo, w: 640, h: 640, palette: i % 4, complexity: 1 });
    const bytes = dataUrlToBytes(src);
    const sig = await imageSignatures(src);
    const sha = await sha256Bytes(bytes);
    const thumb = await scaleImageDataUrl(src, 320, 0.82);
    const id = ++data.counters.work;
    const mined = mineTx({ type: 'register', action: 'registerWork', label: '内容存证登记', from: CREATOR, refId: id, ts });
    data.works.push({
      id, rootId: id, parentId: 0, versionNo: 1, kind: 'image', author: CREATOR, authorsName: '林之夏 · 创作者',
      title: cfg.t, model: ['Midjourney v6.1', 'DALL·E 3', 'Stable Diffusion XL'][i % 3],
      prompt: cfg.p, genTime: ts - 86400000 * 2, thumb, width: 640, height: 640,
      sizeBytes: bytes.length, sha256: sha, fp: { phash: sig.phash, vec: Array.from(sig.vec) },
      cid: 'bafkrei' + sha.slice(0, 40).replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(c, 16)]) + 'im' + i,
      anchored: { hash: mined.hash, block: mined.block, ts, mode: 'mock', gas: mined.gas },
    });
  }
  for (let i = 0; i < 3; i++) {
    const dAgo = [12, 7, 4][i];
    const ts = today - dAgo * DAY - Math.floor(randOf() * 5) * 3600000;
    const cfg = TEXT_TITLES[i];
    const text = cfg.b;
    const sha = await sha256Text(text);
    const id = ++data.counters.work;
    const mined = mineTx({ type: 'register', action: 'registerWork', label: '内容存证登记', from: CREATOR, refId: id, ts });
    data.works.push({
      id, rootId: id, parentId: 0, versionNo: 1, kind: 'text', author: CREATOR, authorsName: '林之夏 · 创作者',
      title: cfg.t, model: ['GPT-4o', 'Claude 3.7', '文心一言'][i % 3],
      prompt: '请围绕 AIGC 与创作写一段原创文学性短句', genTime: ts - 86400000, text, sizeBytes: new Blob([text]).size,
      sha256: sha, fp: { simhash: textSimhash(text) },
      cid: 'bafkrei' + sha.slice(0, 38).replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(c, 16)]) + 'tx' + i,
      anchored: { hash: mined.hash, block: mined.block, ts, mode: 'mock', gas: mined.gas },
    });
  }

  // ② 一个版本链示例：作品#1 出第二版
  {
    const parentId = 1;
    const ts = today - 1 * DAY + 2 * 3600000;
    const src = generateArtwork({ seed: 410, w: 640, h: 640, palette: 0, complexity: 1.2 });
    const bytes = dataUrlToBytes(src);
    const sig = await imageSignatures(src);
    const sha = await sha256Bytes(bytes);
    const thumb = await scaleImageDataUrl(src, 320, 0.82);
    const id = ++data.counters.work;
    const mined = mineTx({ type: 'version', action: 'registerVersion', label: '登记迭代版本', from: CREATOR, refId: id, ts });
    data.works.push({
      id, rootId: 1, parentId, versionNo: 2, kind: 'image', author: CREATOR, authorsName: '林之夏 · 创作者',
      title: '雾中山脊 · v2 精修', model: 'Midjourney v6.1', prompt: IMAGE_TITLES[0].p + ', enhanced contrast, refined',
      genTime: ts - 1800000, thumb, width: 640, height: 640, sizeBytes: bytes.length,
      sha256: sha, fp: { phash: sig.phash, vec: Array.from(sig.vec) },
      cid: 'bafkreicv2', anchored: { hash: mined.hash, block: mined.block, ts, mode: 'mock', gas: mined.gas },
    });
  }

  // ③ 授权记录（创作者授予）
  const grantee = VIEWER;
  {
    const rows = [
      { workId: 1, scope: 'commercial', years: 1, ts: today - 9 * DAY, to: '品牌授权方 · 山岚家居' },
      { workId: 5, scope: 'repost', years: 2, ts: today - 5 * DAY, to: '设计周刊编辑部' },
      { workId: 9, scope: 'remix', years: 0, ts: today - 3 * DAY, to: grantee },
    ];
    for (const r of rows) {
      const id = ++data.counters.authz;
      const mined = mineTx({ type: 'authz', action: 'grantAuthorization', label: '登记授权', from: CREATOR, refId: id, ts: r.ts });
      data.authzs.push({
        id, workId: r.workId, grantor: CREATOR, grantorName: '林之夏 · 创作者',
        granteeName: r.to, granteeAddr: r.to === grantee ? grantee : '', scope: r.scope,
        expiresAt: r.years ? r.ts + r.years * 365 * DAY : 0, grantedAt: r.ts,
        anchored: { hash: mined.hash, block: mined.block, ts: r.ts, mode: 'mock', gas: mined.gas }, active: true,
      });
    }
  }

  // ④ 检测记录 + 侵权证据（监测机构视角）
  const hitWorkIds = [3, 6, 2, 8, 1];
  for (let i = 0; i < 8; i++) {
    const dAgo = [12, 10, 9, 7, 6, 4, 2, 0][i];
    const ts = today - dAgo * DAY - Math.floor(randOf() * 6) * 3600000;
    const hit = i < 5;
    const workId = hitWorkIds[i % 5];
    const w = workById(workId);
    const sim = hit ? 78 + Math.floor(randOf() * 21) : 38 + Math.floor(randOf() * 16);
    data.detections.push({
      id: ++data.counters.det, by: MONITOR, role: 'monitor', ts, kind: i % 2 ? 'text' : 'image',
      title: hit ? ('疑似搬运：' + w.title) : '例行巡检 ' + (i + 1),
      threshold: 60, hit, top: hit ? [{ workId, sim, exact: sim >= 99.5, verdict: sim >= 70 ? 'high' : 'medium' }] : [],
    });
  }
  const evSeeds = [
    { workId: 3, sim: 92, dAgo: 9, title: '疑似盗图：账号 @design_hub 发布' },
    { workId: 6, sim: 84, dAgo: 7, title: '二手平台商品图复用原作' },
    { workId: 2, sim: 88, dAgo: 4, title: '营销号搬运未署名' },
    { workId: 8, sim: 96, dAgo: 2, title: '全文引用已存证文本' },
    { workId: 1, sim: 81, dAgo: 1, title: '社交平台换色搬运' },
  ];
  for (let i = 0; i < evSeeds.length; i++) {
    const s = evSeeds[i];
    const w = workById(s.workId);
    const ts = today - s.dAgo * DAY - Math.floor(randOf() * 3) * 3600000;
    const id = ++data.counters.evidence;
    const mined = mineTx({ type: 'evidence', action: 'anchorEvidence', label: '固定侵权证据', from: MONITOR, refId: id, ts });
    const reportJson = { evId: id, workId: s.workId, sim: s.sim, at: ts, verdict: 'high' };
    data.evidence.push({
      id, workId: s.workId, reporter: MONITOR, reporterName: '云鉴监测中心', sim: s.sim, simBp: s.sim * 100,
      reportHash: '0x' + sha256Sync('report|' + s.workId + '|' + ts).slice(0, 64),
      reportCid: 'bafkrei' + sha256Sync('rcid' + id).slice(0, 40) + 'rep' + i,
      reportJson, verdict: 'high', query: { title: s.title, sample: { kind: w.kind, text: w.kind === 'text' ? w.text.slice(0, 60) : undefined } },
      anchored: { hash: mined.hash, block: mined.block, ts, mode: 'mock', gas: mined.gas },
    });
  }
  saveData(); saveMock();
}

function dataUrlToBytes(dataUrl) {
  const i = dataUrl.indexOf(',');
  const bin = atob(dataUrl.slice(i + 1));
  const arr = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
  return arr;
}

export const _debug = { data, mock };
