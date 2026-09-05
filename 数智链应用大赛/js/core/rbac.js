/* ===================================================================
 * rbac.js — 角色权限体系与导航模型
 * 四种角色：管理员 / 创作者 / 监测机构 / 普通用户
 * =================================================================== */

export const ROLES = {
  admin: { key: 'admin', label: '管理员', desc: '全网运营视角：链上治理、全部存证与监测数据。', tone: 'slate' },
  creator: { key: 'creator', label: '创作者', desc: '作品存证确权、授权管理、自有版权监测。', tone: 'sage' },
  monitor: { key: 'monitor', label: '监测机构', desc: '全网侵权监测与维权证据管理。', tone: 'clay' },
  user: { key: 'user', label: '普通用户', desc: '只读访问：公开指标与存证真伪验证。', tone: 'sand' },
};

export const roleLabel = (r) => (ROLES[r] ? ROLES[r].label : '未知身份');
export const roleDesc = (r) => (ROLES[r] ? ROLES[r].desc : '');

/* ---------- 页面 / 路由定义 ---------- */
/* roles: 允许访问的角色；perm 供操作级守卫使用 */
export const PAGES = {
  dashboard: { name: '数据看板', icon: 'activity', group: '总览', roles: ['admin', 'creator', 'monitor', 'user'] },
  register: { name: '存证登记', icon: 'file-plus', group: '存证与确权', roles: ['admin', 'creator'] },
  works: { name: '存证库', icon: 'layers', group: '存证与确权', roles: ['admin', 'creator', 'monitor'] },
  authz: { name: '授权管理', icon: 'key', group: '存证与确权', roles: ['admin', 'creator'] },
  detect: { name: '侵权检测', icon: 'scan', group: '监测与维权', roles: ['admin', 'creator', 'monitor'] },
  evidence: { name: '证据中心', icon: 'shield-alert', group: '监测与维权', roles: ['admin', 'creator', 'monitor'] },
  chain: { name: '区块链管理', icon: 'hexagon', group: '链上治理', roles: ['admin'] },
  verify: { name: '存证验证', icon: 'shield-check', group: '公开工具', roles: ['admin', 'creator', 'monitor', 'user'] },
  wallet: { name: '我的钱包', icon: 'wallet', group: '个人', roles: ['admin', 'creator', 'monitor', 'user'] },
  account: { name: '个人中心', icon: 'user', group: '个人', roles: ['admin', 'creator', 'monitor', 'user'] },
};

/** 某角色可访问页面 key 列表 */
export function pagesFor(role) {
  return Object.entries(PAGES).filter(([, p]) => p.roles.includes(role)).map(([k]) => k);
}

export function canAccess(route, role) {
  const p = PAGES[route];
  return !!(p && p.roles.includes(role));
}

/** 按组聚合生成侧栏导航（按角色过滤） */
export function navGroupsFor(role) {
  const order = ['总览', '存证与确权', '监测与维权', '链上治理', '公开工具', '个人'];
  const groups = {};
  for (const [key, p] of Object.entries(PAGES)) {
    if (!p.roles.includes(role)) continue;
    (groups[p.group] = groups[p.group] || []).push({ key, name: p.name, icon: p.icon });
  }
  const out = [];
  for (const g of order) if (groups[g]) out.push({ label: g, items: groups[g] });
  return out;
}
