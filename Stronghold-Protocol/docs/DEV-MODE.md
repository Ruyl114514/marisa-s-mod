# DEV-MODE.md — 开发 / 测试模式（MOD 新增）

> 给本 MOD 的测试用开关。默认**全部关闭**，正式发布不受影响。

## 无限资金（`SP_DEV_FUNDS`）

整备期开始时，把**人类玩家**的资金补足到指定数额。用来跳过经济爬坡，直接看后期内容
（6 级商店、tier-6 合成、罗德岛高层数、压测刷怪等）。

### 怎么开

**最简单**：双击发布包里的 `测试模式.bat`（等价于普通启动，只是多了这个开关）。

⚠️ **它默认用 3001 端口，不是普通的 3000。** 原因：`scripts/launch.mjs` 把「端口上已经有服务器在应答」
当作「服务器已在运行」，于是**直接打开浏览器并以 0 退出**——这个窗口会一闪而过，而且打开的是那个**普通**
服务器（`SP_DEV_FUNDS` 根本没生效）。独立端口让测试服和普通服可以同时开着，互不影响。
想故意用测试模式顶掉普通服：先关掉原来的，再 `测试模式.bat 9999 --port 3000`。

**手动**（源码运行 / 自建包）：

```powershell
# Windows PowerShell
$env:SP_DEV_FUNDS = '9999'; npm start

# Windows cmd
set SP_DEV_FUNDS=9999 && npm start

# bash
SP_DEV_FUNDS=9999 npm start
```

值 = 目标资金额。省略或留空 = 关闭。默认建议 `9999`（足够把商店刷满并把调度中心顶到满级）。

**自定义额度**：`测试模式.bat 50000`，或直接改环境变量的值。
**其余参数原样转发**给 `launch.mjs`，例如 `测试模式.bat 9999 --port 3000 --no-open`。

### 行为细节

| 情况 | 行为 |
|---|---|
| 人类玩家，单人房间 | 每个整备期开始时资金**补足**到目标值 |
| 资金已高于目标值 | **不动**（不会把你自己挣的钱减掉） |
| 机器人 | **不受影响** |
| **多人（同盟）房间** | **不生效**——这是硬性限制，避免在正常对局里等于作弊 |
| 开关未设 | 完全无行为，与正式版逐字节一致 |

「补足」而非「累加」：因为 `endPrep()` 会把整备期余额清零（带保留资金的策略除外），
所以每回合回到目标值，花多少都不心疼。

### 实现位置

| 文件 | 作用 |
|---|---|
| `server/match/devMode.js` | 开关解析与额度计算（纯函数，可单测） |
| `server/match/player/round.js` | `startRound` 里一行接入点（onIncome 派发之后、`addFunds` 之前） |
| `test/match/devMode.test.js` | 单元 + 真实对局测试（含审计一致性与多人房间守卫） |

⚠️ **为什么必须经由 `onIncome` 事件，而不是直接写 `ps.funds`**：
`server/match/audit.js:159` 有一条强断言

```
ps.funds - f0 === nn(ev.income) + nn(ev.pending)
```

即「一次 `startRound` 后资金的变化必须精确等于 onIncome 结算出的收入」。直接给 `ps.funds`
赋值会破坏这条断言，而审计在测试与 golden 语料里都开着。所以开发模式改写的是 `ev.income`，
资金随后走**正常入账通道**——审计算术成立，`stats.fundsGained` 与结算面板也如实反映。

⚠️ **补足量要减去本回合收入**：调用时 `addFunds` 还没跑，`ps.funds` 仍是上一回合的余额，
所以 `补足量 = 目标 − 当前余额 − 本回合收入`。不减的话每回合会多拿一份收入
（实测：目标 777、R1 收入 4 时玩家会拿到 781）。

### 上游同步时的保护

`tools/mod-manifest.mjs` 的 `MOD_ANCHORS` 里登记了接入点锚点
（`server/match/player/round.js` → `devFundsOn(this.m)`）。上游同步后运行：

```powershell
node tools/mod-manifest.mjs
```

