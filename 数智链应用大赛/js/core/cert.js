/* ===================================================================
 * cert.js — 存证证书 / 取证快照 / PDF / 维权证据包
 * 实现要点：
 *  - 证书与取证快照先在 DOM 中排版（使用系统字体，中文完美渲染）
 *  - 再通过「克隆 + 内联计算样式 → SVG foreignObject」离屏渲染为位图
 *  - jsPDF 将位图封装为 PDF（图片内嵌，规避 CJK 字体子集化难题）
 *  - JSZip 打包维权证据包（ZIP 不可用时自动降级为逐个下载）
 * =================================================================== */
import { esc, fmtTs, timeAgo, shortAddr, shortHash, downloadBlob, downloadUrl, dataUrlToBlob } from './util.js';
import { icon } from './ui.js';
import { workById, versionsOfRoot } from './chain.js';
import { scopeLabel } from './chain.js';
import { loadImage } from './phash.js';

export function hasJspdf() { return typeof window !== 'undefined' && !!(window.jspdf && window.jspdf.jsPDF); }
export function hasJszip() { return typeof window !== 'undefined' && !!window.JSZip; }

/* ============ 证书 DOM ============ */
export function certTitle(work) {
  return work ? (work.kind === 'image' ? '《' + work.title + '》' : work.title) : '';
}

export function buildCertificateHTML(work) {
  const chain = work.anchored || {};
  return `
  <div class="cert-sheet" style="max-width:820px;margin:0 auto;background:#fff">
    <div class="cert-head">
      <div class="cert-brand">
        <span class="brand-mark">${icon('shield-check', 20)}</span>
        <div><b>链证 ChainVault</b><span>AIGC Copyright Registry</span></div>
      </div>
      <div class="cert-no">存证编号
        <b>CV-${String(work.id).padStart(6, '0')}</b></div>
    </div>
    <div class="cert-title">
      <div class="ct-k">Copyright Notarization Certificate</div>
      <h2>版权存证证书</h2>
      <div class="ct-cn">AIGC 内容链上确权凭证 · 链上数据为最终依据</div>
    </div>
    <div class="cert-body">
      <div class="cert-grid">
        <div class="cert-field"><span class="cf-label">作品标题</span><span class="cf-value">${esc(work.title)}</span></div>
        <div class="cert-field"><span class="cf-label">内容类型</span><span class="cf-value">${work.kind === 'image' ? 'AI 生成图片' : 'AI 生成文本'}</span></div>
        <div class="cert-field"><span class="cf-label">生成模型</span><span class="cf-value">${esc(work.model)}</span></div>
        <div class="cert-field"><span class="cf-label">创作提示词 Prompt</span><span class="cf-value">${esc(work.prompt || '—')}</span></div>
        <div class="cert-field"><span class="cf-label">AIGC 生成时间</span><span class="cf-value">${fmtTs(work.genTime)}</span></div>
        <div class="cert-field"><span class="cf-label">著作权人</span><span class="cf-value">${esc(work.authorsName || shortAddr(work.author))} · ${esc(work.author)}</span></div>
        <div class="cert-field"><span class="cf-label">SHA-256 精确指纹</span><span class="cf-value hash">${work.sha256}</span></div>
        <div class="cert-field"><span class="cf-label">感知指纹（pHash/SimHash）</span><span class="cf-value hash">${work.kind === 'image' ? work.fp.phash : work.fp.simhash}</span></div>
        <div class="cert-field"><span class="cf-label">原文存储</span><span class="cf-value hash">IPFS · ${work.cid}</span></div>
        <div class="cert-field"><span class="cf-label">版本状态</span><span class="cf-value">${work.versionNo === 1 ? '首版（独立存证）' : '第 ' + work.versionNo + ' 版（挂载于根存证 #' + work.rootId + '）'}</span></div>
      </div>
      <div class="cert-grid full" style="margin-top:14px">
        <div class="cert-field"><span class="cf-label">链上交易哈希 Transaction Hash</span><span class="cf-value hash">${chain.hash || '—'}</span></div>
        <div class="cert-field"><span class="cf-label">确认信息</span><span class="cf-value">区块高度 #${chain.block || '—'} · 上链时间 ${fmtTs(chain.ts)}</span></div>
      </div>
    </div>
    <div class="cert-foot">
      <div class="cert-quote">「证书所含哈希由作品内容在浏览器本地计算得出，原文从未离开创作者设备。任何人可将作品文件上传至存证验证页，与链上指纹比对以核验真伪。」</div>
      <div class="cert-stamp">链证<br>CHAINVAULT</div>
    </div>
  </div>`;
}

