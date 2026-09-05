/* ===================================================================
 * verify.js — 存证真伪验证（公开只读工具，任何人无需登录）
 * 上传文件 / 粘贴文本 → 本地算指纹 → 与链上登记比对
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, toastOk, toastErr, toastInfo, empty } from '../core/ui.js';
import { esc, fmtTs, timeAgo, shortAddr, shortHash, dataUrlToBytes, fileToDataUrl } from '../core/util.js';
import { sha256Bytes, sha256Text } from '../core/hash.js';
import { textSimhash } from '../core/simhash.js';
import { imageSignatures } from '../core/phash.js';
import { compareQuery, filterByThreshold } from '../core/detect.js';
import { bindRoot, go, openWorkModal, openEvidenceModal, mediaBlock, hashRow } from './_shared.js';
import { generateArtwork, variantOf } from '../core/art.js';

export default async function page(el) {
  const mode = 'verify';
  let kind = 'image'; // image | text | hash
  let fileMeta = null; // {src,bytes,size}
  let pasted = '';
  let running = false;

  el.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div>
        <h2>存证真伪验证</h2>
        <div class="page-sub">上传作品文件或粘贴内容，系统将在<b>你的浏览器本地</b>计算 SHA-256 与感知指纹，再与链上登记比对——原文不会上传到任何服务器。</div>
      </div>
      <span class="badge badge-neutral">公开工具 · 无需登录</span>
    </div>

    <div class="grid" style="grid-template-columns:420px 1fr;align-items:start">
      <div class="stack">
        <div class="card">
          <div class="seg" style="width:100%">
            <button data-t="image" class="on">${icon('image', 14)} 图片文件</button>
            <button data-t="text">${icon('align-left', 14)} 粘贴文本</button>
            <button data-t="hash">${icon('hash', 14)} 输入哈希</button>
          </div>
          <div id="inputZone" style="margin-top:14px"></div>
        </div>
        <div class="card">
          <div class="card-title"><h3>${icon('zap', 15)} 快速示例</h3></div>
          <div class="stack" style="gap:8px">
            <button class="btn btn-neutral btn-sm btn-block" id="sampleText">载入一段「已存证」文本进行验证</button>
            <button class="btn btn-neutral btn-sm btn-block" id="sampleImg">生成一张与已存证图片<b>同源</b>的图片验证</button>
          </div>
        </div>
      </div>
      <div id="resultZone">
        <div class="card" style="padding:30px 22px">
          <div class="empty">${icon('shield-check', 36)}<b>等待验证</b><span>选择内容来源后，将在此展示链上比对结果</span></div>
        </div>
      </div>
    </div>
  </div>`;

  bindRoot(el);
  const zone = el.querySelector('#inputZone');
  const resultZone = el.querySelector('#resultZone');

  function renderInput() {
    if (kind === 'hash') {
      zone.innerHTML = `
        <div class="stack">
          <div class="field"><span class="field-label">输入内容指纹 / 交易哈希</span>
            <textarea class="textarea" id="hashInput" rows="2" placeholder="支持：64 位 SHA-256 指纹 / 0x 交易哈希，例如 9f86d081…"></textarea></div>
          <button class="btn btn-primary btn-block" id="goHash">${icon('search', 14)} 开始比对</button>
        </div>`;
    } else if (kind === 'image') {
      zone.innerHTML = `
        <div class="dropzone" id="dz">
          <span class="dz-ic">${icon('image', 19)}</span>
          <b>点击或拖入图片文件</b><span>支持 PNG / JPG / WebP，建议 < 10MB</span>
        </div>
        <div id="fileShown" class="dz-preview" style="display:none;margin-top:12px">
          <img id="thumbImg" alt=""><div class="grow"><b class="small" id="fName"></b>
          <div class="muted tiny" id="fMeta"></div></div>
          <button class="btn btn-neutral btn-sm" id="clearFile">移除</button>
        </div>
        <button class="btn btn-primary btn-block" id="goImg" style="margin-top:12px">${icon('scan', 14)} 计算指纹并验证</button>`;
    } else {
      zone.innerHTML = `
        <div class="field"><span class="field-label">粘贴疑似内容</span>
          <textarea class="textarea" id="textInput" rows="7" placeholder="粘贴需要验证是否已存证的文本内容…"></textarea></div>
        <button class="btn btn-primary btn-block" id="goText" style="margin-top:12px">${icon('scan', 14)} 计算指纹并验证</button>`;
    }
    wireInput();
  }
  renderInput();

  function wireInput() {
    const dz = zone.querySelector('#dz');
    if (dz) {
      dz.addEventListener('click', () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp'; i.onchange = () => pickFile(i.files[0]); i.click(); });
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); pickFile(e.dataTransfer.files[0]); });
    }
    const clear = zone.querySelector('#clearFile');
    if (clear) clear.onclick = () => { fileMeta = null; renderInput(); };
    const g = zone.querySelector('#goImg');
    if (g) g.onclick = () => runImage();
    const gt = zone.querySelector('#goText');
    if (gt) gt.onclick = () => runText();
    const gh = zone.querySelector('#goHash');
    if (gh) gh.onclick = () => runHash();
  }

  el.querySelectorAll('.seg button').forEach((b) => {
    b.onclick = () => {
      el.querySelectorAll('.seg button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      kind = b.getAttribute('data-t');
      fileMeta = null; pasted = '';
      renderInput();
    };
  });

  async function pickFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { toastErr('仅支持 PNG / JPG / WebP 图片'); return; }
    const src = await fileToDataUrl(file);
    fileMeta = { src, bytes: dataUrlToBytes(src), name: file.name, size: file.size };
    const shown = zone.querySelector('#fileShown');
    zone.querySelector('#dz').style.display = 'none';
    shown.style.display = 'flex';
    shown.querySelector('#thumbImg').src = src;
    shown.querySelector('#fName').textContent = file.name;
    shown.querySelector('#fMeta').textContent = ((file.size / 1024) | 0) + ' KB';
  }

  /* 运行验证 */
  async function runWith(query, label) {
    if (running) return;
    running = true;
    resultZone.innerHTML = `<div class="card"><div class="row" style="justify-content:center;padding:34px;gap:10px;color:var(--sub)">${icon('circle-dot', 18)} 正在本地计算指纹…</div></div>`;
    try {
      const all = chain.works();
      // ① 精确命中
      const exact = all.filter((w) => w.sha256 === query.sha);
      // ② 感知粗筛/语义近邻
      const near = compareQuery(query, all).filter((r) => r.sim >= 55 && !r.exact);
      renderResult(query, label, exact, near);
    } catch (e) {
      resultZone.innerHTML = `<div class="card"><div class="note clay">${icon('alert-triangle', 16)}<div>验证失败：${esc(e.message)}</div></div></div>`;
    } finally { running = false; }
  }

  async function runImage() {
    if (!fileMeta) { toastErr('请先选择一张图片'); return; }
    const sig = await imageSignatures(fileMeta.src);
    const sha = await sha256Bytes(fileMeta.bytes);
    await runWith({ type: 'image', src: fileMeta.src, sha, phash: sig.phash, vec: sig.vec, text: '' }, 'image');
  }

  async function runText() {
    const text = (zone.querySelector('#textInput').value || '').trim();
    if (!text) { toastErr('请粘贴需要验证的文本'); return; }
    const sha = await sha256Text(text);
    await runWith({ type: 'text', text, sha, simhash: textSimhash(text) }, 'text');
  }

  async function runHash() {
    const input = (zone.querySelector('#hashInput').value || '').trim();
    if (!input) { toastErr('请输入哈希或交易哈希'); return; }
    resultZone.innerHTML = `<div class="card"><div class="row" style="justify-content:center;padding:34px;gap:10px;color:var(--sub)">${icon('circle-dot', 18)} 正在比对…</div></div>`;
    let target = null;
    if (/^[0-9a-fA-F]{64}$/.test(input)) {
      target = chain.works().find((w) => w.sha256.toLowerCase() === input.toLowerCase());
    } else if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
      const h = input.toLowerCase();
      target = chain.works().find((w) => w.anchored.hash.toLowerCase() === h);
    }
    if (!target) {
      resultZone.innerHTML = `<div class="card"><div class="note clay">${icon('search', 16)}<div><b>未找到匹配记录。</b><br><span class="muted">输入内容应为：64 位 SHA-256（内容指纹）或完整 0x 交易哈希。</span></div></div></div>`;
      return;
    }
    resultZone.innerHTML = '';
    openResultSuccess(renderZone(), target, 'hash');
  }

  /* ---------- 结果渲染 ---------- */
  function renderZone() {
    const z = document.createElement('div');
    resultZone.appendChild(z);
    return z;
  }

  function openResultSuccess(z, work, via) {
    z.innerHTML = `
    <div class="stack">
      <div class="card" style="border-color:#C8D9CE">
        <div class="row" style="gap:12px">
          <span class="stat-icon" style="background:var(--sage-soft);color:var(--sage-deep);width:44px;height:44px;display:grid;place-items:center;border-radius:11px">${icon('shield-check', 22)}</span>
          <div class="grow">
            <div class="badge badge-sage">链上确权命中 · VERIFIED</div>
            <div class="serif" style="font-size:19px;font-weight:600;margin-top:5px">该内容已登记为存证作品</div>
            <div class="muted small" style="margin-top:2px">比对方式：SHA-256 完全一致${via === 'hash' ? '' : ' · ' + (via === 'image' ? 'pHash' : 'SimHash')}（指纹本地计算）</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h3>${icon('layers', 15)} 存证记录</h3></div>
        <div class="row" style="gap:14px;align-items:flex-start">
          <div style="flex:0 0 150px">${mediaBlock(work, { ratio: '1/1' })}</div>
          <div class="grow stack" style="gap:8px">
            <div><b style="font-family:var(--serif);font-size:16px">${esc(work.title)}</b>
            ${work.versionNo > 1 ? `<span class="badge badge-sage">v${work.versionNo}</span>` : ''}</div>
            <div class="row wrap" style="gap:6px">
              <span class="chip">作者 ${esc(work.authorsName || shortAddr(work.author))}</span>
              <span class="chip">${esc(work.model)}</span>
              <span class="chip">${fmtTs(work.genTime)} 生成</span>
            </div>
            <div class="row wrap" style="gap:8px">
              <button class="btn btn-soft btn-sm" data-view="${work.id}">${icon('eye', 13)} 查看存证详情</button>
              <button class="btn btn-neutral btn-sm" data-gotoworks="${work.rootId}">${icon('layers', 13)} 进入存证库</button>
            </div>
          </div>
        </div>
        <div class="divider"></div>
        <div class="stack" style="gap:10px">
          ${hashRow('SHA-256 精确指纹（与上传一致）', work.sha256)}
          ${hashRow('上链交易哈希', work.anchored.hash || '—')}
          ${hashRow('原文 IPFS CID', work.cid)}
        </div>
      </div>
    </div>`;
    z.querySelector('[data-view]').onclick = () => openWorkModal(Number(z.querySelector('[data-view]').getAttribute('data-view')));
    const gw = z.querySelector('[data-gotoworks]');
    if (gw) gw.onclick = () => go('works', { focus: Number(gw.getAttribute('data-gotoworks')) });
  }

  function renderResult(query, label, exact, near) {
    resultZone.innerHTML = '';
    const z = renderZone();
    if (exact.length === 0 && near.length === 0) {
      z.innerHTML = `
      <div class="card">
        <div class="row" style="gap:12px">
          <span class="stat-icon clay" style="width:44px;height:44px;display:grid;place-items:center;border-radius:11px;background:var(--clay-soft);color:var(--clay-deep)">${icon('search', 21)}</span>
          <div class="grow"><div class="badge badge-neutral">未命中 · NOT FOUND</div>
          <div class="serif" style="font-size:18px;font-weight:600;margin-top:4px">链上暂无该内容的存证记录</div>
          <div class="muted small">该文件指纹未在存证库中登记，无法据此确权。若你是作者，请先完成存证登记。</div></div>
        </div>
        <div class="divider"></div>
        <div class="note paper">${icon('info', 15)}<div>提示：验证仅在本地计算指纹并比对已登记哈希，不会上传你的文件。如果你的角色为「创作者 / 管理员」，可直接为该内容发起存证。</div></div>
      </div>`;
      return;
    }
    // 有匹配
    if (exact.length) {
      openResultSuccess(z, exact[0], label);
    } else {
      openResultNear(z, near, query, label);
    }
    if (exact.length && near.length) {
      const extra = document.createElement('div');
      z.appendChild(extra);
      openResultNear(extra, near, query, label, true);
    }
  }

  function openResultNear(z, near, query, label, isExtra) {
    z.innerHTML = (isExtra ? `<div class="kicker" style="margin:6px 0 10px">另有感知相近但非像素一致的内容（可前往侵权检测做结论）</div>` : `
    <div class="card">
      <div class="row" style="gap:12px">
        <span class="stat-icon" style="width:44px;height:44px;display:grid;place-items:center;border-radius:11px;background:var(--clay-soft);color:var(--clay-deep)">${icon('alert-triangle', 21)}</span>
        <div class="grow">
          <div class="badge badge-clay">疑似同源 · PERCEPTUAL NEAR</div>
          <div class="serif" style="font-size:18px;font-weight:600;margin-top:4px">找到 ${near.length} 件感知相近的已存证内容</div>
          <div class="muted small">像素文件并非完全一致，但感知指纹接近——建议用「侵权检测」进一步判定。</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="stack" style="gap:10px">${near.slice(0, 4).map((r) => `
        <div class="hit-card row-between" style="gap:12px">
          <div style="flex:0 0 54px">${r.work.kind === 'image' ? `<img src="${r.work.thumb}" style="width:54px;height:54px;object-fit:cover;border-radius:7px">` : `<span style="width:54px;height:54px;border-radius:7px;display:grid;place-items:center;background:var(--sage-soft);color:var(--sage-deep)">${icon('align-left', 18)}</span>`}</div>
          <div class="grow" style="min-width:0"><b class="small" style="display:block">${esc(r.work.title)}</b>
            <div class="muted tiny">CV-${String(r.work.id).padStart(6, '0')} · ${esc(r.work.authorsName || shortAddr(r.work.author))} · ${timeAgo(r.work.anchored.ts)}</div>
          </div>
          <div style="text-align:right"><div class="sim-num">${r.sim.toFixed(0)}%</div><div class="tiny muted">${r.l1Label}</div></div>
          <button class="btn btn-ghost btn-sm" data-viewn="${r.work.id}">详情</button>
        </div>`).join('')}</div>
      ${isExtra ? '' : `<div class="divider"></div><div class="row" style="gap:8px"><button class="btn btn-neutral btn-sm" id="toDetect">${icon('scan', 14)} 去侵权检测做结论</button></div>`}
    </div>`);
    z.querySelectorAll('[data-viewn]').forEach((n) => n.onclick = () => openWorkModal(Number(n.getAttribute('data-viewn'))));
    const td = z.querySelector('#toDetect');
    if (td) td.onclick = () => go('detect');
  }

  /* 快速示例 */
  el.querySelector('#sampleText').onclick = async () => {
    kind = 'text';
    el.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x.getAttribute('data-t') === 'text'));
    renderInput();
    // 找一段种子文本填入
    const t = chain.works().find((w) => w.kind === 'text' && w.text);
    if (!t) return;
    zone.querySelector('#textInput').value = t.text;
    toastInfo('已载入示例文本，点击「计算指纹并验证」查看链上确权命中');
  };
  el.querySelector('#sampleImg').onclick = async () => {
    kind = 'image';
    el.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x.getAttribute('data-t') === 'image'));
    renderInput();
    const w = chain.works().find((x) => x.kind === 'image' && !x.parentId);
    if (!w) return;
    toastInfo('正在生成与《' + w.title + '》同源的示例图片…');
    // 从同一确定性种子重建原作，再做转码变体
    const idx = chain.works().indexOf(w);
    const src = generateArtwork({ seed: 410 + idx, w: 640, h: 640, palette: idx % 4, complexity: 1 });
    const dataUrl = await variantOf(src, 'reencode');
    const bytes = dataUrlToBytes(dataUrl);
    fileMeta = { src: dataUrl, bytes, name: 'similar-to-' + w.title + '.jpg', size: bytes.length };
    zone.querySelector('#dz').style.display = 'none';
    const shown = zone.querySelector('#fileShown');
    shown.style.display = 'flex';
    shown.querySelector('#thumbImg').src = dataUrl;
    shown.querySelector('#fName').textContent = fileMeta.name;
    shown.querySelector('#fMeta').textContent = ((bytes.length / 1024) | 0) + ' KB';
  };

  return () => {};
}
