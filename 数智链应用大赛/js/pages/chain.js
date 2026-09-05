/* ===================================================================
 * chain.js — 区块链管理（仅 admin，路由级 RBAC 守卫已处理）
 * Tabs：概览 / 区块浏览器 / 交易记录 / 账户管理 / 合约配置
 * 全部 Tab 数据每次切换均重新读取链上最新数据，不做缓存。
 * =================================================================== */
import * as chain from '../core/chain.js';
import * as real from '../core/realchain.js';
import { icon, toastOk, toastErr, toastInfo, modal, confirmDialog, empty } from '../core/ui.js';
import { esc, fmtTs, fmtDate, timeAgo, shortAddr, shortHash, fmtInt, txGas } from '../core/util.js';
import { bindRoot, roleChip, avatarHTML } from './_shared.js';

/* ---------- 交易类型元数据 ---------- */
const TX_META = {
  register: { label: '存证登记', icon: 'shield-check', cls: 'badge-sage' },
  version: { label: '版本登记', icon: 'layers', cls: 'badge-ink' },
  authz: { label: '授权登记', icon: 'key', cls: 'badge-amber' },
  revoke: { label: '撤销授权', icon: 'x', cls: 'badge-neutral' },
  evidence: { label: '证据固定', icon: 'shield-alert', cls: 'badge-clay' },
  account: { label: '账户注册', icon: 'user', cls: 'badge-neutral' },
};

function txBadge(type) {
  const m = TX_META[type] || TX_META.account;
  return `<span class="badge ${m.cls}">${icon(m.icon, 11)} ${m.label}</span>`;
}

const TABS = [
  { k: 'overview', name: '概览', icon: 'activity' },
  { k: 'blocks', name: '区块浏览器', icon: 'box' },
  { k: 'txs', name: '交易记录', icon: 'history' },
  { k: 'accounts', name: '账户管理', icon: 'users' },
  { k: 'cfg', name: '合约配置', icon: 'server' },
];

const ROLE_OPTIONS = [
  ['creator', '创作者'], ['monitor', '监测机构'], ['admin', '管理员'], ['user', '普通用户'],
];