export function buildVersionChainHTML(root) {
  const list = versionsOfRoot(root.id);
  if (list.length <= 1) return '';
  return `<div style="margin:10px 0 4px">${list.map((v, i) => `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--sub)">
      <span class="badge badge-sage">v${v.versionNo}</span>
      <b style="color:var(--ink)">${esc(v.title)}</b>
      <span class="muted">${fmtTs(v.anchored.ts)}</span>
      ${i < list.length - 1 ? icon('chevron-right', 12) : ''}
    </div>`).join('<div style="margin:6px 0"></div>')}</div>`;
}

/* ============ 取证快照 DOM（带时间戳水印） ============ */
export function buildEvidenceShotHTML(ev, work, extra = {}) {
  const q = ev.query || {};
  const t = extra.shotAt || Date.now();
  return `
  <div class="shot-frame" style="width:100%;min-width:640px;background:#fff">
    <div class="shot-bar" style="background:#33483E;color:#fff;border-bottom:none">
      <span class="dots"><i style="background:rgba(255,255,255,.5)"></i><i style="background:rgba(255,255,255,.5)"></i><i style="background:rgba(255,255,255,.5)"></i></span>
      <span style="font-weight:600;letter-spacing:.05em">侵权证据取证快照 · EVIDENCE SHOT</span>
      <span style="margin-left:auto;opacity:.85">${icon('clock', 12)} ${fmtTs(t)}</span>
    </div>
    <div style="padding:18px 20px">
      <div class="row-between">
        <div>
          <div class="kicker">取证目标</div>
          <div style="font-family:var(--serif);font-size:17px;font-weight:600;margin-top:3px">${esc(ev.query.title || '疑似侵权内容')}</div>
        </div>
        <span class="badge ${ev.verdict === 'high' || ev.verdict === 'exact' ? 'badge-clay' : 'badge-neutral'}" style="font-size:12px;padding:4px 12px">
          ${icon('alert-triangle', 13)} ${ev.verdict === 'exact' ? '完全相同' : '高度相似'}</span>
      </div>
      <div class="row" style="align-items:stretch;margin-top:14px;gap:14px;flex-wrap:wrap">
        <div style="flex:1 1 200px;min-width:0">
          <div style="font-size:10.5px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:6px">原作（已存证）</div>
          ${work.kind === 'image'
            ? `<img src="${work.thumb}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid var(--line-soft)">`
            : `<div style="padding:14px;background:var(--panel);border:1px solid var(--line-soft);border-radius:8px;font-size:12px;color:var(--sub);max-height:120px;overflow:hidden">${esc((work.text || '').slice(0, 160))}…</div>`}
          <div style="font-size:11.5px;color:var(--muted);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(work.title)} · CV-${String(work.id).padStart(6, '0')}</div>
        </div>
        ${q.thumb ? `<div style="flex:1 1 200px;min-width:0">
          <div style="font-size:10.5px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-bottom:6px">疑似侵权内容</div>
          <img src="${q.thumb}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid var(--line-soft)">
        </div>` : ''}
      </div>
      <div style="margin-top:16px;padding:12px 14px;background:var(--clay-soft);border-radius:9px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="font-size:10px;color:var(--clay);letter-spacing:.14em;text-transform:uppercase">比对结论 · 相似度</div>
          <div style="font-family:var(--mono);font-size:22px;font-weight:700;color:var(--clay-deep);line-height:1.2">${ev.sim.toFixed(1)}%</div>
        </div>
        <div style="flex:1 1 180px;min-width:120px">
          <div class="sim-bar clay" style="height:8px"><i style="width:${Math.max(2, Math.min(100, ev.sim))}%"></i></div>
          <div class="muted tiny" style="margin-top:5px">两级比对：指纹粗筛 + 语义精排（全部本地计算）</div>
        </div>
        <span class="hash-inline" style="font-size:11px">报告哈希 ${shortHash(ev.reportHash)}</span>
      </div>
      <div class="row-between" style="margin-top:14px;font-size:11px;color:var(--muted);flex-wrap:wrap;gap:6px">
        <span>取证方：${esc(ev.reporterName || shortAddr(ev.reporter))}</span>
        <span>${icon('link', 11)} 上链交易 ${shortHash((ev.anchored || {}).hash)} · 区块 #${(ev.anchored || {}).block}</span>
      </div>
    </div>
  </div>`;
}