若输出报错指出这个锚点丢失，说明上游重排了 `startRound`，需要按上面的说明把那一行重新插回
「`dispatch(this, 'onIncome', ev)` 之后、`const nonNeg = …` 之前」。

---

## 测试模式（`room.create { test: true }`）

**标题界面的「测试模式」按钮**：填好博士代号后点它，直接进一个单人测试房间。三条保证一次到位：

| 保证 | 做法 |
|---|---|
| **不可联机** | 两条入口各自表达意图，**服务端不再改写 `mode`**（负责人 2026-10-19 裁决，方案 A）：标题界面「测试模式」入口自己发 `mode = 'solo'`（`public/js/screens/lobby.js`），而 solo 房间本来就拒绝 `room.join` / `room.spectate`（`ROOM_FULL`）与 `room.addBot`，所以没人能进来，也没法变成同盟局 |
| **无限资金** | 每个整备期把人类玩家的资金补足到目标值。**不需要**设 `SP_DEV_FUNDS` —— 测试模式无条件打开，额度默认 `9999`；设了 `SP_DEV_FUNDS` 就用设的值（压测时调额度用）。`devFundsOn` 另要求 `isSolo`，所以同盟测试房间拿不到它 |
| **不会再禁用角色** | 不抽禁用盟约集合 D，**`bannedChess` 恒为空**：商店池里不会少任何干员。整备期重随（`room.rerollSetup`）走同一个 helper，所以重随也变不出禁用 |

> **怎么才能进（闸门）**：上游 v0.3.1 用进程开关 `SP_TEST_MODE` / `--test-mode` 挡了一道（`server/testMode.js`），
> 它按**绑定地址**判定 —— 而这台机器只要装了 VPN 网卡（Radmin / Tailscale / ZeroTier / Hyper-V）或从运营商拿到
> 公网 IPv6，`--test-mode 1` 就会被拒绝，于是「用普通启动器开服 → 点测试模式」会直接 `TEST_DISABLED`。
>
> 所以 MOD **追加了一条通路**：**请求来自这台机器本身**（回环，或本机任一网卡自己的地址）时，即使开关没开也允许
> 建测试房，并把 `testFromOwner` 记在房间上，让开局复核与 `g.test` 一并放行。换句话说：
>
> - **本机玩**（`http://localhost:…`、`http://127.0.0.1:…`、局域网 IP、VPN IP 都可以）→ **任何启动器都能开测试模式**，
>   不需要 `--test-mode`；
> - **远端客人**建房 → 仍然需要 `SP_TEST_MODE` / `--test-mode 1`（公网监听要 `force`）。
>
> `scripts/测试模式.bat` 依然会带上 `--test-mode 1`（把闸门显式打开，最稳妥），但**它已经不是必需的了**；它也仍然用
默认的全网卡监听，所以局域网里的朋友照样连得上测试服。
> 注意创建界面的「测试房间」复选框只在开关打开时才显示（`welcome.testMode` 是**进程级**的，不能按来源区分）；
> 标题界面的「测试模式」入口不受此限，本机永远可用。

### 怎么开

标题界面 → 填博士代号 → 点 **测试模式**（在「开始」下方）。大厅的创建按钮会变成琥珀色的
**开始测试模式**，点它建房；建房后那个标记就被清掉了，之后再点「创建同盟」是普通房间。

它是**房间属性**而不是环境变量：`room.create { test: true }` → `Room.test` → `Match opts.test` → `m.test`，
并随 `room.state.test` 广播（大厅会显示一行琥珀色提示）。所以一个进程里可以同时开普通服和测试房，互不影响。

### 行为细节

| 情况 | 行为 |
|---|---|
| 人类玩家 | 每个整备期开始时资金**补足**到目标值（默认 9999） |
| 资金已高于目标值 | **不动** |
| 机器人 | **不受影响** |
| **同盟房间** | 标题界面入口建不出来（它发 solo）。创建界面的「测试房间」复选框按房主选的模式建，所以**可以**有同盟测试房间（上游 v0.3.1 的功能：客人用 `testAck` 确认后能进），但那种房间拿不到无限资金 —— `devFundsOn` 要求 `isSolo`（`test/match/testMode.test.js` 有这条守卫的用例） |
| 禁用 | 抽取的集合 D 为空、`bannedChess` 为空 |
| **模式静态禁用（`staticOff`）** | **保留**，见下 |

