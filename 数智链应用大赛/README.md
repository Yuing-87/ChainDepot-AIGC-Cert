# 链证 ChainVault · 基于区块链的 AIGC 内容版权存证与侵权检测系统

> 为 AIGC 创作者提供「**存证确权 → 侵权检测 → 证据固定 → 一键维权**」完整闭环的区块链应用。
> 一次本地运行即可现场演示全部流程：**无钱包、无插件、无网络也能跑**。

---

## 一、项目简介

AI 生成内容（AIGC）爆发式增长，但 AI 生成物**版权归属难证明、侵权难发现、维权缺证据**。

本系统为创作者提供一套可被验证、可被举证的版权保护基础设施：

1. **存证确权** —— 图片 / 文本上传后，在**浏览器本地**完成 SHA-256 精确指纹、图片 pHash（DCT 感知哈希）、文本 SimHash 提取，将指纹与创作元数据写入链上 `CopyrightVault` 合约，生成可验证的**存证证书 PDF**；
2. **侵权检测** —— 两级比对（指纹海明粗筛 + 语义向量精排），输出相似度、命中作品与**差异可视化**（图片差异高亮 / 文本片段标红），阈值滑杆实时调节判定；
3. **证据固定** —— 命中后自动生成带时间戳水印的取证截图，检测报告与相似度结论**二次上链**至 `EvidenceAnchor` 合约；
4. **一键维权** —— 导出维权证据包 ZIP（侵权截图 + 原作存证证书 + 链上交易哈希 + 完整检测报告），报告哈希链上可核验。

系统内置 **RBAC 角色权限体系**（管理员 / 创作者 / 监测机构 / 普通用户），导航、看板统计、页面内容随角色差异化呈现，并支持一键身份切换，适合评审现场演示。

> **核心隐私卖点：所有指纹算法均在浏览器本地执行，原文与文件内容永不离开创作者设备、永不传输到服务器。** 上链的只有不可逆的哈希与元数据摘要。

---

## 二、功能一览

| 模块 | 说明 |
| --- | --- |
| 用户管理 | 钱包地址即账户；模拟链可创建/切换账户；个人中心；四种 RBAC 角色 + 页面级 / 操作级守卫 + 一键身份切换器 |
| 内容存证 | 图片 / 文本上传，4 步向导（选类型→录元数据→本地算指纹→上链存证）；版本链迭代关联；PDF 存证证书；公开存证验证 |
| 侵权检测 | 两级比对（L1 指纹海明 + L2 语义向量，L2 为浏览器端演示实现）；相似度阈值滑杆；差异可视化报告 |
| 证据固定 | 时间戳水印取证截图 + 检测报告 + 结论**二次上链**；维权证据包 ZIP 一键导出 |
| 区块链管理 | 双合约状态、区块浏览器、交易记录、账户管理、合约地址配置、真实链（MetaMask）接入检测、链重置 |
| Gas 链上特征 | EVM 风格 Gas 引擎：每笔交易按类型派生 GasUsed/GasPrice/矿工费（模拟链确定性生成，真实链读取链上回执）；区块累计 Gas、网络 Gas 概况，在链管理/成功页/详情弹窗全程可见 |
| 数据看板 | 全网 / 个人 / 监测 / 公开只读四种视角；近 14 日存证·证据双柱趋势（手写 SVG）；最新上链交易与存证 |
| 钱包与奖励 | 链证积分（CVT）激励机制：确权存证 / 版本迭代 / 固定证据 / 命中监测自动计奖；余额顶栏实时可见；钱包页展示积分规则与逐笔交易流水（关联链上哈希）；每个账户可领一次演示空投 |

---

## 三、技术架构

```
┌──────────────────────────── 浏览器（前端 · 纯静态 ES Modules） ────────────────────────────┐
│  视图层：Vue-free SPA ───────────────────────────────────────────────────────────────    │
│  RBAC 导航 / 角色看板 / 4步存证向导 / 侵权检测 / 证据中心 / 链管理 / 存证验证 / 个人中心          │
│                                                                                              │
│  隐私计算层（全部本地，原文零上传）                                                            │
│    SHA-256（WebCrypto，纯 JS 兜底） · 图片 pHash(DCT)+色块向量 · 文本 SimHash · TF-IDF 余弦     │
│                                                                                              │
│  链访问层（Chain Adapter，一键切换）                                                          │
│    ┌──────────────────────────┐        ┌────────────────────────────────────────────┐      │
│    │ 模拟链模式（默认）        │        │ 真实链模式                                  │      │
│    │ localStorage 区块/交易/账户│        │ Ethers.js v6 + MetaMask + 本地链(anvil)      │      │
│    │ 事件：挖矿/确认实时展示     │        │ CopyrightVault / EvidenceAnchor 部署地址可配  │      │
│    └──────────────────────────┘        └────────────────────────────────────────────┘      │
│                                                                                              │
│  存储抽象层：IPFS（无 API Key 自动降级为“内容派生 CID”本地模拟，离线可用）                       │
│  导出层：Canvas 证书排版 → jsPDF(PDF) · JSZip(维权证据包 ZIP)                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │  上链（哈希 + 元数据摘要）
                                   ▼
        ┌─────────────────────────────── 本地测试链（Foundry/anvil） ───────────────────┐
        │  CopyrightVault.sol           版权存证：registerWork / registerVersion /        │
        │                                grantAuthorization / verifyByHash / 版本链查询    │
        │  EvidenceAnchor.sol           证据固定：anchorEvidence / getEvidence / verifyEvidence │
        │  依赖：OpenZeppelin (Ownable, ReentrancyGuard)                                   │
        └───────────────────────────────────────────────────────────────────────────────────┘
```