/* ============ 离屏渲染 ============ */
const shotStage = document.createElement('div');
shotStage.style.cssText = 'position:fixed;left:-100000px;top:0;width:860px;background:#F6F4F0;padding:14px;pointer-events:none;z-index:-1;';
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(shotStage));
function ensureStage() { if (!shotStage.isConnected && document.body) document.body.appendChild(shotStage); }

/** 深度克隆并把计算样式内联（用于 foreignObject 渲染） */
function inlineStyles(src) {
  const dst = src.cloneNode(true);
  const walk = (s, d) => {
    const cs = window.getComputedStyle(s);
    for (const prop of cs) {
      const v = cs.getPropertyValue(prop);
      if (v) d.style.setProperty(prop, v);
    }
    for (let i = 0; i < s.children.length; i++) walk(s.children[i], d.children[i]);
  };
  if (dst.nodeType === 1) walk(src, dst);
  return dst;
}

function waitImages(node) {
  const imgs = Array.from(node.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r; }))));
}

/** 把 HTML 节点渲染为位图 dataURL */
export async function snapNode(node, { scale = 2, type = 'image/jpeg', quality = 0.93, width } = {}) {
  ensureStage();
  try { await document.fonts.ready; } catch {}
  const holder = document.createElement('div');
  if (width) holder.style.width = width + 'px';
  const inlineEl = inlineStyles(node);
  holder.appendChild(inlineEl);
  shotStage.appendChild(holder);
  await waitImages(holder);
  const rect = holder.getBoundingClientRect();
  const W = Math.max(2, Math.round(rect.width * scale));
  const H = Math.max(2, Math.round(rect.height * scale));
  const work = inlineEl;
  work.style.transform = `scale(${scale})`;
  work.style.transformOrigin = '0 0';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${new XMLSerializer().serializeToString(work)}</foreignObject></svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  holder.remove();
  return canvas.toDataURL(type, quality);
}

/** 由 HTML 字符串生成节点 */
export function htmlToNode(html, width) {
  const holder = document.createElement('div');
  if (width) holder.style.width = width + 'px';
  holder.innerHTML = html;
  return holder;
}

export async function snapHtml(html, opts = {}) {
  const node = htmlToNode(html, opts.width || 820);
  ensureStage();
  shotStage.appendChild(node);
  try { const r = await snapNode(node, opts); return r; } finally { node.remove(); }
}

/* ============ 导出 ============ */
async function imgLoaded(dataUrl) {
  const img = await loadImage(dataUrl);
  return img;
}

/** 位图 → PDF（jsPDF 可用时）；否则提示降级 */
export async function dataUrlToPdf(dataUrl, filename, { pagePadding = 0 } = {}) {
  if (!hasJspdf()) return false;
  const img = await imgLoaded(dataUrl);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: img.width >= img.height ? 'landscape' : 'portrait',
    unit: 'px', format: [img.width, img.height], hotfixes: ['px_scaling'],
  });
  pdf.addImage(dataUrl, dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', 0, 0, img.width, img.height);
  pdf.save(filename);
  return true;
}