### 为什么保留 `staticOff`

`staticOff` 不是「本局抽到的禁用」，而是**模式自己**从不激活的盟约
（`config.json modes[modeId].inactiveBondIds` = 官方 `modeDataDict.inactiveBondIdList`；标准/FUNNY 关掉 10 条，
险境及以上 0 条）。它**独立于这条记录**被强制：`GameData.modeInactiveBonds` 被
`bondsMeta.computeBonds`（`if (gd.modeInactiveBonds.has(id)) continue`）、`offBondCounts`、bot 与
`infra.bondInPool` 各自读取。所以在这里清空它**并不会**让那些盟约变得可用，只会让
`m.public.disabledBonds` / `m.private` 与实际规则不一致，还会给每个自选槽塞进一份用不上的库存。

保留它，测试模式的语义就精确地是「**同模式的普通房间，减去抽签那一半**」—— 这正好是界面所表达的
「不再禁用角色」（`m.public.bannedChess` 为空 ⇒ 没有「本局禁用干员」网格，`drawnDisabledBonds` 为空）。

### 实现位置

| 文件 | 作用 |
|---|---|
| `shared/protocol.js` | `room.create` 的**可选** `test`（`$optional: ['test']`；上游 0.3.1 起只接受字面 `true`，`false` 也算 `BAD_MSG` —— 普通房间省略即可）；`room.join` / `room.spectate` 的 `testAck` |
| `server/testMode.js` | 上游 0.3.1 的安全闸门：`SP_TEST_MODE` / `--test-mode` 的字面解析与绑定地址判定 |
| `server/lobby.js` | `Room.test`、`isOwnerAddress`（本机旁路）、`Room.testFromOwner`；`create` 保留客户端要求的 `mode` 并按闸门拒绝；`toState()` 发布 `test`（true 时）；`startMatch` 传 `opts.test`；`join`/`spectate` 的 `testAck` |
| `scripts/测试模式.bat` | 带 `--test-mode 1` 启动，让闸门打开（本机旁路已经不需要它了，带上只是最稳妥） |
| `server/match/devMode.js` | `devFundsFor(m, env)` —— 测试模式取 `SP_DEV_FUNDS`，没设则 `DEV_FUNDS_DEFAULT`；`devFundsOn` 的单参数行为不变 |
| `server/match/player/round.js` | 测试模式那一行接入点（原有那行 `devFundsOn(this.m)` 逐字节未动，锚点仍在） |
| `server/match/pool.js` | `noBans(gd)` / `drawMatchBans(gd, rng, test)` —— 初始 setup 与重随共用的**唯一**入口 |
| `server/match/Match.js` | `this.test = opts.test === true`；`drawMatchBans(this.gd, this.rngSetup, this.test)` |
| `server/match/match/setupVote.js` | 重随同样走 `drawMatchBans(…, this.test)` |
| `public/js/screens/title.js` | 「测试模式」入口 → `enterSession(name, { test: true })` → `store.ui.testMode` |
| `public/js/screens/lobby.js` | `ui.testMode` ⇒ `room.create { mode: 'solo', difficulty, test: true }`，成功后清标记 |
| `test/test-mode.test.js` | 42 条用例：三条保证 + 正常路径不变 + 协议校验 + 大厅守卫 + 本机旁路（本机可建、远端仍拒） |

⚠️ **`test` 只在为 `true` 时生效**，默认关闭。所以普通对局的随机序列、禁用集合、资金路径
**逐字节不变** —— `test/golden/*.json` 不应移动。

### 上游同步时的保护

`server/match/pool.js` 里我们**新增**了 `noBans` / `drawMatchBans`，并把 `Match.js` 与
`setupVote.js` 的 `drawDisabledBonds(...)` 调用换成 `drawMatchBans(..., this.test)`。上游若重写这两处，
按「`drawMatchBans(gd, rng, test)` 是唯一入口」重贴即可 —— 关键是**两个调用点不能各自为政**，否则重随会
把禁用重新带回来。