### 目录结构

```
├─ index.html                入口（加载本地化第三方库：ethers/jspdf/jszip）
├─ serve.ps1                 零依赖静态服务器（PowerShell，无需 Node/Python）
├─ css/                      设计系统（暖白雪麻 · 鼠尾草绿，双样式表）
├─ js/
│  ├─ main.js                壳：导航 / RBAC 路由守卫 / 身份切换器 / 链模式切换
│  ├─ core/                  核心模块
│  │   ├─ chain.js           链门面：账户/区块/交易/存证/版本/授权/证据/种子数据（模拟链）
│  │   ├─ realchain.js       真实链适配：MetaMask + Ethers v6
│  │   ├─ rbac.js            四种角色与页面权限模型
│  │   ├─ hash.js            SHA-256（WebCrypto + 纯 JS 降级）
│  │   ├─ phash.js           图片 pHash（DCT）+ 192 维色块向量
│  │   ├─ simhash.js         文本 SimHash + TF-IDF 余弦
│  │   ├─ detect.js          两级比对管线与差异可视化计算
│  │   ├─ ipfs.js            IPFS 抽象（无 Key → 本地 CID 模拟）
│  │   ├─ cert.js            证书/取证快照排版、离屏渲染、PDF/ZIP 导出
│  │   ├─ charts.js          手写 SVG 趋势图与环形图
│  │   ├─ art.js             确定性程序化示例“AI 作品”（演示数据与一键示例）
│  │   ├─ ui.js / util.js    图标库 / Toast / 模态 / 工具
│  ├─ pages/                 十个路由页面（数据看板/登记/存证库/检测/证据/授权/链管理/验证/钱包/个人中心）
├─ contracts/                Foundry 合约工程
│  ├─ src/CopyrightVault.sol    版权存证合约
│  ├─ src/EvidenceAnchor.sol    侵权证据合约
│  ├─ test/Copyright.t.sol      Foundry 测试（8 组用例）
│  ├─ script/Deploy.s.sol        一键部署脚本
│  └─ foundry.toml
└─ lib/                      本地化的 ethers / jspdf / jszip（离线演示保障）
```

---

## 四、运行方式

### 4.1 前端（演示主路径，无需任何环境依赖）

Windows 下双击或在终端执行（仓库已内置零依赖服务器）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8123
```

浏览器打开 **http://localhost:8123** 即可。首次进入自动播种完整演示数据（作品、版本链、授权、检测与侵权证据、区块与交易台账）。

> 也可以用任意静态服务器，如 `python -m http.server 8123`、`npx serve`、VS Code Live Server。
> 打开 `index.html` 使用 `file://` 协议时个别模块需要 HTTP 环境，请使用上方任一静态服务方式。

**前端内全部流程默认跑在「模拟链模式」**（localStorage 模拟区块/交易/账户/挖矿确认），评委无钱包、无插件、断网也能完整演示。右上角一键切换「真实链 / MetaMask」。

**推荐的现场演示动线（约 6 分钟）：**

1. 数据看板（管理员“全网运营视角”）→ 观察 14 日趋势与最新上链；
2. 身份切换器切到「普通用户」→ 观察导航骤减、看板只读 → 切回；
3. 存证登记：文本/图片 → 4 步向导 → 本地指纹实时计算（强调**原文永不上传**）→ 上链成功 → 下载**存证证书 PDF**；
4. 存证库：查看详情、哈希复制、版本链；存证验证页做一次公开核验（精确命中）；
5. 侵权检测：点“一键示例”载入同源变体 → 阈值滑杆 → 差异可视化 → 固定证据（二次上链）→ 证据中心导出**维权证据包 ZIP**；
6. 区块链管理（管理员）：区块浏览器、交易记录、账户创建，链状态一目了然。

### 4.2 智能合约：本地链部署与测试（可选，用于真实链模式）

