/* ===================================================================
 * register.js — 存证登记（4 步向导）
 * 角色：创作者 / 管理员（路由级 RBAC 已守卫，进入后仍以 chain.active() 为著作权人）
 * 流程：①选类型 → ②录元数据 → ③本地指纹（sha256 / phash+色块向量 或 simhash / CID）
 *       → ④确认广播上链，成功后整页切换为「成功视图」。
 * 隐私红线：指纹全部在浏览器本地计算，作品原文永不上传任何服务器。
 * 版本场景：进入时取 params.versionOf（父作品/根作品 id），提交时 registerWork(parentId=...)
 * 记为新版本；向导仅第 4 步提交时调用一次 registerWork，无任何网络请求。
 * =================================================================== */
import * as chain from '../core/chain.js';
import { icon, toastOk, toastErr } from '../core/ui.js';
import { esc, fmtTs, fmtBytes, shortAddr, dataUrlToBytes, fileToDataUrl, sleep, fmtInt, txGas } from '../core/util.js';
import { sha256Bytes, sha256Text } from '../core/hash.js';
import { imageSignatures } from '../core/phash.js';
import { textSimhash } from '../core/simhash.js';
import { storeJson } from '../core/ipfs.js';
import { bindRoot, takeParams, roleChip, avatarHTML, kindBadge, hashRow, openWorkModal } from './_shared.js';
import { downloadCertificate } from '../core/cert.js';

