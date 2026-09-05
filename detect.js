/* ===================================================================
 * detect.js — 侵权检测（核心演示页）
 * 输入疑似侵权内容（图片 / 文本）→ 本地算指纹 → 两级比对管线：
 *   L1 指纹粗筛（SHA-256 精确命中 / pHash·SimHash 海明距离）
 *   L2 语义精排（图片=色块布局余弦，文本=TF-IDF 余弦）
 *   ※ L2 语义层为浏览器端演示实现（真实产品形态可替换 CLIP 等嵌入模型）
 * 命中后可在本页「固定证据」（检测报告哈希二次上链）并导出维权证据包。
 * 全部指纹计算与比对均在本机完成，原文不离开浏览器。
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, toastOk, toastErr, toastInfo, modal, empty } from '../core/ui.js';
import { esc, timeAgo, shortAddr, dataUrlToBytes, fileToDataUrl } from '../core/util.js';
import { sha256Bytes, sha256Text } from '../core/hash.js';
import { imageSignatures, scaleImageDataUrl } from '../core/phash.js';
import { textSimhash } from '../core/simhash.js';
import { generateArtwork, variantOf } from '../core/art.js';
import { compareQuery, filterByThreshold, imageDiffRegions, textDiffRange } from '../core/detect.js';
import { bindRoot, openEvidenceModal } from './_shared.js';
import { exportEvidencePackage } from '../core/cert.js';

export default async function page(el) {
  const me = chain.active();
  const myRole = me.role;

  let kind = 'image';                 // image | text
  let fileMeta = null;                // {src,name,bytes,size}
  let pastedText = '';
  let running = false;
  let resultsState = null;            // compareQuery 结果（sim>=40 的候选行）
  let currentQuery = null;            // 最近一次比对的 query
  let queryLabel = '';
  const fixedEv = new Map();          // workId -> 已固定的 evidence（本页会话内）

  const isFixed = (workId) => fixedEv.has(workId);

  /* ---------------- 页面骨架 ---------------- */
  el.innerHTML = `
  <style>
    .det-grid { display:grid; grid-template-columns:430px 1fr; gap:24px; align-items:start; }
    @media (max-width:980px){ .det-grid { grid-template-columns:1fr; } }
    .hit-card.weak { opacity:.55; filter:grayscale(.45) saturate(.7); }
    .hit-card .ht-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:12px; }
    .cmp-prog { display:flex; flex-direction:column; gap:6px; padding:2px 0 12px; }
    .diff-pair { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    @media (max-width:620px){ .diff-pair { grid-template-columns:1fr; } }
    .txt-pane { border:1px solid var(--line-soft); border-radius:8px; padding:12px 14px; font-size:12.5px; line-height:2; color:#4C4A45; background:var(--panel); max-height:220px; overflow:auto; white-space:pre-wrap; word-break:break-all; }
    .lvl-tbl { width:100%; border-collapse:collapse; font-size:13px; }
    .lvl-tbl th { text-align:left; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:600; padding:7px 10px; border-bottom:1px solid var(--line); }
    .lvl-tbl td { padding:9px 10px; border-bottom:1px solid var(--line-soft); }
    .lvl-tbl tr:last-child td { border-bottom:none; }
    .lvl-tbl .sum td { font-weight:600; color:var(--clay-deep); background:var(--clay-soft); }
  </style>

  <div class="page">
    <div class="page-head">
      <div>
        <h2>侵权检测</h2>
        <div class="page-sub">将疑似侵权内容与本机存证作品做<b>两级比对</b>：先以 SHA-256 / pHash·SimHash 指纹粗筛，再做语义精排，命中后可直接固定侵权证据（二次上链）。</div>
      </div>
      <span class="badge badge-neutral">${icon('cpu', 13)} 全部本地计算</span>
    </div>

    <div class="det-grid">
      <!----------------- 左列：输入与参数 ---------------->
      <div class="stack">
        <div class="card">
          <div class="card-title"><h3>${icon('upload', 15)} 比对输入</h3></div>
          <div class="seg" id="kindSeg" style="width:100%">
            <button data-k="image" class="on">${icon('image', 14)} 图片</button>
            <button data-k="text">${icon('align-left', 14)} 文本</button>
          </div>
          <div id="inputZone" class="stack" style="margin-top:14px"></div>
        </div>

        <div class="card">
          <div class="card-title"><h3>${icon('sliders', 15)} 判定阈值</h3></div>
          <div class="row-between">
            <span class="field-label">相似度阈值</span>
            <span class="sim-num accent-clay" id="thrVal">≥60%</span>
          </div>
          <input type="range" id="thr" min="40" max="99" step="1" value="60" style="width:100%">
          <div class="note paper" style="margin-top:10px">${icon('info', 15)}<div>
            <span class="note-t">两级比对</span>：L1 指纹粗筛按海明距离圈定候选；L2 语义精排（色块布局 / TF-IDF）在候选中排序。
            <b>L2 语义层为浏览器端演示实现</b>，阈值仅影响「是否纳入命中」的展示与统计，不影响系统给出的相似度分数。
          </div></div>
        </div>

        <button class="btn btn-primary btn-lg btn-block" id="goCompare">${icon('scan', 16)} 开始两级比对</button>

        <div class="card">
          <div class="card-title"><h3>${icon('zap', 15)} 一键示例</h3></div>
          <div class="stack" style="gap:8px">
            <button class="btn btn-neutral btn-sm btn-block" id="sampleImg">${icon('image', 14)} 示例 A：生成与已存证图片<b>同源变体</b>（转码压缩）</button>
            <button class="btn btn-neutral btn-sm btn-block" id="sampleText">${icon('align-left', 14)} 示例 B：载入经<b>少量字词改写</b>的搬运文本</button>
          </div>
          <div class="tiny muted" style="margin-top:10px">点击后自动填入左侧输入区，再点「开始两级比对」即可看到检测流程。</div>
        </div>

        <div class="note">${icon('lock', 15)}<div><b>隐私说明：</b>全部指纹（SHA-256 / pHash / SimHash）计算与相似度比对均在你本机完成，疑似侵权内容的原文与图片不会上传，也不会离开浏览器。</div></div>
      </div>

      <!----------------- 右列：结果 ---------------->
      <div id="resultZone"></div>
    </div>
  </div>`;

  bindRoot(el);
  const segBox = el.querySelector('#kindSeg');
  const inputZone = el.querySelector('#inputZone');
  const resultZone = el.querySelector('#resultZone');
  const thrInput = el.querySelector('#thr');
  const thrVal = el.querySelector('#thrVal');
  const goBtn = el.querySelector('#goCompare');
  const threshold = () => Number(thrInput.value);

  /* ---------------- 类型切换 ---------------- */
  segBox.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      segBox.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      kind = b.getAttribute('data-k');
      clearResults();
      renderInput();
    };
  });

  /* ---------------- 输入区渲染 ---------------- */
  function renderInput() {
    if (kind === 'image') {
      inputZone.innerHTML = `
        <div class="dropzone" id="dz">
          <span class="dz-ic">${icon('image', 19)}</span>
          <b>点击或拖入疑似侵权图片</b><span>支持 PNG / JPG / WebP，建议 &lt; 10MB</span>
        </div>
        <div id="fileShown" class="dz-preview" style="display:none;margin-top:12px">
          <img id="thumbImg" alt=""><div class="grow" style="min-width:0"><b class="small ellip" id="fName"></b>
          <div class="muted tiny" id="fMeta"></div></div>
          <button class="btn btn-neutral btn-sm" id="clearFile">移除</button>
        </div>`;
      wireImageInput();
    } else {
      inputZone.innerHTML = `
        <div class="field"><span class="field-label">粘贴疑似侵权文本</span>
          <textarea class="textarea" id="textInput" rows="9" placeholder="粘贴需要比对检测的文本内容…（支持中文 / 英文）"></textarea></div>
        <div class="tiny muted">文本将以 SimHash 计算 L1 指纹，并以 TF-IDF 余弦与存证文本做 L2 语义精排。</div>`;
      const ta = inputZone.querySelector('#textInput');
      ta.value = pastedText;
      ta.addEventListener('input', () => { pastedText = ta.value; });
    }
  }
  renderInput();

  function wireImageInput() {
    const dz = inputZone.querySelector('#dz');
    if (dz) {
      dz.addEventListener('click', () => {
        const i = document.createElement('input');
        i.type = 'file';
        i.accept = 'image/png,image/jpeg,image/webp';
        i.onchange = () => pickFile(i.files[0]);
        i.click();
      });
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); pickFile(e.dataTransfer.files[0]); });
    }
    const clear = inputZone.querySelector('#clearFile');
    if (clear) clear.onclick = () => { fileMeta = null; clearResults(); renderInput(); };
  }

  async function pickFile(file) {
    if (!file) return;
    // 拖入时 file.type 可能为空，改用扩展名检测兜底
    const ext = (file.name || '').toLowerCase().match(/\.(png|jpe?g|webp)$/);
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type) && !ext) {
      toastErr('仅支持 PNG / JPG / WebP 图片'); return;
    }
    try {
      const src = await fileToDataUrl(file);
      fileMeta = { src, bytes: dataUrlToBytes(src), name: file.name, size: file.size };
      showImagePreview();
      clearResults();
    } catch (e) {
      console.warn('pickFile error', e);
      toastErr('图片读取失败：' + (e.message || '未知错误'));
    }
  }

  function showImagePreview() {
    const dz = inputZone.querySelector('#dz');
    const shown = inputZone.querySelector('#fileShown');
    if (!shown || !fileMeta) return;
    if (dz) dz.style.display = 'none';
    shown.style.display = 'flex';
    shown.querySelector('#thumbImg').src = fileMeta.src;
    shown.querySelector('#fName').textContent = fileMeta.name;
    shown.querySelector('#fMeta').textContent = ((fileMeta.size / 1024) | 0) + ' KB · 已就绪';
  }

  function clearResults() {
    resultsState = null;
    currentQuery = null;
    queryLabel = '';
    fixedEv.clear();
    renderResultArea();
  }

  /* ---------------- 一键示例 ---------------- */
  el.querySelector('#sampleImg').onclick = async () => {
    kind = 'image';
    segBox.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.getAttribute('data-k') === 'image'));
    renderInput();
    // 优先选择仍可用「确定性种子」重建的示例存证图（演示种子图片 id≤9）
    const w = chain.works().find((x) => x.kind === 'image' && !x.parentId && x.id <= 9)
      || chain.works().find((x) => x.kind === 'image');
    if (!w) { toastErr('存证库中暂无图片作品，请先在「存证登记」完成存证'); return; }
    toastInfo('示例 A：正在基于《' + w.title + '》重建同源画面并做转码变体…');
    let base;
    if (w.id <= 9) {
      // 与演示种子完全相同的确定性生成参数（640px 原图）
      base = generateArtwork({ seed: 409 + w.id, w: 640, h: 640, palette: (w.id - 1) % 4, complexity: 1 });
    } else {
      base = w.thumb;
    }
    const src = await variantOf(base, 'reencode'); // 模拟「下载后重传」的疑似侵权图
    const bytes = dataUrlToBytes(src);
    fileMeta = { src, bytes, name: 'similar-to-' + w.title + '.jpg', size: bytes.length };
    showImagePreview();
    clearResults();
    toastOk('已生成与《' + w.title + '》同源的示例图片，请点击「开始两级比对」', '示例已就绪');
  };

  el.querySelector('#sampleText').onclick = () => {
    kind = 'text';
    segBox.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.getAttribute('data-k') === 'text'));
    const w = chain.works().find((x) => x.kind === 'text' && x.text);
    if (!w) { toastErr('存证库中暂无文本作品，请先在「存证登记」完成存证'); return; }
    renderInput();
    pastedText = tweakPirateText(w.text); // 少量字词替换的「搬运改写」文本
    inputZone.querySelector('#textInput').value = pastedText;
    clearResults();
    toastOk('已载入对《' + w.title + '》改写过的搬运文本，请点击「开始两级比对」', '示例已就绪');
  };

  /** 模拟搬运者：仅改写第二个句号内句段的少量字词，形成「高度相似、非逐字一致」的文本 */
  function tweakPirateText(original) {
    const subs = [['的', '之'], ['是', '为'], ['也', '亦'], ['与', '和'], ['它', '他'], ['将', '把']];
    const i1 = original.indexOf('。');
    const i2 = i1 >= 0 ? original.indexOf('。', i1 + 1) : -1;
    let s = original;
    if (i1 >= 0 && i2 > i1) {
      let body = original.slice(i1 + 1, i2);
      let n = 0;
      for (const [f, t] of subs) {
        if (n >= 2) break;
        const j = body.indexOf(f);
        if (j >= 0) { body = body.slice(0, j) + t + body.slice(j + f.length); n++; }
      }
      if (n === 0) body = body.replace(body.charAt(0), body.charAt(0) === '在' ? '于' : '在');
      s = original.slice(0, i1 + 1) + body + original.slice(i2);
    }
    return s;
  }

  /* ---------------- 阈值联动 ---------------- */
  thrInput.addEventListener('input', () => {
    thrVal.textContent = '≥' + threshold() + '%';
    if (resultsState) renderResultArea();
  });

  /* ---------------- 比对主流程 ---------------- */
  const progBox = document.createElement('div');
  progBox.className = 'cmp-prog';
  progBox.style.display = 'none';
  progBox.innerHTML = `${icon('cpu', 14)} <span id="progTxt">处理中…</span><div class="sim-bar"><i id="progBar" style="width:8%"></i></div>`;

  function setProgress(p, txt) {
    if (p === null) { progBox.style.display = 'none'; return; }
    const bar = progBox.querySelector('#progBar');
    const t = progBox.querySelector('#progTxt');
    if (bar) bar.style.width = p + '%';
    if (t) t.textContent = (txt || '处理中') + ' · ' + Math.round(p) + '%';
    progBox.style.display = 'flex';
  }

  function setRunUI(on) {
    running = on;
    goBtn.disabled = on;
    goBtn.innerHTML = on
      ? icon('refresh', 16) + ' 比对中…'
      : icon('scan', 16) + ' 开始两级比对';
  }

  goBtn.onclick = runCompare;

  async function runCompare() {
    if (running) return;
    if (kind === 'image') {
      if (!fileMeta) { toastErr('请先选择或拖入一张疑似侵权图片'); return; }
    } else if (!(pastedText || '').trim()) {
      toastErr('请先粘贴需要比对的文本内容');
      return;
    }

    setRunUI(true);
    progBox.style.display = 'flex';
    if (!progBox.isConnected && resultZone.firstChild) resultZone.insertBefore(progBox, resultZone.firstChild);
    setProgress(10, '读取样本');

    try {
      let query;
      if (kind === 'image') {
        setProgress(30, '计算 SHA-256 与 pHash / 色块指纹');
        const [sig, sha] = await Promise.all([
          imageSignatures(fileMeta.src),
          sha256Bytes(fileMeta.bytes),
        ]);
        setProgress(65, 'L1 / L2 特征已就绪，正在全库比对');
        query = { type: 'image', sha, phash: sig.phash, vec: sig.vec, src: fileMeta.src, text: '' };
        queryLabel = '图片 · ' + fileMeta.name;
      } else {
        const t = pastedText.trim();
        setProgress(30, '计算 SHA-256 与 SimHash / TF-IDF 特征');
        const [sha, simhash] = await Promise.all([sha256Text(t), Promise.resolve(textSimhash(t))]);
        setProgress(65, 'L1 / L2 特征已就绪，正在全库比对');
        query = { type: 'text', text: t, sha, simhash, src: '' };
        queryLabel = '文本 · ' + Array.from(t).length + ' 字';
      }

      currentQuery = query;
      const all = chain.works();
      // L1 粗筛 → L2 精排（compareQuery 已按同类型过滤并排序）
      resultsState = compareQuery(query, all).filter((r) => r.sim >= 40);
      setProgress(100, '比对完成');
      renderResultArea();
      setTimeout(() => setProgress(null), 700);
    } catch (e) {
      console.warn(e);
      setProgress(null);
      resultZone.innerHTML = `<div class="card"><div class="note clay">${icon('alert-triangle', 16)}<div>比对失败：${esc(e.message)}</div></div></div>`;
    } finally {
      setRunUI(false);
    }
  }

  /* ---------------- 结果区渲染 ---------------- */
  function verdictBadge(verdict) {
    if (verdict === 'exact') return '<span class="badge badge-clay">完全相同</span>';
    if (verdict === 'high') return '<span class="badge badge-clay">高度相似</span>';
    if (verdict === 'medium') return '<span class="badge badge-neutral">中度相似</span>';
    return '<span class="badge badge-neutral">低相似</span>';
  }

  function renderResultArea() {
    // 清掉可能残留的进度条
    if (progBox.isConnected) progBox.remove();

    if (!resultsState || !currentQuery) {
      resultZone.innerHTML = `<div class="card" style="min-height:300px">
        ${empty('scan', '等待比对', '在左侧输入疑似侵权图片或文本，设置阈值后点「开始两级比对」；系统将给出与存证作品的相似度、判定与差异详情。')}
      </div>`;
      return;
    }
    if (resultsState.length === 0) {
      resultZone.innerHTML = `<div class="card">
        ${empty('shield-check', '未发现相似存证作品', '本次输入与存证库中任何同类型作品的两级相似度均低于 40%，可尝试调低阈值或更换疑似内容后重试。')}
      </div>`;
      return;
    }

    const t = threshold();
    const hits = filterByThreshold(resultsState, t);
    const exactN = hits.filter((r) => r.exact).length;
    const highN = hits.filter((r) => !r.exact && r.sim >= 70 && r.sim < 99.5).length;

    resultZone.innerHTML = `
    <div class="stack-24">
      <div class="card" style="padding:16px 18px">
        <div class="row wrap" style="gap:8px">
          <span class="chip" style="padding:5px 12px">${icon('scan', 13)} 比对样本：<b>${esc(queryLabel)}</b></span>
          <span class="chip" style="padding:5px 12px">阈值 <b class="accent-clay">≥${t}%</b></span>
        </div>
        <div class="row wrap" style="margin-top:10px;gap:12px;align-items:baseline">
          <div><span class="serif" style="font-size:24px;font-weight:600;color:var(--clay-deep)">${hits.length}</span> <span class="small sub">件命中（≥${t}%）</span></div>
          <span class="badge badge-clay">完全匹配 ${exactN}</span>
          <span class="badge badge-neutral">高度相似 ${highN}</span>
          <span class="badge badge-neutral">阈值以下 ${resultsState.length - hits.length} 件已弱化</span>
        </div>
      </div>
      <div class="stack" style="gap:14px">${resultsState.map((r, i) => hitCardHTML(r, i, t)).join('')}</div>
    </div>`;

    resultZone.querySelectorAll('.act-detail').forEach((b) => {
      b.onclick = () => openDetail(resultsState[Number(b.getAttribute('data-i'))]);
    });
    resultZone.querySelectorAll('.act-anchor').forEach((b) => {
      b.onclick = () => openAnchor(resultsState[Number(b.getAttribute('data-i'))]);
    });
    resultZone.querySelectorAll('.act-view-ev').forEach((b) => {
      b.onclick = () => { const ev = fixedEv.get(Number(b.getAttribute('data-wid'))); if (ev) openEvidenceModal(ev.id); };
    });
    resultZone.querySelectorAll('.act-export-ev').forEach((b) => {
      b.onclick = () => exportFrom(Number(b.getAttribute('data-wid')), b);
    });
  }

  function smallThumb(w) {
    if (w.kind === 'image') {
      return `<img src="${w.thumb}" alt="" style="width:84px;height:84px;object-fit:cover;border-radius:9px;border:1px solid var(--line-soft)">`;
    }
    return `<span style="width:84px;height:84px;flex:0 0 84px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(160deg,#F1F0EA,#E3E9E2);border:1px solid var(--line-soft);color:var(--sage)">${icon('align-left', 22)}</span>`;
  }

  function hitCardHTML(r, idx, t) {
    const w = r.work;
    const inThreshold = r.sim >= t;
    const bad = r.verdict === 'exact' || r.verdict === 'high';
    const fixed = isFixed(w.id);
    const pct = (v) => (Math.round(v * 100) + '%');

    let actions = '';
    if (fixed) {
      const ev = fixedEv.get(w.id);
      actions = `
        <span class="badge badge-sage">${icon('shield-check', 12)} 已固定 EV-${String(ev.id).padStart(5, '0')}</span>
        <button class="btn btn-soft btn-sm act-view-ev" data-wid="${w.id}">${icon('eye', 13)} 查看证据</button>
        <button class="btn btn-ghost btn-sm act-export-ev" data-wid="${w.id}">${icon('file-archive', 13)} 导出维权证据包</button>`;
    } else {
      actions = `
        <button class="btn btn-neutral btn-sm act-detail" data-i="${idx}">${icon('eye', 13)} 详情</button>
        <button class="btn btn-danger-solid btn-sm act-anchor" data-i="${idx}">${icon('shield-alert', 13)} 固定证据</button>`;
    }

    return `
    <div class="hit-card ${bad ? 'bad' : ''} ${inThreshold ? '' : 'weak'}">
      <div class="row wrap" style="align-items:flex-start;gap:14px">
        ${smallThumb(w)}
        <div class="grow" style="min-width:0">
          <div class="row wrap" style="gap:6px">
            <span class="chip">CV-${String(w.id).padStart(6, '0')}</span>
            ${w.kind === 'image' ? '<span class="chip">图片</span>' : '<span class="chip">文本</span>'}
            ${w.versionNo > 1 ? '<span class="chip">v' + w.versionNo + '</span>' : ''}
            ${inThreshold ? '' : '<span class="badge badge-neutral" style="font-weight:500">低于当前阈值未纳入命中</span>'}
          </div>
          <div class="serif" style="font-size:16px;font-weight:600;margin-top:5px">${esc(w.title)}</div>
          <div class="muted tiny">作者 ${esc(w.authorsName || shortAddr(w.author))} · ${timeAgo(w.anchored.ts)}存证</div>
          <div class="row wrap" style="gap:6px;margin-top:9px">
            <span class="match-tag">${esc(r.l1Label)} ${pct(r.l1)}</span>
            <span class="match-tag">${esc(r.l2Label)} ${pct(r.l2)}</span>
            ${verdictBadge(r.verdict)}
          </div>
          <div class="sim-bar clay" style="margin-top:10px"><i style="width:${Math.max(2, Math.min(100, r.sim))}%"></i></div>
        </div>
        <div style="text-align:right;flex:0 0 auto">
          <div class="sim-num accent-clay">${r.sim.toFixed(1)}%</div>
          <div class="tiny muted">综合相似度</div>
          ${bad ? `<div class="tiny accent-clay" style="margin-top:4px">${icon('alert-triangle', 11)} 疑似侵权</div>` : ''}
        </div>
      </div>
      <div class="ht-actions">${actions}</div>
    </div>`;
  }

  /* ---------------- 详情弹窗（差异标注） ---------------- */
  function openDetail(r) {
    const w = r.work;
    const q = currentQuery;
    let mediaHTML = '';
    let diffHTML = '';
    let exactNote = '';

    if (kind === 'image' && q.vec && w.fp.vec) {
      const regions = imageDiffRegions(q.vec, w.fp.vec);
      mediaHTML = `
      <div class="diff-pair">
        <div>
          <div class="kicker" style="margin-bottom:6px">疑似内容（改动框标注）</div>
          <div class="diff-img-wrap" style="position:relative;width:100%">
            <img src="${q.src}" alt="" style="width:100%;height:auto;border-radius:8px;border:1px solid var(--line-soft)">
            ${regions.map((b) => `<div class="diff-box" style="left:${b.x.toFixed(1)}%;top:${b.y.toFixed(1)}%;width:${b.w.toFixed(1)}%;height:${b.h.toFixed(1)}%"></div>`).join('')}
          </div>
          <div class="muted tiny" style="margin-top:5px">${regions.length ? '色块向量差异显著的区域以红框标注' : '未检测到显著色块差异区域'}</div>
        </div>
        <div>
          <div class="kicker" style="margin-bottom:6px">原作 · 已存证</div>
          <img src="${w.thumb}" alt="" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid var(--line-soft)">
          <div class="muted tiny" style="margin-top:5px">${esc(w.title)} · CV-${String(w.id).padStart(6, '0')}</div>
        </div>
      </div>`;
    } else if (kind === 'text') {
      const orig = w.text || '';
      const suspect = q.text || '';
      const rg = textDiffRange(orig, suspect); // 标红范围针对疑似文本
      const escSus = esc(suspect);
      const marked = rg
        ? esc(suspect.slice(0, rg[0])) + '<span class="diff-del">' + esc(suspect.slice(rg[0], rg[1])) + '</span>' + esc(suspect.slice(rg[1]))
        : escSus;
      mediaHTML = `
      <div class="diff-pair">
        <div>
          <div class="kicker" style="margin-bottom:6px">疑似内容（差异片段标红）</div>
          <div class="txt-pane">${marked || '<span class="muted">（空）</span>'}</div>
        </div>
        <div>
          <div class="kicker" style="margin-bottom:6px">原作 · 已存证</div>
          <div class="txt-pane">${esc(orig) || '<span class="muted">（空）</span>'}</div>
        </div>
      </div>`;
      diffHTML = rg ? `<div class="muted small">比对方式：对两段文本求共同前缀 / 后缀，红框内的差异片段即疑似改写或增删部分。</div>` : '';
    }

    if (r.exact) {
      exactNote = `<div class="note clay" style="margin-top:12px">${icon('alert-triangle', 15)}<div><b>SHA-256 完全一致：</b>疑似内容与存证原作在字节层面完全相同（${esc(w.title)}，CV-${String(w.id).padStart(6, '0')}），可直接固定证据。</div></div>`;
    }

    const verdictText = r.verdict === 'exact' ? '完全相同'
      : r.verdict === 'high' ? '高度相似'
      : r.verdict === 'medium' ? '中度相似（建议人工复核）' : '低相似';

    const body = document.createElement('div');
    body.innerHTML = `
    <div class="stack">
      <div class="row-between">
        <div>
          <div class="kicker">比对详情 · CV-${String(w.id).padStart(6, '0')}</div>
          <div class="serif" style="font-size:18px;font-weight:600;margin-top:3px">${esc(w.title)}</div>
        </div>
        <div style="text-align:right">${verdictBadge(r.verdict)}</div>
      </div>
      <div class="divider" style="margin:4px 0"></div>
      ${mediaHTML}
      ${diffHTML}
      ${exactNote}
      <div class="divider"></div>
      <div class="sec-kicker">两级比对分数</div>
      <table class="lvl-tbl">
        <thead><tr><th>层级</th><th>方法</th><th>相似度</th></tr></thead>
        <tbody>
          <tr><td>L1 指纹粗筛</td><td>${esc(r.l1Label)}</td><td>${(r.l1 * 100).toFixed(1)}%</td></tr>
          <tr><td>L2 语义精排（演示实现）</td><td>${esc(r.l2Label)}</td><td>${(r.l2 * 100).toFixed(1)}%</td></tr>
          <tr class="sum"><td>综合判定</td><td>${verdictText}</td><td>${r.sim.toFixed(1)}%</td></tr>
        </tbody>
      </table>
      <div class="note paper">${icon('info', 15)}<div><b>判定结论：</b>${r.verdict === 'exact' ? '内容字节级一致，构成直接侵权。' : r.sim >= 70 ? '内容高度相似，构成较强侵权嫌疑。' : '内容存在一定相似，建议人工复核后决定是否固定证据。'} L2 语义层为浏览器端演示实现（色块布局 / TF-IDF），真实场景可替换为 CLIP 等跨模态模型。</div></div>
    </div>`;

    modal({
      title: '侵权比对详情', size: 'lg', body,
      foot: `<button class="btn btn-neutral btn-sm act-close">关闭</button>`,
      onMount: (box, close) => { const c = box.querySelector('.act-close'); if (c) c.onclick = close; },
    });
  }

  /* ---------------- 固定证据（二次上链） ---------------- */
  function openAnchor(r) {
    const w = r.work;
    if (isFixed(w.id)) return;
    const m = modal({
      title: '固定侵权证据 · 二次上链',
      size: 'lg',
      body: `
      <div class="stack">
        <div class="note clay">${icon('alert-triangle', 15)}<div>提交后将把<b>检测报告哈希</b>与<b>比对样本指纹</b>以一笔「固定侵权证据」交易写入链上，并生成本地持久化的证据记录，可用于后续导出维权证据包。</div></div>
        <div class="kv">
          <dt>目标作品</dt><dd>${esc(w.title)} · CV-${String(w.id).padStart(6, '0')}</dd>
          <dt>综合相似度</dt><dd><b class="accent-clay">${r.sim.toFixed(1)}%</b>（${r.verdict === 'exact' ? '完全相同' : r.verdict === 'high' ? '高度相似' : '中度相似'}）</dd>
          <dt>比对方式</dt><dd>L1 ${esc(r.l1Label)} ${(r.l1 * 100).toFixed(0)}% · L2 ${esc(r.l2Label)} ${(r.l2 * 100).toFixed(0)}%（L2 语义层为浏览器端演示实现）</dd>
        </div>
        <div class="field"><span class="field-label">侵权位置 / 来源 <span class="req">*</span></span>
          <input class="input" id="aUrl" maxlength="120" placeholder="例如：微博 @某账号 2026-08-01 发布 / 复制页面 URL"></div>
        <div class="field"><span class="field-label">证据标题</span>
          <input class="input" id="aTitle" maxlength="60" value="疑似侵权：${esc(w.title)}"></div>
        <div class="field"><span class="field-label">补充说明</span>
          <textarea class="textarea" id="aNote" rows="3" placeholder="可选：描述发现经过、比对过程与初步结论…"></textarea></div>
        <div class="muted tiny">将以身份 <b>${esc(me.name)}</b>（${esc(myRole === 'creator' ? '创作者' : myRole === 'monitor' ? '监测机构' : '管理员')}）作为取证方提交，区块确认后可在「证据中心」查看。</div>
      </div>`,
      foot: `<button class="btn btn-neutral btn-sm act-cancel">取消</button>
             <button class="btn btn-primary btn-sm act-submit">${icon('link', 14)} 提交固定（上链）</button>`,
      onMount: (box, close) => {
        box.querySelector('.act-cancel').onclick = close;
        const sub = box.querySelector('.act-submit');
        sub.onclick = async () => {
          const url = (box.querySelector('#aUrl').value || '').trim();
          if (!url) { toastErr('请填写侵权位置 / 来源（用于证据索引）'); return; }
          if (sub.disabled) return;
          sub.disabled = true;
          const old = sub.innerHTML;
          sub.innerHTML = icon('refresh', 14) + ' 交易打包中…';
          try {
            const title = (box.querySelector('#aTitle').value || '').trim() || ('疑似侵权：' + w.title);
            const note = (box.querySelector('#aNote').value || '').trim();
            const ev = await doAnchor(r, { title, url, note });
            fixedEv.set(w.id, ev);
            close();
            toastOk('侵权证据已固定（EV-' + String(ev.id).padStart(5, '0') + ' · 区块 #' + ev.anchored.block + '），可在本行查看与导出', '二次上链成功');
            renderResultArea();
          } catch (e) {
            console.warn(e);
            sub.disabled = false;
            sub.innerHTML = old;
            toastErr(e && e.message ? e.message : '固定失败，请稍后重试');
          }
        };
      },
    });
  }

  async function doAnchor(r, { title, url, note }) {
    const w = r.work;
    const reporter = chain.active().addr;
    const now = Date.now();

    const reportJson = {
      evId: null, workId: w.id, kind, threshold: threshold(), sim: r.sim,
      l1: r.l1, l2: r.l2, l1Label: r.l1Label, l2Label: r.l2Label,
      verdict: r.verdict, exact: r.exact, by: reporter, at: now, location: url, note,
      sha256: currentQuery.sha,
      perceptual: currentQuery.phash || currentQuery.simhash || '',
    };

    const sample = kind === 'image'
      ? { kind: 'image' }
      : { kind: 'text', text: (currentQuery.text || '').slice(0, 200) };
    let thumb = '';
    if (kind === 'image' && currentQuery.src) {
      thumb = await scaleImageDataUrl(currentQuery.src, 300, 0.82); // 疑似图 300px 取证缩略
    }

    const ev = await chain.anchorEvidence({
      workId: w.id,
      reporter,
      sim: r.sim,
      reportJson,
      query: { title, kind, sample, thumb, at: now },
    });

    chain.saveDetection({
      by: reporter, role: chain.active().role, kind, title,
      threshold: threshold(), hit: true,
      top: [{ workId: w.id, sim: r.sim, exact: r.exact, verdict: r.verdict }],
    });
    return ev;
  }

  async function exportFrom(workId, btn) {
    const ev = fixedEv.get(workId);
    if (!ev || btn.disabled) return;
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = icon('refresh', 14) + ' 打包中…';
    try {
      const ok = await exportEvidencePackage(ev);
      toastOk(ok ? '维权证据包 ZIP 已生成' : '已逐个下载证据文件（未检测到 JSZip）');
    } catch (e) {
      console.warn(e);
      toastErr('导出失败：' + (e.message || '未知错误'));
    }
    btn.disabled = false;
    btn.innerHTML = old;
  }

  renderResultArea();
  return () => {};
}