前置：安装 [Foundry](https://getfoundry.sh/)（`foundryup`）。

```bash
cd contracts

# 1) 安装依赖（OpenZeppelin）
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# 2) 编译与运行全部测试
forge build
forge test -vvv

# 3) 启动本地链（另一终端）
anvil

# 4) 一键部署两个合约到本地链
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

复制输出的两个合约地址，回到前端「区块链管理 → 合约配置」，填入 `CopyrightVault` 与 `EvidenceAnchor` 地址并保存；浏览器安装 MetaMask 并连接本地链（`http://127.0.0.1:8545`，Chain ID 31337）后，右上角即可一键切到真实链模式。

---

## 五、智能合约设计

### CopyrightVault.sol —— 版权存证合约

| 函数 | 说明 |
| --- | --- |
| `registerWork(kind, contentHash, perceptualHash, title, model, ipfsCid, createdTime)` | 首版存证，作者 = `msg.sender` |
| `registerVersion(parentId, …)` | 为根作品登记迭代版本，自动归入版本链 |
| `grantAuthorization(workId, grantee, scope, expiresAt)` | 著作权人授予 商用/转载/改编/全权 授权（仅作者本人） |
| `revokeAuthorization(workId, grantee)` | 撤销授权 |
| `verifyByHash(contentHash)` | 任何人核验某内容指纹是否已存证 |
| `getVersionChain(rootId)` / `getAuthorWorkIds(author)` | 版本链 / 作者作品追溯 |
| `pause() / unpause()` | 运营熔断（`onlyOwner`） |

事件：`WorkRegistered`、`VersionRegistered`、`AuthorizationGranted`、`AuthorizationRevoked` 等；关键写入均加 `nonReentrant`，`Ownable` 管理运营开关。

### EvidenceAnchor.sol —— 侵权证据合约

| 函数 | 说明 |
| --- | --- |
| `anchorEvidence(workId, contentHash, reportHash, ipfsCid, simScore)` | 固定侵权证据（开放模式任意地址；受限模式仅授权机构） |
| `getEvidence(id)` / `verifyEvidence(reportHash)` | 查询 / 报告哈希核验 |
| `setOpenAnchoring` / `authorizeReporter` | 监管模式切换（`onlyOwner`） |

事件：`EvidenceAnchored`。报告原文存 IPFS（仅 CID 上链），二次上链固定“截图→报告→结论”证据链，防止事后篡改抵赖。

---

## 六、创新点说明

1. **全本地隐私指纹（Privacy-First）**：SHA-256 / pHash / SimHash / TF-IDF 全部浏览器端实现，**原文永不上传**；链上与 IPFS 只承载不可逆哈希与元数据。相较“上传到服务器再比对”的常见方案，从根上规避了原稿泄露风险，可直接作为隐私卖点宣传。
2. **双合约双存证（确权链 + 证据链）**：确权与维权证据分离上链，形成“侵权内容→检测报告→链上证据”的可审计证据链；报告哈希链上核验，任何事后篡改都无法自洽。
3. **可用的双模链架构**：模拟链（localStorage）与真实链（MetaMask + 本地链）一键切换、同一套业务代码——保证现场评审无钱包环境仍能完整走通，同时保留真实链闭环。
4. **两级侵权检测 + 可解释可视化**：指纹海明粗筛 + 语义向量精排，输出图片差异热区框、文本差异片段标红；阈值滑杆实时改变判定集合，检测过程可交互、可解释（L2 语义层注明为浏览器端轻量实现，生产可无缝替换 CLIP 等嵌入）。
5. **离线可运行（评审级鲁棒）**：第三方库（ethers/jsPDF/JSZip）全部本地化，图表手写 SVG，IPFS 无 Key 自动降级本地 CID，指纹与证书渲染零网络依赖——会场断网也不影响演示。
6. **RBAC 现场可演示**：四种角色同源渲染差异导航/看板/操作入口，一键身份切换器让评审 30 秒内直观看到权限体系，页面级与操作级双重守卫。
7. **正向激励闭环（钱包）**：链证积分（CVT）随确权/版本/固证/命中监测行为即时到账，顶栏余额实时刷新、钱包页含积分规则与逐笔流水（关联链上交易哈希），把“创作者确权 → 机构监测 → 维权取证”串成可持续的激励飞轮。

---

## 七、隐私与安全说明

- 本系统为**演示/竞赛实现**：语义层 L2 与 IPFS 存储使用浏览器端近似方案，生产环境应接入跨模态嵌入模型与真实 IPFS/Pinata、KMS 密钥管理，并将合约升级为多签治理。
- 模拟链模式数据保存在浏览器 `localStorage`，点击“重置链演示数据”可一键还原。
- 任何写入链上的内容请以本地测试链为准，请勿用于真实资产确权场景。

---

© 链证 ChainVault —— 区块链应用大赛参赛作品