/** 生成证书 PNG + 尝试 PDF 下载 */
export async function downloadCertificate(work, { to = 'pdf' } = {}) {
  const html = buildCertificateHTML(work);
  const png = await snapHtml(html, { width: 860, scale: 2, type: 'image/png' });
  const base = `存证证书-CV${String(work.id).padStart(6, '0')}`;
  if (to === 'png') { downloadUrl(png, base + '.png'); return { png }; }
  const ok = await dataUrlToPdf(png, base + '.pdf');
  if (!ok) { downloadUrl(png, base + '.png'); }
  return { png, pdf: ok };
}

/* ============ 维权证据包 ============ */
export async function exportEvidencePackage(ev, { pngShot, pngCert, includeReadme = true } = {}) {
  const work = workById(ev.workId);
  const title = work ? work.title : 'unknown';
  const files = {};

  if (!pngShot) pngShot = await snapHtml(buildEvidenceShotHTML(ev, work), { width: 820, scale: 2, type: 'image/png' });
  files['2_infringement-snapshot.png'] = pngShot;

  if (!pngCert) {
    pngCert = await snapHtml(buildCertificateHTML(work), { width: 860, scale: 2, type: 'image/png' });
  }
  files['4_original-copyright-certificate.png'] = pngCert;

  const report = ev.reportJson || { id: ev.id, workId: ev.workId, sim: ev.sim };
  files['1_detection-report.json'] = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });

  const txText = [
    '『链证 ChainVault』维权证据包 · 交易哈希核对表',
    '',
    `被侵权作品: ${work ? work.title : '-'} (存证编号 CV-${String(ev.workId).padStart(6, '0')})`,
    `原作存证交易: ${work ? work.anchored.hash : '-'}`,
    `原作存证区块: #${work ? work.anchored.block : '-'}`,
    `侵权证据固定交易: ${ev.anchored.hash}`,
    `侵权证据区块: #${ev.anchored.block}`,
    `检测报告哈希: ${ev.reportHash}`,
    `报告 IPFS CID: ${ev.reportCid || '-'}`,
    '',
    '维权指引: 向平台/法院提交本包时，可前往链上浏览器按上述哈希查询原始记录；',
    '证据哈希与报告全文一一对应，任何篡改都会导致哈希校验失败。',
  ].join('\n');
  files['0_chain-hashes.txt'] = new Blob([txText], { type: 'text/plain;charset=utf-8' });

  const readme = [
    '『链证 ChainVault』维权证据包',
    '================================================',
    `生成时间: ${fmtTs(Date.now())}`,
    `被侵权作品: ${work ? work.title : '-'} / 存证号 CV-${String(ev.workId).padStart(6, '0')}`,
    `检测方: ${ev.reporterName || ev.reporter}`,
    `判定相似度: ${ev.sim.toFixed(1)}%`,
    '',
    '包内容:',
    '  0_chain-hashes.txt              链上哈希与区块号核对表',
    '  1_detection-report.json         侵权检测报告（结构化数据）',
    '  2_infringement-snapshot.png     带时间戳水印的取证截图',
    '  3_verification-guide.pdf        证据自检说明（可选）',
    '  4_original-copyright-certificate.png  原作存证证书',
    '',
    '核验方法:',
    '  1. 打开链上浏览器, 按交易哈希查找原作存证与证据固定记录;',
    '  2. 计算本包内 JSON 的 SHA-256, 与哈希表比对一致;',
    '  3. 将原作文件上传「链证」存证验证页, 指纹匹配即视为真品。',
  ].join('\n');
  files['0_README.txt'] = new Blob([readme], { type: 'text/plain;charset=utf-8' });

  if (hasJszip()) {
    const zip = new window.JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, `维权证据包-${sanitize(title)}-CV${ev.workId}.zip`);
    return true;
  }
  // 降级：逐个下载
  for (const [name, content] of Object.entries(files)) {
    const blob = content instanceof Blob ? content : dataUrlToBlob(content);
    downloadBlob(blob, sanitize(title) + '-' + name);
  }
  return false;
}

function sanitize(s) { return String(s || 'evidence').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30); }

export { scopeLabel };