/* ---------- 常量 ---------- */
const MODELS = ['Midjourney v6.1', 'DALL·E 3', 'Stable Diffusion XL', 'FLUX.1', 'GPT-4o', 'Claude 3.7', '文心一言 4.0', '其他-自定义'];
const IMG_RE = /^image\/(png|jpe?g|webp)$/;
const padNum = (id) => String(id).padStart(6, '0');
const cut = (s, n = 10, m = 6) => {
  s = String(s || '');
  return s.length > n + m + 1 ? s.slice(0, n) + '…' + s.slice(-m) : (s || '—');
};
const nowLocalInput = () => {
  const d = new Date(); const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const inputToMs = (s) => {
  const t = new Date(s || '').getTime();
  return Number.isFinite(t) ? t : Date.now();
};

export default async function page(el) {
  /* ---------- 会话态 ---------- */
  const me = chain.active();
  const params = takeParams('register');

  let step = 1;           // 1..4
  let kind = 'image';     // image | text
  let versionOf = 0;      // 父（根）作品 id，0=首版登记
  let parent = null;      // 父作品记录
  let file = null;        // {src,bytes,name,size,w,h}
  let text = '';
  let meta = defaultMeta();
  let fpResult = null;    // 第 3 步缓存结果（只算一次）
  let fpSeq = 0;          // 指纹计算令牌（失效/重置时递增）
  let fpRunning = false;  // 指纹计算进行中（防止并发/重复触发）
  let submitting = false; // 第 4 步防重复提交
  let workDone = null;    // 登记成功记录

  // 版本登记取参：params.versionOf 指向（根）作品 → 登记为该作品新版本
  if (params && params.versionOf) {
    const t = chain.workById(Number(params.versionOf));
    if (t) {
      const rid = t.rootId || t.id;
      const r = chain.workById(rid) || t;
      if (r) { versionOf = rid; parent = r; }
    }
  }

  const nextNo = () => (parent ? chain.versionsOfRoot(versionOf).length + 1 : 0);
  function defaultMeta() { return { title: '', model: '', modelCustom: '', prompt: '', genTime: nowLocalInput() }; }
  const readMeta = () => {
    const title = (meta.title || '').trim();
    let model = meta.model || '';
    if (model === '其他-自定义') model = (meta.modelCustom || '').trim();
    return { title, model, prompt: (meta.prompt || '').trim(), genTime: inputToMs(meta.genTime) };
  };

  /* ---------- 指纹失效 ---------- */
  function touchDirty() { fpSeq++; fpResult = null; }

  /* ---------- 外层骨架（顶部提示条 / 步进器 / 内容区） ---------- */
  el.innerHTML = `
  <div class="page rg-page">
    <style>
      /* ===== register.js 页面局部样式（rg- 前缀防碰撞） ===== */
      .rg-grid { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(0,1fr); gap:22px; align-items:start; }
      .rg-kinds { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      .rg-kind { position:relative; display:flex; flex-direction:column; align-items:flex-start; gap:7px; text-align:left;
        padding:22px; border:1px solid var(--line); border-radius:var(--radius); background:var(--card);
        cursor:pointer; transition:border-color var(--t), box-shadow var(--t), background var(--t); box-shadow:var(--shadow); }
      .rg-kind:hover { border-color:#CBC3B5; }
      .rg-kind .kic { width:40px; height:40px; border-radius:10px; display:grid; place-items:center;
        background:var(--panel); color:var(--muted); border:1px solid var(--line-soft); transition:all var(--t); }
      .rg-kind b { font-family:var(--serif); font-size:16px; font-weight:600; }
      .rg-kind .kdesc { font-size:12.5px; color:var(--muted); line-height:1.75; }
      .rg-kind .kradio { position:absolute; top:16px; right:16px; width:18px; height:18px; border-radius:50%;
        border:1.5px solid var(--line); background:#fff; transition:all var(--t); }
      .rg-kind.on { border-color:var(--sage); background:var(--sage-ghost); box-shadow:0 0 0 3px rgba(63,96,83,.10); }
      .rg-kind.on .kic { background:var(--sage-soft); color:var(--sage-deep); }
      .rg-kind.on .kradio { border-color:var(--sage); background:var(--sage); box-shadow:inset 0 0 0 3px #fff; }
      .rg-foot { display:flex; align-items:center; gap:10px; margin-top:22px; padding-top:18px; border-top:1px solid var(--line-soft); }
      .rg-hint { color:var(--muted); font-size:12px; }
      .fp-row { border:1px solid var(--line-soft); border-radius:9px; padding:10px 13px; background:var(--card); }
      .fp-row .rg-ic { width:24px; height:24px; flex:0 0 24px; display:grid; place-items:center;
        border-radius:7px; color:var(--muted); background:var(--panel); }
      .fp-row .rg-ic.ok { color:var(--sage); background:var(--sage-soft); }
      .fp-row .rg-ic.busy { color:var(--sage-deep); background:var(--sage-soft); }
      .fp-row .rg-st { font-size:11px; letter-spacing:.06em; color:var(--sub); font-weight:600; }
      .fp-row .rg-v { margin-top:5px; font-family:var(--mono); font-size:11px; color:var(--ink);
        display:flex; gap:7px; align-items:center; min-width:0; word-break:break-all; }
      .fp-row .rg-v .icon-btn { flex:0 0 24px; width:24px; height:24px; }
      .rg-spin { animation:rgspin .9s linear infinite; }
      @keyframes rgspin { to { transform:rotate(360deg); } }
      .rg-owner { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .rg-cv { font-family:var(--mono); font-size:18px; font-weight:600; letter-spacing:.02em; }
      .rg-page .field-label { text-transform:uppercase; letter-spacing:.09em; font-size:11px; color:var(--sub); }
      /* hashrow 兜底样式（若 components.css 中相关规则被注释则不生效时，保证本页拷贝行整齐） */
      .rg-page .hashrow { display:flex; align-items:center; gap:6px; min-width:0; }
      .rg-page .hashrow code { font-family:var(--mono); font-size:11px; background:var(--panel); border:1px solid var(--line-soft);
        border-radius:6px; padding:3px 8px; color:var(--sub); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        min-width:0; flex:1 1 auto; }
      .rg-page .hashrow .icon-btn { flex:0 0 28px; }
      @media (max-width: 860px) { .rg-grid { grid-template-columns:1fr; } }
      @media (max-width: 480px) {
        .rg-kinds { grid-template-columns:1fr; }
        .rg-foot { flex-wrap:wrap; }
        .rg-hint { width:100%; order:3; }
      }
    </style>

    <div class="page-head">
      <div>
        <h2>存证登记</h2>
        <div class="page-sub">4 步完成 AIGC 作品确权：选择类型 → 录入元数据 → 本地指纹 → 广播上链。指纹全程在浏览器本地计算，原文不上传服务器；著作权人为<b>当前链上账户</b>。</div>
      </div>
      <div class="row wrap" style="gap:8px">
        <span class="badge badge-sage">${icon('user', 11)} ${esc(me.name)}</span>
        <span class="badge badge-neutral">${chain.modeNow() === 'mock' ? '模拟链' : '真实链 MetaMask'}</span>
      </div>
    </div>

    <div id="rgVersionNote"></div>
    <div class="steps" id="rgSteps"></div>
    <div id="rgBox"></div>
  </div>`;

  bindRoot(el);

  /* ---------- 步进器与顶栏 ---------- */
  function stepsHtml(cur) {
    const items = [
      ['选择类型', '图片 / 文本'],
      ['录入元数据', '标题 · 模型 · 时间'],
      ['本地指纹', 'hash · CID'],
      ['上链存证', '广播确认'],
    ];
    return items.map(([t, s], i) => {
      const on = cur === i + 1, done = cur > i + 1;
      const line = i < items.length - 1 ? '<span class="step-line"></span>' : '';
      return `<div class="step ${done ? 'done' : ''} ${on ? 'on' : ''}">
        <span class="step-num">${done ? icon('check', 13) : i + 1}</span>
        <span class="step-txt"><b>${t}</b><span>${s}</span></span>
      </div>${line}`;
    }).join('');
  }

  function versionBanner() {
    if (!parent) return '';
    const mine = me.addr === parent.author;
    return `<div class="stack" style="gap:10px;margin-bottom:8px">
      <div class="topnote">
        ${icon('layers', 16)}
        <div class="grow" style="min-width:0">
          <div class="row wrap" style="gap:8px">
            <b class="small">版本登记 · 迭代存证</b>
            <span class="badge badge-sage">将记为 v${nextNo()}</span>
          </div>
          <div class="small sub" style="margin-top:3px">本次登记将作为父作品 <b>《${esc(parent.title)}》</b> 的新版本，自动挂载于其版本链（父存证编号 CV-${padNum(parent.id)}）；第 4 步广播成功后即成为第 ${nextNo()} 版。</div>
          <div class="row wrap" style="gap:8px;margin-top:8px">
            ${kindBadge(parent.kind)}
            <span class="chip">${icon('user', 12)} ${esc(parent.authorsName || shortAddr(parent.author))}</span>
            <span class="chip" style="font-family:var(--mono);font-size:10.5px">${parent.kind === 'image' ? 'pHash' : 'SimHash'} ${cut(parent.sha256, 8, 4)}</span>
          </div>
        </div>
        <div class="row" style="gap:8px;flex:0 0 auto">
          <button class="btn btn-soft btn-sm" data-v="view">${icon('eye', 13)} 查看父作品</button>
          <button class="btn btn-neutral btn-sm" data-v="unlink">${icon('x', 13)} 改为首版登记</button>
        </div>
      </div>
      ${mine ? '' : `<div class="note clay">${icon('alert-triangle', 16)}<div>当前账户并非《${esc(parent.title)}》的著作权人。<b>仅著作权人本人可为该作品登记迭代版本</b>（RBAC 操作级守卫），广播提交时将被拒绝。请在右上角切换为作者身份后重试。</div></div>`}
    </div>`;
  }

  function renderAll() {
    const vn = el.querySelector('#rgVersionNote');
    vn.innerHTML = versionBanner();
    vn.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = () => {
        if (b.getAttribute('data-v') === 'view') openWorkModal(parent.id);
        else { versionOf = 0; parent = null; renderAll(); } // 去掉版本链接，返回普通登记
      };
    });
    el.querySelector('#rgSteps').innerHTML = stepsHtml(step);
    renderBox();
  }

  /* ---------- 内容区渲染 ---------- */
  let box = null;
  function renderBox(autoStart = true) {
    box = el.querySelector('#rgBox');
    if (step === 1) { box.innerHTML = step1Html(); wireStep1(); }
    else if (step === 2) { box.innerHTML = step2Html(); wireStep2(); }
    else if (step === 3) {
      box.innerHTML = step3Html();
      wireFoot();
      if (autoStart && !fpResult && !fpRunning) setTimeout(() => { if (step === 3) runFp(); }, 80);
    } else {
      box.innerHTML = step4Html();
      wireStep4();
    }
  }

  function footHtml({ prev = true, next = true, nextDisabled = false, hint = '' } = {}) {
    return `<div class="rg-foot">
      <button class="btn btn-neutral btn-lg" data-rg="prev" ${prev ? '' : 'disabled'}>${icon('chevron-left', 15)} 上一步</button>
      <span class="spacer"></span>
      ${hint ? `<span class="rg-hint">${hint}</span>` : ''}
      <button class="btn btn-primary btn-lg" data-rg="next" ${nextDisabled ? 'disabled' : ''}>下一步 ${icon('arrow-right', 15)}</button>
    </div>`;
  }

  function nextBtn() { return box ? box.querySelector('[data-rg=next]') : null; }

  /* ---- 第 1 步：选择类型 ---- */
  function step1Html() {
    const cards = [
      { k: 'image', ic: 'image', t: '图片作品', d: '上传 AI 生成的图片文件（PNG / JPG / WebP）。本地计算 SHA-256 字节指纹、感知 pHash 与 192 维色块向量。' },
      { k: 'text', ic: 'align-left', t: '文本作品', d: '粘贴 AI 生成的文本原文。本地计算 SHA-256 与 SimHash 语义指纹，相似改写仍可被检索。' },
    ];
    return `<div class="card card-pad-lg">
      <div>
        <div class="kicker">第 1 步 · 作品类型</div>
        <div class="serif" style="font-size:20px;font-weight:600;margin-top:2px">本次存证的内容是？</div>
      </div>
      <div class="rg-kinds" style="margin-top:16px">
        ${cards.map((c) => `
        <button type="button" class="rg-kind ${kind === c.k ? 'on' : ''}" data-kind="${c.k}">
          <span class="kradio"></span>
          <span class="kic">${icon(c.ic, 19)}</span>
          <b>${c.t}</b>
          <span class="kdesc">${c.d}</span>
        </button>`).join('')}
      </div>
      ${footHtml({ prev: false, hint: '确认类型后，第 2 步将切换到对应的录入表单' })}
    </div>`;
  }

  function wireStep1() {
    box.querySelectorAll('.rg-kind').forEach((b) => {
      b.onclick = () => {
        const k = b.getAttribute('data-kind');
        if (k === kind) return;
        kind = k;
        if (k === 'image') text = ''; else file = null;
        touchDirty();
        renderBox();
      };
    });
    wireFoot();
  }

  /* ---- 第 2 步：录入元数据 ---- */
  const titlePh = () => {
    if (parent) {
      const base = (parent.title || '').length > 18 ? (parent.title || '').slice(0, 18) + '…' : (parent.title || '');
      return `如：${base} · v${nextNo()} 精修`;
    }
    return kind === 'image' ? '如「雾中山脊 · 晨光」，为作品命名以便管理与展示' : '如《机器的梦境地图》，为文本命名以便管理与展示';
  };

  function dzHtml() {
    return `<div class="dropzone" id="dz">
      <span class="dz-ic">${icon('upload', 19)}</span>
      <b>点击选择或拖拽图片到此处</b>
      <span>支持 PNG / JPG / WebP · 原图不离开本机</span>
    </div>`;
  }

  function imgPreviewHtml() {
    return `<div class="dz-preview" style="padding:12px">
      <img src="${file.src}" alt="">
      <div class="grow" style="min-width:0">
        <b class="small ellip">${esc(file.name)}</b>
        <div class="muted tiny" style="margin-top:2px">${fmtBytes(file.size)} · ${file.w} × ${file.h}px</div>
        <div class="row" style="margin-top:8px;gap:8px">
          <button class="btn btn-neutral btn-sm" data-f="replace">${icon('refresh', 13)} 重新选择</button>
          <button class="btn btn-plain btn-sm" data-f="remove">${icon('trash', 13)} 移除</button>
        </div>
      </div>
    </div>`;
  }

  function mediaCardHtml() {
    if (kind === 'image') {
      return `<div class="card">
        <div class="card-title"><h3>${icon('image', 15)} 作品图片</h3><span class="badge badge-neutral">原图存证</span></div>
        ${file ? imgPreviewHtml() : dzHtml()}
        <div class="note paper" style="margin-top:12px">${icon('lock', 15)}<div>图片仅在<b>你的浏览器本地</b>参与指纹计算与存证登记，不会上传到任何服务器。</div></div>
      </div>`;
    }
    return `<div class="card">
      <div class="card-title"><h3>${icon('align-left', 15)} 创作文本</h3><span class="badge badge-neutral">原文存证</span></div>
      <textarea class="textarea" id="rgText" style="min-height:216px" maxlength="4000" placeholder="粘贴需要存证确权的 AI 生成文本原文…">${esc(text)}</textarea>
      <div class="row-between" style="margin-top:6px">
        <span class="field-hint">以粘贴内容为准计算指纹，建议保留标点与分段。</span>
        <span class="mono-sm muted" id="rgTextCnt">${String(text.length)} 字符</span>
      </div>
      <div class="note paper" style="margin-top:12px">${icon('lock', 15)}<div>文本仅在<b>本机</b>参与 SHA-256 与 SimHash 计算，原文永不上传服务器。</div></div>
    </div>`;
  }

  function metaCardHtml() {
    const isCustom = meta.model === '其他-自定义';
    const versionTip = parent ? `<div class="note paper" style="margin-top:16px">${icon('layers', 15)}<div>
      <b>迭代版本说明：</b>本版将对当期内容<b>独立计算全新指纹</b>并单独上链，完成后自动并入《${esc(parent.title)}》版本链显示为第 v${nextNo()} 版；父作品指纹（${parent.kind === 'image' ? 'pHash' : 'SimHash'} ${cut(parent.sha256, 8, 4)}）与其链上记录均不受影响。</div></div>` : '';
    return `<div class="card">
      <div class="card-title"><h3>${icon('feather-pen', 15)} 作品元数据</h3>
        ${parent ? `<span class="badge badge-sage">迭代版本 · v${nextNo()}</span>` : '<span class="badge badge-neutral">AIGC 溯源信息</span>'}</div>
      <div class="stack">
        <div class="field">
          <span class="field-label">作品标题 <span class="req">*</span></span>
          <input class="input" id="rgTitle" maxlength="60" placeholder="${esc(titlePh())}" value="${esc(meta.title)}">
        </div>
        <div class="field">
          <span class="field-label">生成模型（可选）</span>
          <select class="select" id="rgModel">
            <option value="">请选择常用模型…</option>
            ${MODELS.map((x) => `<option value="${esc(x)}" ${meta.model === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
          </select>
          <div id="rgCustomWrap" style="margin-top:8px;${isCustom ? '' : 'display:none'}">
            <input class="input" id="rgModelCustom" maxlength="40" placeholder="填写自定义模型名称" value="${esc(meta.modelCustom)}">
          </div>
          <span class="field-hint">用于证书展示与元数据溯源；留空将记为「未知模型」。</span>
        </div>
        <div class="field">
          <span class="field-label">创作提示词 Prompt</span>
          <textarea class="textarea" id="rgPrompt" style="min-height:92px" maxlength="1000" placeholder="${kind === 'image' ? '描述生成图片所用的完整提示词（图片推荐填写）…' : '粘贴创作时使用的提示词（如有）…'}">${esc(meta.prompt)}</textarea>
        </div>
        <div class="field">
          <span class="field-label">AIGC 生成时间</span>
          <input class="input" type="datetime-local" id="rgGen" value="${esc(meta.genTime)}">
          <span class="field-hint">AI 内容产出时刻，将随指纹与元数据一并上链留痕。</span>
        </div>
      </div>
      ${versionTip}
    </div>`;
  }

  function step2Html() {
    const issue = step2Issue();
    return `<div class="rg-grid">
      ${mediaCardHtml()}
      ${metaCardHtml()}
    </div>
    ${footHtml({ hint: issue || '信息完整，可进入下一步', nextDisabled: !!issue })}`;
  }

  function step2Issue() {
    if (!(meta.title || '').trim()) return '请填写作品标题';
    if (kind === 'image' && !file) return '请上传作品图片（PNG / JPG / WebP）';
    if (kind === 'text' && !text.trim()) return '请粘贴需要存证的文本内容';
    return '';
  }

  function refreshStep2() {
    const nb = nextBtn(); if (!nb) return;
    const issue = step2Issue();
    nb.disabled = !!issue;
    const h = box.querySelector('.rg-hint');
    if (h) h.textContent = issue || '信息完整，可进入下一步';
  }

  function wireStep2() {
    const setM = (k) => (e) => { meta[k] = e.target.value; touchDirty(); refreshStep2(); };
    const ti = box.querySelector('#rgTitle');
    if (ti) ti.addEventListener('input', setM('title'));
    const md = box.querySelector('#rgModel');
    if (md) md.addEventListener('change', () => {
      meta.model = md.value;
      const wrap = box.querySelector('#rgCustomWrap');
      if (wrap) wrap.style.display = meta.model === '其他-自定义' ? 'block' : 'none';
      touchDirty(); refreshStep2();
    });
    const mc = box.querySelector('#rgModelCustom');
    if (mc) mc.addEventListener('input', setM('modelCustom'));
    const pr = box.querySelector('#rgPrompt');
    if (pr) pr.addEventListener('input', setM('prompt'));
    const gv = box.querySelector('#rgGen');
    if (gv) gv.addEventListener('input', setM('genTime'));

    // 文本区
    const ta = box.querySelector('#rgText');
    if (ta) {
      ta.addEventListener('input', () => {
        text = ta.value;
        touchDirty(); refreshStep2();
        const c = box.querySelector('#rgTextCnt');
        if (c) c.textContent = String(text.length) + ' 字符';
      });
    }
    // 图片上传
    const dz = box.querySelector('#dz');
    if (dz) {
      dz.addEventListener('click', () => {
        const i = document.createElement('input');
        i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp';
        i.onchange = () => pickFile(i.files[0]);
        i.click();
      });
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); pickFile(e.dataTransfer.files[0]); });
    }
    const fr = box.querySelector('[data-f=replace]');
    if (fr) fr.onclick = () => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp';
      i.onchange = () => pickFile(i.files[0]);
      i.click();
    };
    const fo = box.querySelector('[data-f=remove]');
    if (fo) fo.onclick = () => { file = null; touchDirty(); renderBox(); };

    wireFoot();
    refreshStep2();
  }

  async function pickFile(f) {
    if (!f) return;
    if (!IMG_RE.test(f.type)) { toastErr('仅支持 PNG / JPG / WebP 格式图片'); return; }
    const src = await fileToDataUrl(f);
    const bytes = dataUrlToBytes(src);
    const dims = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res({ w: 0, h: 0 });
      im.src = src;
    });
    if (!dims.w || !dims.h) { toastErr('无法读取图片尺寸，请更换文件后重试'); return; }
    file = { name: f.name || 'image', size: f.size || bytes.length, src, bytes, w: dims.w, h: dims.h };
    touchDirty();
    renderBox();
  }

  /* ---- 第 3 步：本地指纹（只算一次，缓存结果） ---- */
  const rowsDef = () => (kind === 'image'
    ? [
      { icon: 'image', label: '读取图片文件 · 尺寸解析', note: '原始文件字节仅在浏览器内存中参与计算，不落盘、不上传' },
      { icon: 'hash', label: 'SHA-256 精确指纹', note: '对原始文件字节计算；任何像素改动都会改变指纹' },
      { icon: 'scan', label: '感知指纹 · pHash（DCT-64）', note: '同时提取 192 维色块语义向量，用于近似相似检索' },
      { icon: 'box', label: '元数据内容寻址 · IPFS CID', note: '由标题 / 模型 / 时间 / 指纹等元数据派生的内容寻址标识' },
    ]
    : [
      { icon: 'align-left', label: '读取文本内容', note: 'UTF-8 编码统计；原文仅在浏览器本地参与计算' },
      { icon: 'hash', label: 'SHA-256 精确指纹', note: '对原文文本计算；标点与空格同样计入指纹' },
      { icon: 'activity', label: '语义指纹 · SimHash（64 bit）', note: '局部敏感哈希，近似改写文本仍保持指纹相近' },
      { icon: 'box', label: '元数据内容寻址 · IPFS CID', note: '由标题 / 模型 / 时间 / 指纹等元数据派生的内容寻址标识' },
    ]);

  function rowHtml(status, def, valHtml) {
    const ic = status === 'ok' ? icon('check-circle', 15)
      : status === 'busy' ? `<span class="rg-spin">${icon('refresh', 15)}</span>`
      : icon('circle-dot', 15);
    const st = status === 'ok' ? '已完成' : status === 'busy' ? '计算中…' : '待处理';
    const icCls = status === 'ok' ? 'ok' : status === 'busy' ? 'busy' : '';
    return `<div class="fp-row" data-i="${def.i}">
      <div class="row" style="gap:10px">
        <span class="rg-ic ${icCls}">${ic}</span>
        <div class="grow" style="min-width:0">
          <div class="row-between" style="gap:8px">
            <span class="rg-st">${def.label}</span>
            <span class="tiny muted">${st}</span>
          </div>
          <div class="rg-v">${valHtml || '<span class="muted">—</span>'}</div>
          ${def.note ? `<div class="tiny muted" style="margin-top:3px">${def.note}</div>` : ''}
        </div>
      </div>
    </div>`;
  }

  const valCode = (v) => `<code>${esc(v)}</code><button class="icon-btn" data-copy="${esc(v)}" title="复制">${icon('copy', 13)}</button>`;

  function step3DoneRows() {
    const d = fpResult; const defs = rowsDef().map((r, i) => ({ ...r, i }));
    return [
      rowHtml('ok', defs[0], d.contentHtml),
      rowHtml('ok', defs[1], valCode(d.sha256)),
      rowHtml('ok', defs[2], valCode(d.percepHash)),
      rowHtml('ok', defs[3], valCode(d.cid)),
    ].join('');
  }

  function step3PendingRows() {
    return rowsDef().map((r, i) => rowHtml('', { ...r, i }, '')).join('');
  }

  function step3Html() {
    const done = !!fpResult;
    return `<div class="stack">
      <div class="card card-pad-lg">
        <div class="card-title">
          <h3>${icon('scan', 15)} 第 3 步 · 本地指纹计算</h3>
          ${done
            ? `<span class="badge badge-sage">${icon('check-circle', 11)} 已完成 · 本机缓存</span>`
            : '<span class="badge badge-neutral">全部在本机完成</span>'}
        </div>
        <div class="sim-bar"><i id="fpBar" style="width:${done ? 100 : 3}%"></i></div>
        <div class="stack" style="gap:8px;margin-top:18px">
          ${done ? step3DoneRows() : step3PendingRows()}
        </div>
        <div class="note" style="margin-top:18px">${icon('lock', 15)}<div><b>隐私承诺：</b>以上指纹与 CID 均由<b>你的浏览器本地</b>计算生成，作品原文只存在于本机内存，<b>永不上传任何服务器</b>；上链仅广播指纹与元数据哈希。为避免误触发，指纹计算只执行一次并缓存结果。</div></div>
      </div>
      ${footHtml({ hint: done ? '指纹就绪，可进入确认' : '指纹计算完成前不可进入下一步', nextDisabled: !done })}
    </div>`;
  }

  async function runFp() {
    if (fpRunning) return;
    fpRunning = true;
    const tok = ++fpSeq;
    const alive = () => tok === fpSeq && step === 3 && box && document.body.contains(box);
    const bar = (w) => { if (!alive()) return; const e = box.querySelector('#fpBar'); if (e) e.style.width = Math.max(0, Math.min(100, w)) + '%'; };
    const setRow = (i, status, def, valHtml) => {
      if (!alive()) return;
      const e = box.querySelector('.fp-row[data-i="' + i + '"]');
      if (e) e.outerHTML = rowHtml(status, def, valHtml);
    };
    const defs = rowsDef().map((r, i) => ({ ...r, i }));
    defs.forEach((d) => setRow(d.i, '', d, ''));

    try {
      // ① 内容读取（信息在内存已就绪）
      setRow(0, 'busy', defs[0], '');
      await sleep(140);
      const utf8Bytes = kind === 'image' ? file.bytes.length : new Blob([text]).size;
      const contentHtml = kind === 'image'
        ? `<code>${esc(file.name)}</code><span class="muted"> · ${fmtBytes(file.bytes.length)} · ${file.w} × ${file.h}px</span>`
        : `<code>UTF-8 · ${fmtBytes(utf8Bytes)}</code><span class="muted"> · ${text.length} 字符</span>`;
      setRow(0, 'ok', defs[0], contentHtml);
      bar(18);

      // ② SHA-256
      await sleep(90);
      setRow(1, 'busy', defs[1], '');
      const sha256 = kind === 'image' ? await sha256Bytes(file.bytes) : await sha256Text(text);
      bar(40);
      setRow(1, 'ok', defs[1], valCode(sha256));

      // ③ 感知指纹
      await sleep(90);
      setRow(2, 'busy', defs[2], '');
      let percepHash = '';
      let fpObj = null;
      if (kind === 'image') {
        const sig = await imageSignatures(file.src);
        percepHash = sig.phash;
        fpObj = { phash: sig.phash, vec: Array.from(sig.vec) };
      } else {
        percepHash = textSimhash(text);
        fpObj = { simhash: percepHash };
      }
      bar(62);
      setRow(2, 'ok', defs[2], valCode(percepHash));

      // ④ IPFS CID（由元数据派生，与链上登记同一 meta 结构）
      await sleep(90);
      setRow(3, 'busy', defs[3], '');
      const m = readMeta();
      const metaObj = {
        title: m.title || '未命名作品',
        model: m.model || '未知模型',
        prompt: m.prompt,
        genTime: m.genTime,
        author: me.addr,
        sha256,
        fp: fpObj,
        sizeBytes: kind === 'image' ? file.bytes.length : utf8Bytes,
      };
      const cid = await storeJson(metaObj);
      bar(86);
      setRow(3, 'ok', defs[3], valCode(cid));
      bar(100);

      if (tok === fpSeq) {
        fpResult = { contentHtml, sha256, percepLabel: kind === 'image' ? 'pHash' : 'SimHash', percepHash, cid };
        if (step === 3) renderBox();
      }
    } catch (e) {
      fpResult = null;
      if (alive()) {
        toastErr('指纹计算失败：' + (e.message || '未知错误') + '，可返回重试');
        renderBox(false);
      }
    } finally {
      fpRunning = false;
    }
  }

  /* ---- 第 4 步：确认 + 广播上链 ---- */
  function step4Html() {
    const m = readMeta();
    const a = me;
    const modeTxt = chain.modeNow() === 'mock' ? '模拟链 · 本地演示网络' : '真实链 · MetaMask';
    const chainIco = chain.modeNow() === 'mock' ? 'server' : 'link';
    const imgTxt = kind === 'image'
      ? `<img src="${file.src}" alt="" style="width:88px;height:88px;flex:0 0 88px;object-fit:cover;border-radius:9px;border:1px solid var(--line-soft)">`
      : `<span style="width:88px;height:88px;flex:0 0 88px;border-radius:9px;display:grid;place-items:center;background:var(--sage-soft);color:var(--sage-deep)">${icon('align-left', 30)}</span>`;
    return `<div class="stack">
      <div class="card card-pad-lg">
        <div class="card-title">
          <h3>${icon('shield-check', 15)} 第 4 步 · 上链确认</h3>
          ${parent ? `<span class="badge badge-sage">迭代版本 · 将记为 v${nextNo()}</span>` : '<span class="badge badge-neutral">首版存证</span>'}
        </div>
        <div class="row" style="gap:14px;align-items:flex-start">
          ${imgTxt}
          <div class="grow" style="min-width:0">
            <div class="serif" style="font-size:19px;font-weight:600">${esc(m.title)}</div>
            <div class="row wrap" style="gap:6px;margin-top:6px">
              ${kindBadge(kind)}
              <span class="chip">${icon('zap', 12)} ${esc(m.model || '未知模型')}</span>
              <span class="chip">${icon('clock', 12)} ${fmtTs(m.genTime)} 生成</span>
            </div>
            ${m.prompt ? `<div class="muted tiny" style="margin-top:7px;max-height:38px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">提示词：${esc(m.prompt)}</div>` : ''}
          </div>
        </div>
        <div class="divider"></div>
        <div class="kv-grid">
          <div class="kv-item"><dt>内容类型</dt><dd>${kind === 'image' ? 'AI 生成图片' : 'AI 生成文本'}</dd></div>
          <div class="kv-item"><dt>著作权人</dt><dd>
            <div class="rg-owner">${avatarHTML(a.name, a.addr, 26)}<span><b class="small">${esc(a.name)}</b></span>${roleChip(a.role)}</div>
            <div class="mono-sm muted" style="margin-top:4px">${esc(a.addr)}</div>
          </dd></div>
          <div class="kv-item"><dt>AIGC 生成时间</dt><dd>${fmtTs(m.genTime)}</dd></div>
          <div class="kv-item"><dt>目标链</dt><dd><span class="row" style="gap:6px">${icon(chainIco, 13)} ${modeTxt}</span></dd></div>
          <div class="kv-item"><dt>SHA-256（截断）</dt><dd class="mono-sm">${esc(cut(fpResult.sha256))}</dd></div>
          <div class="kv-item"><dt>感知指纹（截断）</dt><dd class="mono-sm">${esc(fpResult.percepLabel)} ${esc(cut(fpResult.percepHash, 10, 4))}</dd></div>
          <div class="kv-item"><dt>IPFS CID（截断）</dt><dd class="mono-sm">${esc(cut(fpResult.cid, 12, 6))}</dd></div>
        </div>
      </div>
      <div class="note paper">${icon('info', 15)}<div><b>确认即广播：</b>点击下方按钮后将在目标链发起一笔存证交易（模拟链自动打包确认 / 真实链等待 MetaMask 钱包确认），并触发全局链上状态提示。登记成功后可下载 PDF 存证证书。</div></div>
      <button class="btn btn-primary btn-lg btn-block" id="rgSubmit">${icon('shield-check', 17)} 广播上链 · 存证确权</button>
      <div class="rg-foot" style="margin-top:0;padding-top:0;border-top:none">
        <button class="btn btn-neutral" data-rg="prev">${icon('chevron-left', 15)} 上一步</button>
        <span class="spacer"></span>
        <span class="muted tiny">${parent ? '登记后为第 ' + nextNo() + ' 版 · 挂载于父存证 CV-' + padNum(parent.id) : '本次为首版（独立存证）'}</span>
      </div>
    </div>`;
  }

  function wireStep4() {
    const btn = box.querySelector('#rgSubmit');
    if (btn) btn.onclick = submitReg;
    const pv = box.querySelector('[data-rg=prev]');
    if (pv) pv.onclick = () => { step = 3; renderAll(); };
  }

  async function submitReg() {
    if (submitting || !fpResult) return;
    submitting = true;
    const btn = box.querySelector('#rgSubmit');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="rg-spin">${icon('refresh', 16)}</span> 正在广播上链…`;
    }
    try {
      const m = readMeta();
      const base = {
        kind, title: m.title, model: m.model, prompt: m.prompt,
        genTime: m.genTime, fileName: file ? file.name : undefined,
      };
      const input = kind === 'image'
        ? { ...base, src: file.src, bytes: file.bytes, width: file.w, height: file.h }
        : { ...base, text };
      const opts = versionOf && parent ? { parentId: versionOf } : {};
      const w = await chain.registerWork(input, opts); // 全程唯一一次上链
      workDone = w;
      renderSuccess(w);
    } catch (e) {
      const msg = (e && e.message) || '未知错误';
      toastErr('上链失败：' + msg + '，可稍后重试');
      if (box && box.querySelector('#rgSubmit')) {
        const b = box.querySelector('#rgSubmit');
        b.disabled = false;
        b.innerHTML = `${icon('shield-check', 17)} 广播上链 · 存证确权`;
      }
    } finally {
      submitting = false;
    }
  }

  /* ---- 成功视图 ---- */
  function renderSuccess(w) {
    box = null;
    step = 0;
    el.innerHTML = successHtml(w);
    bindRoot(el);
    wireSuccess(w);
  }

  function successHtml(w) {
    const real = !!w.anchored.real;
    const gas = (w.anchored && w.anchored.gas) ? w.anchored.gas
      : txGas({ type: w.parentId ? 'version' : 'register', hash: w.anchored.hash });
    const feeTxt = gas.feeEth >= 0.001 ? gas.feeEth.toFixed(4) : gas.feeEth.toFixed(6);
    return `<div class="page rg-page">
      <style>
        .rg-cv { font-family:var(--mono); font-size:18px; font-weight:600; letter-spacing:.02em; }
        .rg-page .hashrow { display:flex; align-items:center; gap:6px; min-width:0; }
        .rg-page .hashrow code { font-family:var(--mono); font-size:11px; background:var(--panel); border:1px solid var(--line-soft);
          border-radius:6px; padding:3px 8px; color:var(--sub); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
          min-width:0; flex:1 1 auto; }
        .rg-page .hashrow .icon-btn { flex:0 0 28px; }
      </style>
      <div class="card" style="border-color:#C9DACE;padding:30px 22px;text-align:center">
        <span style="width:60px;height:60px;margin:0 auto;border-radius:50%;display:grid;place-items:center;background:var(--sage-soft);color:var(--sage-deep)">${icon('shield-check', 28)}</span>
        <div style="margin-top:14px"><span class="badge badge-sage">${icon('check-circle', 12)} 链上存证成功 · ANCHORED</span></div>
        <div class="serif" style="font-size:24px;font-weight:600;margin-top:10px">${w.kind === 'image' ? '《' : ''}${esc(w.title)}${w.kind === 'image' ? '》' : ''} 已上链确权</div>
        <div class="sub small" style="margin-top:5px">${real ? '真实链 · MetaMask' : '模拟链'} · 区块 #${w.anchored.block} · ${fmtTs(w.anchored.ts)}</div>
        <div class="row wrap" style="justify-content:center;gap:8px;margin-top:12px">
          <span class="badge badge-sage" style="font-family:var(--mono)">${w.versionNo > 1 ? 'v' + w.versionNo : '首版'}</span>
          <span class="badge badge-neutral">存证编号 CV-${padNum(w.id)}</span>
          ${w.versionNo > 1 ? `<span class="muted tiny">迭代版本 · 已挂载于根存证 CV-${padNum(w.rootId)}</span>` : ''}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-title">
          <h3>${icon('link', 15)} 链上存证凭据</h3>
          <span class="rg-cv" style="font-size:14px">CV-${padNum(w.id)}</span>
        </div>
        <div class="kv-grid">
          <div class="kv-item"><dt>存证编号</dt><dd class="rg-cv">CV-${padNum(w.id)}</dd></div>
          <div class="kv-item"><dt>版本状态</dt><dd><span class="badge badge-sage">${w.versionNo === 1 ? '首版（独立存证）' : '第 ' + w.versionNo + ' 版'}</span></dd></div>
          <div class="kv-item"><dt>区块高度</dt><dd class="mono">#${w.anchored.block}</dd></div>
          <div class="kv-item"><dt>上链时间</dt><dd>${fmtTs(w.anchored.ts)}</dd></div>
          <div class="kv-item"><dt>著作权人</dt><dd>${esc(w.authorsName || shortAddr(w.author))}</dd></div>
          <div class="kv-item"><dt>内容类型</dt><dd>${w.kind === 'image' ? 'AI 生成图片' : 'AI 生成文本'}</dd></div>
          <div class="kv-item"><dt>Gas 消耗</dt><dd class="mono">${fmtInt(gas.gasUsed)}</dd></div>
          <div class="kv-item"><dt>矿工费</dt><dd class="mono">${feeTxt} ETH</dd></div>
        </div>
        <div class="divider"></div>
        <div class="stack" style="gap:10px">
          ${hashRow('交易哈希 Transaction Hash', w.anchored.hash || '—')}
          ${hashRow('SHA-256 精确指纹', w.sha256)}
          ${hashRow(w.kind === 'image' ? '感知指纹 · pHash' : '感知指纹 · SimHash', w.kind === 'image' ? w.fp.phash : w.fp.simhash)}
          ${hashRow('原文 IPFS CID', w.cid)}
        </div>
        <div class="divider"></div>
        <div class="row wrap" style="gap:8px">
          <button class="btn btn-primary" id="actCert">${icon('download', 15)} 下载存证证书 PDF</button>
          <button class="btn btn-ghost" id="actView">${icon('eye', 15)} 查看作品详情</button>
          <button class="btn btn-neutral" data-go="works" data-params='${JSON.stringify({ focus: w.id })}'>${icon('layers', 15)} 进入存证库</button>
          <button class="btn btn-neutral" id="actAgain">${icon('plus', 15)} 再登记一笔</button>
        </div>
      </div>
      <div class="note paper" style="margin-top:14px">${icon('info', 15)}<div>证书与上表中的哈希均由浏览器本地计算；你可随时通过「存证验证」页对作品文件进行链上真伪核验。</div></div>
    </div>`;
  }

  function wireSuccess(w) {
    const c = el.querySelector('#actCert');
    if (c) c.onclick = async () => {
      c.disabled = true;
      try {
        const res = await downloadCertificate(w, { to: 'pdf' });
        toastOk(res.pdf ? '存证证书 PDF 已生成并开始下载' : '未检测到 jsPDF，已生成证书 PNG 并开始下载');
      } catch (e) { toastErr('证书生成失败：' + (e.message || '未知错误')); } finally { c.disabled = false; }
    };
    const v = el.querySelector('#actView');
    if (v) v.onclick = () => openWorkModal(w.id);
    const ag = el.querySelector('#actAgain');
    if (ag) ag.onclick = () => resetAll();
  }

  /* ---- 重置（再登记一笔） ---- */
  function resetAll() {
    step = 1; kind = 'image';
    versionOf = 0; parent = null;
    file = null; text = '';
    meta = defaultMeta();
    fpResult = null; fpSeq++;
    workDone = null; submitting = false;
    renderAll();
  }

  /* ---- 导航 ---- */
  function wireFoot() {
    if (!box) return;
    const p = box.querySelector('[data-rg=prev]');
    if (p) p.onclick = () => { if (step > 1) { step--; renderAll(); } };
    const n = box.querySelector('[data-rg=next]');
    if (n) n.onclick = () => {
      if (step === 1) { step = 2; renderAll(); }
      else if (step === 2) {
        const issue = step2Issue();
        if (issue) { toastErr(issue); return; }
        step = 3; renderAll();
      } else if (step === 3) {
        if (!fpResult) { toastErr('指纹尚未计算完成，请稍候'); return; }
        step = 4; renderAll();
      }
    };
  }

  /* ---- 启动 ---- */
  renderAll();

  return () => {};
}
