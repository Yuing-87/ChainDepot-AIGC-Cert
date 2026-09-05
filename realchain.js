/* ===================================================================
 * realchain.js — 真实链适配层（MetaMask + Ethers.js v6）
 * 需要：浏览器安装 MetaMask / 本地开发链（anvil / hardhat node），
 *       并在「区块链管理 → 合约配置」填入已部署的合约地址。
 * 未就绪时始终回退到模拟链，不影响主流程演示。
 * =================================================================== */
import { ls } from './util.js';

const VAULT_ABI = [
  'function registerWork(uint8 kind, bytes32 contentHash, bytes32 perceptualHash, string title, string model, string ipfsCid, uint256 createdTime) returns (uint256 id)',
  'function registerVersion(uint256 parentId, uint8 kind, bytes32 contentHash, bytes32 perceptualHash, string title, string model, string ipfsCid, uint256 createdTime) returns (uint256 id)',
  'function grantAuthorization(uint256 workId, address grantee, uint8 scope, uint256 expiresAt) returns (uint256 grantId)',
  'function revokeAuthorization(uint256 workId, address grantee)',
  'function verifyByHash(bytes32 contentHash) view returns (bool registered, uint256 id)',
  'function totalWorks() view returns (uint256)',
  'function workSeq() view returns (uint256)',
  'function paused() view returns (bool)',
  'function pause()',
  'function unpause()',
];

const ANCHOR_ABI = [
  'function anchorEvidence(uint256 workId, bytes32 contentHash, bytes32 reportHash, string ipfsCid, uint16 simScore) returns (uint256 id)',
  'function verifyEvidence(bytes32 reportHash) view returns (bool exists, uint256 id)',
  'function getEvidenceCount() view returns (uint256)',
  'function evidenceSeq() view returns (uint256)',
  'function setOpenAnchoring(bool)',
  'function openAnchoring() view returns (bool)',
];

export const KIND = { image: 1, text: 2 };
export const SCOPE = { commercial: 1, repost: 2, remix: 3, all: 4 };

export function config() {
  return ls.get('chainvault.realcfg.v1', { vault: '', anchor: '', rpc: '' });
}
export function saveConfig(cfg) {
  ls.set('chainvault.realcfg.v1', cfg);
}
/** 0x 16hex -> bytes32（右补零） */
export function toBytes32(hex64or16) {
  const hex = (hex64or16 || '').replace(/^0x/i, '');
  return '0x' + hex.padEnd(64, '0').slice(0, 64);
}
export const scopeToU8 = (s) => SCOPE[s] || 0;

export function hasEthers() {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined' && typeof window.ethers !== 'undefined';
}

export async function getSigner() {
  if (!hasEthers()) throw new Error('未检测到 MetaMask 或 ethers 库未加载，请安装钱包扩展后重试');
  const cfg = config();
  if (!cfg.vault || !cfg.anchor) throw new Error('尚未配置合约地址，请前往「区块链管理 → 合约配置」填写');
  const { ethers } = window;
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return {
    ethers, provider, signer,
    vault: new ethers.Contract(cfg.vault, VAULT_ABI, signer),
    anchor: new ethers.Contract(cfg.anchor, ANCHOR_ABI, signer),
    net: await provider.getNetwork(),
  };
}

/** 统一提交并等待确认，返回 {txHash, block, ts, from, gas} */
export async function submit(label, run) {
  const ctx = await getSigner();
  const from = await ctx.signer.getAddress();
  const tx = await run(ctx);
  const rc = await tx.wait(1); // 本地链 1 个确认即足够演示
  // 真实链回执中的 Gas 信息
  const gasUsed = rc.gasUsed ? Number(rc.gasUsed) : 0;
  const priceWei = rc.effectiveGasPrice !== undefined ? rc.effectiveGasPrice : rc.gasPrice;
  const gasPriceGwei = priceWei ? Number(priceWei) / 1e9 : 0;
  const feeEth = Number(((gasUsed * gasPriceGwei) / 1e9).toFixed(6));
  return { txHash: rc.hash, block: rc.blockNumber, ts: Date.now(), from, status: 'confirmed', gas: { gasUsed, gasPriceGwei, feeEth } };
}

/* ---------- 业务映射（run 返回待确认的 tx） ---------- */

export const registerWork = (p) => submit('存证登记', ({ vault }) =>
  vault.registerWork(
    KIND[p.kind], toBytes32(p.sha256), toBytes32(p.perceptual), p.title, p.model, p.cid, p.genTimeSeconds
  ));

export const registerVersion = (parentId, p) => submit('登记新版本', ({ vault }) =>
  vault.registerVersion(
    parentId, KIND[p.kind], toBytes32(p.sha256), toBytes32(p.perceptual), p.title, p.model, p.cid, p.genTimeSeconds
  ));

export const grantAuthz = (p) => submit('授予授权', ({ vault }) =>
  vault.grantAuthorization(p.workId, p.granteeAddr || ethersZeroAddr(), scopeToU8(p.scope), p.expiresAt || 0));

export const revokeAuthz = (p) => submit('撤销授权', ({ vault }) =>
  vault.revokeAuthorization(p.workId, p.granteeAddr || ethersZeroAddr()));

export const anchorEvidence = (p) => submit('固定侵权证据', ({ anchor }) =>
  anchor.anchorEvidence(p.workId, toBytes32(p.contentHash), toBytes32(p.reportHash), p.reportCid, p.simBp));

export async function verifyByHash(sha256) {
  const { vault } = await getSigner();
  return vault.verifyByHash(toBytes32(sha256));
}

export async function totalWorks() {
  const { vault } = await getSigner();
  return (await vault.totalWorks()).toNumber();
}

const ethersZeroAddr = () => '0x0000000000000000000000000000000000000000';