export default async function page(el) {
  const root = document.createElement('div');
  root.className = 'page';
  el.appendChild(root);

  let cur = 'overview';
  const st = { blocksShow: 25, fType: 'all', fQ: '' };

  /* EVM Gas：按交易类型 + 哈希确定性计算 */
  const gasUsedOf = (num) => chain.txs().filter((t) => t.block === num).reduce((s, t) => s + txGas(t).gasUsed, 0);
  const feeShort = (t) => {
    const g = txGas(t);
    return (g.feeEth >= 0.001 ? g.feeEth.toFixed(4) : g.feeEth.toFixed(6)) + ' ETH';
  };

  function renderShell() {
    const mode = chain.modeNow();
    root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>区块链管理</h2>
        <div class="page-sub">链上运行总览、区块与交易台账、本地账户，以及真实链（MetaMask + 本地开发链）合约集成。本页仅管理员可见。</div>
      </div>
      <div class="row wrap" style="gap:8px">
        <span class="chip">${icon(mode === 'real' ? 'link' : 'server', 12)} ${mode === 'real' ? '真实链 · MetaMask' : '模拟链 · 本地演示'}</span>
        <span class="chip">${icon('box', 12)} 区块高度 #${fmtInt(chain.blockHeight())}</span>
      </div>
    </div>
    <div class="tabs">
      ${TABS.map((t) => `<button class="tab ${cur === t.k ? 'active' : ''}" data-tab="${t.k}">${icon(t.icon, 14)} ${t.name}</button>`).join('')}
    </div>
    <div class="chain-body"></div>`;
  }

  function renderBody() {
    const body = root.querySelector('.chain-body');
    body.innerHTML = CONTENT[cur]();
    wireBody();
  }

  function goTab(k) {
    cur = k;
    if (k === 'blocks') { st.blocksShow = 25; }
    if (k === 'txs') { st.fType = 'all'; st.fQ = ''; }
    root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === k));
    renderBody();
  }

  /* ============================ Tab1 概览 ============================ */
  function contentOverview() {
    const stt = chain.chainStatus();
    const modeReal = chain.modeNow() === 'real';
    const c = chain.contracts();
    const recent = chain.blocks().slice(0, 6);
    // Gas 网络状态（EVM 特征）
    const allTx = chain.txs();
    let gasTotal = 0, feeTotal = 0;
    for (const t of allTx) { const g = txGas(t); gasTotal += g.gasUsed; feeTotal += g.feeEth; }
    const avgGwei = gasTotal ? (feeTotal * 1e9) / gasTotal : 0;
    const latest = chain.blocks()[0];
    const latestGas = latest ? gasUsedOf(latest.number) : 0;
    const gasTxt = latestGas >= 1e6 ? (latestGas / 1e6).toFixed(2) + 'M' : fmtInt(latestGas);
    return `
    <div class="stack-24">
      <div class="hero-band" style="margin-bottom:0">
        <div>
          <div class="hb-k">区块链网络</div>
          <h2>${fmtInt(stt.block)} 区块 · ${fmtInt(stt.txs)} 交易</h2>
          <div class="hb-sub">链上运行总览：区块、交易、账户与 Gas 消耗一目了然。</div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <span class="hb-chip">${icon('box', 12)} 高度 #${fmtInt(stt.block)}</span>
            <span class="hb-chip">${icon('users', 12)} ${fmtInt(stt.accounts)} 账户</span>
            <span class="hb-chip">${icon(modeReal ? 'link' : 'server', 12)} ${modeReal ? '真实链 · MetaMask' : '模拟链 · 本地演示'}</span>
          </div>
        </div>
        <div class="hb-metrics">
          <div class="hb-m"><b>${fmtInt(stt.block)}</b><span>区块高度</span></div>
          <div class="hb-m"><b>${fmtInt(stt.txs)}</b><span>交易总数</span></div>
          <div class="hb-m"><b>${fmtInt(stt.accounts)}</b><span>账户数</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><h3>${icon('activity', 15)} Gas 网络状态 · Gas</h3>
          <span class="chip">${modeReal ? '真实链回执' : '模拟 EVM 引擎'}</span></div>
        <div class="grid grid-4">
          <div class="stat"><div class="stat-icon">${icon('zap', 17)}</div><div class="stat-num">${fmtInt(gasTotal)}</div><div class="stat-label">累计 Gas 消耗</div><div class="stat-sub">Gas Used（全部交易）</div></div>
          <div class="stat"><div class="stat-icon">${icon('sliders', 17)}</div><div class="stat-num" style="font-size:22px">${avgGwei.toFixed(1)}</div><div class="stat-label">平均 Gas 价格</div><div class="stat-sub">gwei（含小费）</div></div>
          <div class="stat"><div class="stat-icon">${icon('box', 17)}</div><div class="stat-num" style="font-size:22px">${gasTxt}</div><div class="stat-label">最新区块 Gas</div><div class="stat-sub">区块 #${fmtInt(latest ? latest.number : 0)}</div></div>
          <div class="stat"><div class="stat-icon" style="background:var(--clay-soft);color:var(--clay-deep)">${icon('send', 17)}</div><div class="stat-num" style="font-size:22px">${feeTotal.toFixed(4)}</div><div class="stat-label">累计矿工费</div><div class="stat-sub">ETH</div></div>
        </div>
      </div>

      <div>
        <div class="sec-kicker">智能合约 · Contracts</div>
        <div class="grid grid-2">
          ${contractCard('CopyrightVault', 'CopyrightVault.sol', '内容存证登记、迭代版本链管理、商用/转载/改编授权登记与撤销。', c.vault.real, c.vault.mock)}
          ${contractCard('EvidenceAnchor', 'EvidenceAnchor.sol', '将侵权检测结论的报告哈希与 IPFS CID 上链锚定，供维权取证核验。', c.anchor.real, c.anchor.mock)}
        </div>
      </div>

      <div class="card">
        <div class="card-title"><h3>${icon('box', 15)} 最近区块</h3>
          <button class="btn btn-neutral btn-sm" data-tab="blocks">${icon('arrow-right', 13)} 区块浏览器</button></div>
        ${recent.length === 0 ? empty('box', '暂无区块', '链上尚未产生任何区块') : `
        <div class="stack" style="gap:0">${recent.map((b) => `
          <div class="list-row" style="cursor:pointer" data-tab="blocks">
            <span class="mono accent-sage" style="font-size:12.5px;font-weight:600;flex:0 0 64px">#${fmtInt(b.number)}</span>
            <button class="icon-btn" data-copy="${esc(b.hash)}" title="复制区块哈希" style="width:26px;height:26px;flex:0 0 26px">${icon('copy', 13)}</button>
            <span class="mono-sm muted grow ellip">${esc(shortHash(b.hash, 12))}</span>
            <span class="chip">${b.count} 笔 · Gas ${fmtInt(gasUsedOf(b.number))}</span>
            <span class="muted tiny" style="min-width:58px;text-align:right">${timeAgo(b.ts)}</span>
          </div>`).join('')}</div>`}
      </div>

      <div class="card" style="border-color:#E9D6CD">
        <div class="card-title"><h3 style="color:#7d4431">${icon('alert-triangle', 15)} 危险操作</h3></div>
        <div class="row-between wrap" style="gap:12px">
          <div class="small sub" style="flex:1;min-width:240px">一键重建演示现场：清空全部作品、授权、侵权证据、检测记录与区块/交易台账，随后重新生成演示数据。</div>
          <button class="btn btn-danger btn-sm" data-act="reset">${icon('trash', 14)} 重置链演示数据</button>
        </div>
        <div class="note paper" style="margin-top:14px">${icon('info', 15)}<div><b>说明：</b>重置仅作用于本地模拟链与本地索引（localStorage），不会影响真实链（链上合约）中的存证记录。</div></div>
      </div>
    </div>`;
  }

  function contractCard(name, file, duty, realAddr, mockAddr) {
    const modeReal = chain.modeNow() === 'real';
    const val = modeReal ? realAddr : mockAddr;
    const deployed = !!val;
    let status = '';
    let addrLine = '';
    if (!modeReal) {
      status = '<span class="badge badge-sage">模拟链内建</span>';
      addrLine = `<div class="small muted">本地模拟部署，随演示数据自动就绪，无需外部地址。</div>`;
    } else if (deployed) {
      status = '<span class="badge badge-sage">已部署</span>';
      addrLine = `
        <div class="hashrow" style="margin-top:8px"><code style="flex:1 1 auto">${esc(val)}</code>
        <button class="icon-btn" data-copy="${esc(val)}" title="复制地址">${icon('copy', 14)}</button></div>`;
    } else {
      status = '<span class="badge badge-neutral">未部署 / 未配置</span>';
      addrLine = `
        <div class="small muted" style="margin-top:6px">尚未配置真实链部署地址，存证与证据类上链操作将不可用。</div>
        <button class="btn btn-neutral btn-sm" data-tab="cfg" style="margin-top:10px">${icon('settings', 13)} 前往合约配置</button>`;
    }
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('hexagon', 15)} ${esc(name)}</h3>${status}</div>
      <div class="kv" style="grid-template-columns:84px 1fr">
        <dt>源文件</dt><dd><span class="mono-sm">${esc(file)}</span></dd>
        <dt>职责</dt><dd class="small">${esc(duty)}</dd>
        <dt>地址</dt><dd style="grid-column:1/3;padding-top:4px">${addrLine}</dd>
      </div>
    </div>`;
  }

  /* ============================ Tab2 区块浏览器 ============================ */
  function blkRowHTML(b) {
    return `
    <div class="blk-row" data-blk="${b.number}">
      <div class="row blk-head" data-act="blk" data-b="${b.number}" style="cursor:pointer;padding:10px 4px;border-bottom:1px solid var(--line-soft)">
        <span class="mono accent-sage" style="font-size:12.5px;font-weight:600;flex:0 0 70px">#${fmtInt(b.number)}</span>
        <button class="icon-btn" data-copy="${esc(b.hash)}" title="复制区块哈希" style="width:26px;height:26px;flex:0 0 26px">${icon('copy', 13)}</button>
        <span class="mono-sm muted grow ellip">${esc(shortHash(b.hash, 12))}</span>
        <span class="chip">${b.count} 笔 · Gas ${fmtInt(gasUsedOf(b.number))}</span>
        <span class="muted tiny" style="flex:0 0 62px;text-align:right">${timeAgo(b.ts)}</span>
        ${icon('chevron-down', 15)}
      </div>
      <div class="blk-open" style="display:none;padding:2px 4px 12px"></div>
    </div>`;
  }

  function blkTxsHTML(txs) {
    if (!txs.length) return '<div class="small muted" style="padding:8px 10px 2px">该区块内暂无交易记录。</div>';
    return `<div class="mini-tx" style="padding:10px 10px 2px">${txs.map((t) => {
      const m = TX_META[t.type] || TX_META.account;
      return `
      <div class="mini-tx-item">
        <span class="mtx-ic ${t.type === 'evidence' ? 'clay' : ''}">${icon(m.icon, 15)}</span>
        <span class="mtx-main">
          <span class="mtx-t">${esc(t.label)} <span class="muted tiny">${txBadge(t.type)}</span></span>
          <span class="mtx-s"><span class="hash-inline">${esc(shortHash(t.hash, 10))}</span>
          <button class="icon-btn" data-copy="${esc(t.hash)}" title="复制交易哈希" style="width:20px;height:20px">${icon('copy', 11)}</button>
          <span>${esc(shortAddr(t.from))}</span><span>${fmtTs(t.ts)}</span>
          <span class="hash-inline">gas ${fmtInt(txGas(t).gasUsed)}</span></span>
        </span>
      </div>`;
    }).join('')}</div>`;
  }

  function contentBlocks() {
    const all = chain.blocks();
    const shown = all.slice(0, st.blocksShow);
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('box', 15)} 区块浏览器</h3><span class="chip">区块高度 #${fmtInt(all.length)}</span></div>
      ${all.length === 0 ? empty('box', '暂无区块', '链上尚未产生任何区块') : `
      <div class="stack" style="gap:0">
        ${shown.map(blkRowHTML).join('')}
      </div>
      ${st.blocksShow < all.length
        ? `<div class="row" style="justify-content:center;padding-top:12px"><button class="btn btn-neutral btn-sm" data-act="blkmore">${icon('chevron-down', 14)} 加载更多（显示 ${shown.length} / ${all.length}）</button></div>`
        : `<div class="kicker" style="text-align:center;margin-top:14px">已加载全部 ${all.length} 个区块</div>`}
      `}
    </div>`;
  }

  /* ============================ Tab3 交易记录 ============================ */
  function filterTxs() {
    const q = st.fQ.trim().toLowerCase();
    return chain.txs().filter((t) => {
      if (st.fType !== 'all' && t.type !== st.fType) return false;
      if (!q) return true;
      return (t.hash || '').toLowerCase().includes(q) || (t.from || '').toLowerCase().includes(q);
    });
  }

  function txRowsHTML(list) {
    if (!list.length) {
      return `<tr><td colspan="9"><div class="empty">${icon('search', 30)}<b>无匹配交易</b><span>换一个类型或搜索关键词试试</span></div></td></tr>`;
    }
    return list.map((t) => {
      const g = txGas(t);
      return `
    <tr>
      <td>
        <div class="hashrow" style="max-width:200px"><code>${esc(shortHash(t.hash, 10))}</code>
        <button class="icon-btn" data-copy="${esc(t.hash)}" title="复制交易哈希">${icon('copy', 13)}</button></div>
      </td>
      <td>${txBadge(t.type)}</td>
      <td><span class="td-main">${esc(t.label)}</span><div class="td-sub mono-sm">${esc(t.action || '')}</div></td>
      <td><span class="mono-sm" title="${esc(t.from)}">${esc(shortAddr(t.from))}</span></td>
      <td><span class="mono-sm">#${fmtInt(t.block)}</span></td>
      <td><span class="muted small">${fmtTs(t.ts)}</span></td>
      <td><span class="mono-sm">${fmtInt(g.gasUsed)}</span></td>
      <td><span class="mono-sm" style="color:var(--sage-deep)" title="${g.gasPriceGwei} gwei · GasPrice">${feeShort(t)}</span></td>
      <td><span class="badge badge-sage">已确认</span></td>
    </tr>`;
    }).join('');
  }

  function contentTxs() {
    const all = chain.txs();
    const shown = filterTxs();
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('history', 15)} 交易记录</h3><span class="chip" id="txChip">共 ${fmtInt(all.length)} 笔</span></div>
      <div class="row wrap" style="gap:10px;margin-bottom:12px">
        <select class="select" id="txType" style="width:auto;min-width:150px;padding:7px 30px 7px 10px;font-size:12.5px">
          <option value="all">全部类型</option>
          <option value="register">存证登记</option>
          <option value="version">版本登记</option>
          <option value="authz">授权登记</option>
          <option value="revoke">授权撤销</option>
          <option value="evidence">证据固定</option>
          <option value="account">账户注册</option>
        </select>
        <div class="grow" style="position:relative;max-width:440px;min-width:220px">
          <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted);display:grid;place-items:center">${icon('search', 15)}</span>
          <input class="input" id="txQ" placeholder="按交易哈希 / 发起地址过滤…" value="${esc(st.fQ)}" style="padding-left:34px">
        </div>
        <span class="muted small" id="txMatch">${shown.length !== all.length ? `命中 ${shown.length} 笔` : ''}</span>
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>交易哈希</th><th>类型</th><th>动作</th><th>发起地址</th><th>区块</th><th>时间</th><th>Gas 消耗</th><th>Gas 费</th><th>状态</th></tr></thead>
          <tbody id="txRows">${txRowsHTML(shown)}</tbody>
        </table>
      </div>
    </div>`;
  }

  /* ============================ Tab4 账户管理 ============================ */
  function contentAccounts() {
    const me = chain.active();
    const accs = chain.accounts();
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('users', 15)} 账户管理</h3>
        <button class="btn btn-primary btn-sm" data-act="accnew">${icon('plus', 14)} 新建账户</button></div>
      ${accs.length === 0 ? empty('users', '暂无账户', '创建第一个本地演示账户') : `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>账户</th><th>地址</th><th>角色</th><th>创建时间</th><th>链上交易</th><th>操作</th></tr></thead>
          <tbody>
            ${accs.map((a) => `
            <tr ${a.addr === me.addr ? 'style="background:var(--sage-ghost)"' : ''}>
              <td>
                <div class="row" style="gap:10px">
                  ${avatarHTML(a.name, a.addr, 34)}
                  <div style="min-width:0">
                    <div class="td-main">${esc(a.name)} ${a.addr === me.addr ? '<span class="badge badge-sage">当前账户</span>' : ''}</div>
                    <div class="td-sub">加入于 ${fmtDate(a.createdAt)}</div>
                  </div>
                </div>
              </td>
              <td>
                <div class="hashrow" style="max-width:200px"><code>${esc(shortAddr(a.addr, 8, 6))}</code>
                <button class="icon-btn" data-copy="${esc(a.addr)}" title="复制完整地址">${icon('copy', 13)}</button></div>
              </td>
              <td>${roleChip(a.role)}</td>
              <td><span class="muted small">${fmtTs(a.createdAt)}</span></td>
              <td><span class="mono-sm">${fmtInt(a.txs || 0)}</span></td>
              <td>
                <div class="row" style="gap:6px">
                  ${a.addr === me.addr
                    ? '<span class="btn btn-soft btn-sm" style="cursor:default;opacity:.85">当前身份</span>'
                    : `<button class="btn btn-soft btn-sm" data-act="accswitch" data-addr="${esc(a.addr)}">${icon('user', 13)} 设为当前</button>`}
                  <button class="btn btn-neutral btn-sm" data-act="accrename" data-addr="${esc(a.addr)}" data-name="${esc(a.name)}">${icon('feather-pen', 13)} 编辑昵称</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="note paper" style="margin-top:14px">${icon('info', 15)}<div>钱包地址即账户。新建账户会广播一笔「账户注册」交易并切换为当前身份；点击「设为当前」可在演示身份间自由切换以观察 RBAC 差异。</div></div>
      `}
    </div>`;
  }

  /* ============================ Tab5 合约配置 ============================ */
  function contentCfg() {
    const cfg = chain.realCfg();
    return `
    <div class="card">
      <div class="card-title"><h3>${icon('link', 15)} 真实链合约配置</h3><span class="chip">MetaMask · 本地开发链</span></div>
      <div class="note paper" style="margin-bottom:16px">${icon('info', 15)}<div>真实链模式下，系统经由 MetaMask 调用 <b>CopyrightVault</b>（内容存证 / 授权）与 <b>EvidenceAnchor</b>（侵权证据锚定）两个合约。此处粘贴本地 anvil 或测试网部署后的合约地址即可。</div></div>
      <div class="stack">
        <div class="field"><span class="field-label">CopyrightVault 合约地址</span>
          <input class="input mono" id="cfgVault" placeholder="0x… 40 位十六进制地址" value="${esc(cfg.vault || '')}" spellcheck="false"></div>
        <div class="field"><span class="field-label">EvidenceAnchor 合约地址</span>
          <input class="input mono" id="cfgAnchor" placeholder="0x… 40 位十六进制地址" value="${esc(cfg.anchor || '')}" spellcheck="false"></div>
      </div>
      <div class="row wrap" style="margin-top:18px;gap:10px">
        <button class="btn btn-primary btn-sm" data-act="cfgsave">${icon('check', 14)} 保存配置</button>
        <button class="btn btn-soft btn-sm" data-act="cfgconnect">${icon('link', 14)} 连接检测</button>
        <button class="btn btn-neutral btn-sm" data-act="cfgguide">${icon('book-open', 14)} 部署指引</button>
      </div>
      <div class="divider"></div>
      <div class="row wrap" style="gap:8px">
        <span class="chip">当前模式：${chain.modeNow() === 'real' ? '真实链' : '模拟链'}</span>
        <span class="chip">MetaMask：${real.hasEthers() ? '已检测到' : '未检测到'}</span>
        <span class="chip">建议 RPC：http://127.0.0.1:8545</span>
      </div>
    </div>`;
  }

  /* ---------- Tab 内容注册表 ---------- */
  const CONTENT = {
    overview: contentOverview,
    blocks: contentBlocks,
    txs: contentTxs,
    accounts: contentAccounts,
    cfg: contentCfg,
  };

  /* ============================ 交互动作 ============================ */
  function wireBody() {
    const body = root.querySelector('.chain-body');
    if (cur === 'txs') {
      const typeSel = body.querySelector('#txType');
      const qIn = body.querySelector('#txQ');
      const refresh = () => {
        st.fType = typeSel.value;
        st.fQ = qIn.value;
        const shown = filterTxs();
        body.querySelector('#txRows').innerHTML = txRowsHTML(shown);
        const all = chain.txs();
        body.querySelector('#txMatch').textContent = shown.length !== all.length ? `命中 ${shown.length} 笔` : '';
      };
      typeSel.value = st.fType || 'all';
      typeSel.addEventListener('change', refresh);
      qIn.addEventListener('input', refresh);
    }
  }

  async function actMode() {
    const target = chain.modeNow() === 'real' ? 'mock' : 'real';
    try {
      const res = await chain.setMode(target);
      if (res && res.ok) toastOk(res.msg || '已切换链模式');
      else toastErr((res && res.msg) || '链模式切换失败');
    } catch (e) {
      toastErr('链模式切换失败：' + (e && e.message ? e.message : '未知错误'));
    }
  }

  async function actReset() {
    const ok = await confirmDialog({
      title: '重置链演示数据', okText: '确认重置', danger: true,
      text: '将清空全部作品 / 授权 / 侵权证据 / 检测记录与区块、交易台账，并重新生成演示数据。此操作不可撤销，是否继续？',
    });
    if (!ok) return;
    try {
      await chain.resetChain();
      toastOk('演示数据已重置，正在返回数据看板…');
    } catch (e) {
      toastErr('重置失败：' + (e && e.message ? e.message : '未知错误'));
    }
    location.hash = '#/dashboard';
  }

  function openNewAccount() {
    if (chain.modeNow() === 'real') {
      toastErr('真实链模式下请使用 MetaMask 钱包创建账户，本页仅管理模拟链账户');
      return;
    }
    const m = modal({ title: '新建模拟链账户', size: 'sm',
      body: `<div class="stack">
        <div class="field"><span class="field-label">账户名称（昵称）</span><input class="input" id="naName" maxlength="16" placeholder="例如：新增创作者"></div>
        <div class="field"><span class="field-label">角色身份</span>
          <select class="select" id="naRole">${ROLE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <div class="note paper">${icon('info', 15)}<div>系统将自动生成新的模拟地址并广播一笔「账户注册」交易，随后切换为新账户身份。</div></div>
      </div>`,
      foot: '<button class="btn btn-neutral btn-sm" data-c="c">取消</button><button class="btn btn-primary btn-sm" data-c="ok">创建账户</button>' });
    m.footBox.querySelector('[data-c=c]').onclick = m.close;
    m.footBox.querySelector('[data-c=ok]').onclick = () => {
      const name = (m.box.querySelector('#naName').value || '').trim();
      const role = m.box.querySelector('#naRole').value;
      if (!name) { toastErr('请填写账户名称'); return; }
      const acc = chain.addAccount({ name, role });
      m.close();
      toastOk(`账户「${acc.name}」已创建并切换为当前身份`);
      chain.emit('session'); // 让壳与当前页面按新身份刷新（RBAC 守卫会据此重定向）
    };
  }

  function renameAccount(addr, oldName) {
    const m = modal({ title: '编辑账户昵称', size: 'sm',
      body: `<div class="field"><span class="field-label">账户昵称</span><input class="input" id="rnName" maxlength="16" value="${esc(oldName)}"></div>`,
      foot: '<button class="btn btn-neutral btn-sm" data-c="c">取消</button><button class="btn btn-primary btn-sm" data-c="ok">保存</button>' });
    m.footBox.querySelector('[data-c=c]').onclick = m.close;
    m.footBox.querySelector('[data-c=ok]').onclick = () => {
      const v = (m.box.querySelector('#rnName').value || '').trim();
      if (!v) { toastErr('昵称不能为空'); return; }
      chain.renameAccount(addr, v);
      m.close();
      toastOk('账户昵称已更新');
    };
  }

  async function actSwitch(addr) {
    const target = chain.accounts().find((a) => a.addr === addr);
    if (!target) return;
    if (chain.switchAccount(addr)) {
      toastInfo(`已切换为当前账户：${target.name}`);
    }
  }

  function saveCfg() {
    const vault = (root.querySelector('#cfgVault').value || '').trim();
    const anchor = (root.querySelector('#cfgAnchor').value || '').trim();
    const hexRe = /^0x[0-9a-fA-F]{40}$/;
    if (vault && !hexRe.test(vault)) { toastErr('CopyrightVault 地址格式不正确（应为 0x + 40 位十六进制）'); return; }
    if (anchor && !hexRe.test(anchor)) { toastErr('EvidenceAnchor 地址格式不正确（应为 0x + 40 位十六进制）'); return; }
    const old = chain.realCfg();
    real.saveConfig({ vault, anchor, rpc: old.rpc || '' });
    toastOk('合约配置已保存，可点击「连接检测」验证连通性');
  }

  async function connectCheck(btn) {
    if (!real.hasEthers()) {
      toastErr('未检测到 MetaMask（window.ethereum），请安装浏览器钱包扩展后重试');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = icon('circle-dot', 14) + ' 连接检测中…';
    try {
      const { signer } = await real.getSigner();
      const addr = await signer.getAddress();
      const total = await real.totalWorks();
      toastOk(`已连接 · 钱包 ${shortAddr(addr)} · 合约总存证数 ${fmtInt(total)} 件`);
    } catch (e) {
      toastErr('连接失败：' + (e && e.message ? e.message : '未知错误'));
    } finally {
      btn.disabled = false;
      btn.innerHTML = icon('link', 14) + ' 连接检测';
    }
  }

  function guideModal() {
    const m = modal({ title: '本地链部署指引（Foundry + MetaMask）', size: 'lg',
      body: guideBody(),
      foot: '<button class="btn btn-neutral btn-sm" data-c="c">关闭</button>' });
    m.footBox.querySelector('[data-c=c]').onclick = m.close;
  }

  function guideBody() {
    const cmd = (t) => `<div style="font-family:var(--mono);font-size:11.5px;line-height:1.8;background:var(--panel);border:1px solid var(--line-soft);border-radius:7px;padding:8px 11px;color:#4A4A45;word-break:break-all;margin-top:6px">${esc(t)}</div>`;
    const step = (no, t, inner) => `
    <div style="display:flex;gap:12px;padding:2px 0 16px">
      <span style="flex:0 0 24px;height:24px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--muted)">${no}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;margin-bottom:2px">${esc(t)}</div>
        ${inner}
      </div>
    </div>`;
    return `
    <div style="max-height:58vh;overflow-y:auto;padding-right:6px">
      <div class="note paper" style="margin-bottom:16px">${icon('info', 15)}<div><b>提示：</b>以下为纯展示性指引。真实链演示建议在本地起一条 anvil 开发链，配合 MetaMask 使用；跳过部署时系统会安全回退到模拟链。</div></div>
      ${step('1', '准备环境', `
        <div class="small sub">安装 Foundry 后执行 <span class="mono-sm">foundryup</span>；仓库已内置 contracts/ 目录。安装 MetaMask 扩展并添加本地网络：</div>
        <div class="small sub" style="margin-top:4px">RPC URL：<span class="mono-sm">http://127.0.0.1:8545</span> · Chain ID：<span class="mono-sm">31337</span> · 货币：ETH</div>`)}
      ${step('2', '编译与测试（contracts 目录）', cmd('cd contracts\nforge build\nforge test'))}
      ${step('3', '启动本地开发链', `
        <div class="small sub">终端 A 运行 anvil（默认派生 10 个测试账户，私钥打印在启动日志中）：</div>${cmd('anvil')}
        <div class="small sub" style="margin-top:4px">如需使用脚本一键部署（推荐），可跳过第 4、5 步。</div>`)}
      ${step('4', '部署 CopyrightVault（终端 B）', cmd('forge create src/CopyrightVault.sol:CopyrightVault --rpc-url http://127.0.0.1:8545 --private-key <ANVIL_PRIVATE_KEY>'))}
      ${step('5', '部署 EvidenceAnchor（终端 B）', cmd('forge create src/EvidenceAnchor.sol:EvidenceAnchor --rpc-url http://127.0.0.1:8545 --private-key <ANVIL_PRIVATE_KEY>'))}
      ${step('6', '（可选）脚本一键部署', cmd('forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast'))}
      ${step('7', '接入应用', `
        <div class="small sub">将第 4、5 步输出日志中的 <b>Deployed to</b> 地址分别复制到上方「CopyrightVault / EvidenceAnchor」输入框并保存；随后点击「连接检测」确认合约可读，再于右上角切换到真实链模式即可上链演示。</div>`)}
    </div>`;
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-copy]') || e.target.closest('[data-go]')) return;
    const tb = e.target.closest('[data-tab]');
    if (tb) { e.preventDefault(); goTab(tb.getAttribute('data-tab')); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const action = act.getAttribute('data-act');
    const num = act.getAttribute('data-b') !== null ? Number(act.getAttribute('data-b')) : NaN;
    if (action === 'blk') {
      const row = act.closest('.blk-row');
      const openEl = row ? row.querySelector('.blk-open') : null;
      if (!openEl) return;
      const isOpen = openEl.style.display !== 'none';
      if (isOpen) { openEl.style.display = 'none'; return; }
      openEl.innerHTML = blkTxsHTML(chain.txs().filter((t) => t.block === num));
      openEl.style.display = 'block';
      return;
    }
    if (action === 'blkmore') { st.blocksShow += 20; renderBody(); return; }
    if (action === 'mode') { actMode(); return; }
    if (action === 'reset') { actReset(); return; }
    if (action === 'accnew') { openNewAccount(); return; }
    if (action === 'accswitch') { actSwitch(act.getAttribute('data-addr')); return; }
    if (action === 'accrename') { renameAccount(act.getAttribute('data-addr'), act.getAttribute('data-name') || ''); return; }
    if (action === 'cfgsave') { saveCfg(); return; }
    if (action === 'cfgconnect') { connectCheck(act); return; }
    if (action === 'cfgguide') { guideModal(); return; }
  });

  renderShell();
  renderBody();
  bindRoot(el);

  return () => {};
}
