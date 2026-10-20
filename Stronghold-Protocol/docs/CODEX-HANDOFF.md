# Stronghold-Protocol / Marisa MOD 交接（CODEX-HANDOFF）

更新日期：2026-10-21。接手点：分支 `codex/marisa-author-0.3.1-20261019`（用户 fork `Ruyl114514/marisa-s-mod`），本轮全部改动已随本文件一同提交并推送（提交信息见 §7）。此前的 0.2.6 内容是历史工作，见 §9，不要当成当前 checkout 的状态。

## 0. 项目与路径速览

| 项 | 值 |
|---|---|
| Git 根（本轮 worktree） | `C:\Users\14693\Documents\Repositories\marisa-s-mod\marisa-author-0.3.1-20261019` |
| 游戏工程目录 | 其下 `Stronghold-Protocol\`（含 `package.json`、`AGENTS.md`） |
| 主仓库（检出 main） | `C:\Users\14693\Documents\Repositories\marisa-s-mod` |
| 原版参照（未改动） | `C:\Users\14693\Desktop\Stronghold-Protocol` |
| `origin` | `https://github.com/Ruyl114514/marisa-s-mod.git`（用户 fork，推送目标） |
| `upstream` | `https://github.com/Marisa-la/marisa-s-mod.git`（原作者） |
| 游戏底座 | `https://github.com/sganggs/Stronghold-Protocol` |

遵守 [AGENTS.md](../AGENTS.md)（`Stronghold-Protocol\AGENTS.md`）：不手改生成的 `data/*.json`、不提交游戏美术/音频/依赖/plugins 本体（`.gitignore` 已排除 `public/assets`、`public/vendor`、`node_modules`、`plugins/*`、`test/e2e/out`）、界面字符串走 `t()` 且四语言包齐全、提交单行中文信息带 issue 号、禁止 attribution trailer。本机 git 无全局身份配置，提交用 `-c user.name='Ru_yl' -c user.email='185109257+Ruyl114514@users.noreply.github.com'`（与 fork 既有提交一致）。

## 1. 在另一台电脑继续

```powershell
git clone --branch codex/marisa-author-0.3.1-20261019 https://github.com/Ruyl114514/marisa-s-mod.git
Set-Location .\marisa-s-mod\Stronghold-Protocol
npm.cmd ci
$env:SP_GITHUB_PROXY = 'https://gh-proxy.com/'
node tools/setup.mjs --asset-source=mirror   # 首次素材约 723 MB，可中断续传（本机已有，不入 git）
node scripts\install-marisa.mjs              # 从 mods/marisa-native/bundle/marisa 装 MOD 到 plugins/，并写 plugins/config.json（rooms:host, default:[marisa]）；幂等
npm.cmd start                                # 或双击 scripts\start-windows.bat（自动带 --scripts sandbox 并开浏览器）
```

- `--scripts sandbox` 是必须的：marisa 是 script 类插件，不带时 `room.setPlugins` 报 `PLUGIN_SCRIPTS_DISABLED`，房间是原版。`start-windows.bat` / `start-marisa.cmd` / 根目录 `启动魔理沙MOD.cmd` 都已带上，并预设 `SP_SCRIPT_PROBE_MS=20000`（marisa 的 SES 预检在部分 Windows 上超过默认 5 秒）。
- 素材镜像：`SP_GITHUB_PROXY` 只对 GitHub 托管文件生效，连续失败会回退原始源；清华 TUNA 的 github-raw 不含本素材所需的仓库，不能替代。
- 只想玩不想搭源码：直接解压玩家完整包（§6），`node_modules` 与美术已随包，仅需 Node.js 22+，双击 `scripts\start-windows.bat`。

## 2. 本轮（2026-10-20/21 会话）完成的五项工作

### 2.1 恢复「测试模式」

- 客户端（与原版逐行一致）：`public/js/store.js`（`ui.testMode`）；`public/js/screens/title.js`（「测试模式」按钮、`enterSession(name, {test:true})`、单人提示）；`public/js/screens/lobby.js`（`testAllowed` 复选框、琥珀色「开始测试模式」按钮、`create()` 发 `room.create {mode:'solo', test:true}` 后清标记）。`scripts/测试模式.bat`、`docs/DEV-MODE.md` 从原版复制回。
- 服务端（此前缺失，关键补丁）：`server/lobby.js` 新增 `isOwnerAddress(addr)`（只认回环 + 本机网卡地址，刻意不用 `isLocalIp`——后者在 VPN 网卡/公网 IPv6 下会误判）、`Room.testFromOwner`、`create()` 的本机旁路，以及 `startMatch`/`routeGameNow` 两处下游放行（否则房建得出来却开不了局）。`SP_TEST_MODE` 未开时，来自房主本机的请求也被放行；远端机器仍需 `SP_TEST_MODE=1`。
- 验证：修前本机 `room.create {test:true}` 被拒 `TEST_DISABLED`；修后同一请求 ok。`test/test-mode.test.js` 42/42（含新增的本机旁路用例：本机能建、远端仍拒、普通房不被误标）。

### 2.2 插件/MOD 管理器迁至「选择模拟协议」（大厅）界面

- 房间 `public/js/screens/room.js` 顶部改为只读 `PluginTagStatic`（`<span>`，无面板，玩家仍可见本房间跑什么）。
- 大厅 `public/js/screens/lobby.js` 标题正下方挂可点击的 `PluginTag lobby=true`，点击懒加载 `PluginPanel`（保住 import-graph 契约）。Marisa MOD 管理器表单（`public/js/ui/marisaSettings.js`）在大厅面板照常渲染。
- `public/js/ui/pluginPanel.js` 新增 lobby 模式：开关写**本浏览器预选**（`pluginTag.js` 的 `lobbyPlugins` store，pref `lobby-plugins`），不发网络请求；「重新应用」是房间专用不显示。
- 生效时机：`create()` 在 `room.create` 成功后紧接发 `room.setPlugins` 带上预选；`lobbySelectionFor` 会裁掉本服务器已不再提供的 id（脏 id 会让整份设置被拒）。
- welcome 新增**顶层**字段 `roomDefaults`（来自 `plugins/config.json` 的 `default`）——没挑过时大厅标签如实显示「插件 ×1 非官方」而非先显示「原版」。
- 两个 bug 修复：空集也发 `room.setPlugins {plugins: []}`（原来全关时一个请求都不发，房间保留服务器默认 marisa，标签承诺与实际不符）；`room.setPlugins` 被拒时单独 toast 并清过期预选，不表现为「创建房间失败」。
- i18n：新增 msgid 补进 en/ja/ko/zh-TW 四语言包；顺手修了 i18n 生成器把 `labels` 表美化成多行导致 `// i18n-ignore` 标记落错行的缺陷。
- 实机 WebSocket 验证三条语义：未挑过 → `["marisa"]`（服务器默认集）；显式原版 → `[]`；恢复默认 → 默认集。

### 2.3 修复「进房加载缓慢」

- 根因：首次 `room.create` 用同步 `spawnSync` 跑 SES 脚本预检（marisa 4.9 MB profile），**同步冻结整个事件循环 3.5–5.4 s**，期间所有玩家全部卡住。
- `server/plugins/scriptPreflight.js`：拆成异步 `spawn` 与同步 `spawnSync` 两条路径；`server/plugins/contentSet.js` 的 `composeContentSet` 改为 generator，唯一异步挂起点，同步/异步两个驱动共用同一份组合逻辑——约 90 处测试调用零改动（同步 API 保留给测试与 data-only 路径）。
- 新增 `server/plugins/warmup.js`：listen 之后后台预热 `policy.default` 集合；`setImmediate` 分批推进，不拖慢启动；测试运行器下默认关闭（检测 `NODE_TEST_CONTEXT`，否则 162 个 `startServer` 调用点各起一个 SES 子进程）。`server/index.js` 接入（`SP_WARM=0` 可关）。
- `server/plugins/contentSets.js`：in-flight 构建共享——预热进行中建房会加入同一次构建，不再各建一遍。
- 成效（真实 marisa，`SP_PLUGIN_SCRIPTS=sandbox`）：首个 `room.create` **5426 ms → 12 ms**（预热开）；boot 648 ms（关预热 577 ms）；预热在后台 3934 ms，无人等待。事件循环在构建期间不再长冻结。

### 2.4 S.W.E.E.P. 报告支持 MOD 内容集（新盟约/策略可见）

- 根因：报告读 `data.list('bonds'/'bands')`，而页面只在**持有房间内容集**时才有 MOD 数据（`public/js/content.js` 的 `roomCs` 要求 `room.content.vanilla === false`）；原入口只在 lobby（那里 `room === null`，永远读原版数据）。
- `public/js/screens/room.js`：房间顶栏新增「S.W.E.E.P.」按钮（`.room-sweep`）并挂载 `<SweepReport>`；`public/js/screens/sweep.js` 右上角新增内容集来源徽标（房间内「本房间的内容组合 · cs xxxxxxxx」/ 大厅「服务器的原始内容」，避免又一层困惑）；`public/css/screens/sweep.css` 配套样式与窄屏适配；`test/ui/sweep.test.js` 断言双入口。
- 浏览器实测：房间报告 26 盟约（含罗德岛/我们联合/S.E.E.S）、42 策略（含鲲/怒潮凛冬），MOD 详情（干员列表、初始生命值等）正常。

### 2.5 玩家完整包（不带 MOD 源码）

- 演进：先打增量更新包（`魔理沙MOD更新包-v0.3.1.zip`，1.5 MB/60 文件，含一键更新.bat + 校验.md5）→ 按用户要求改打完整包 → 用户实测报错（旧包 `start-windows.bat` 无条件调 `node scripts\install-marisa.mjs`，而包里没这文件 → `MODULE_NOT_FOUND`）→ 最终按「玩家包不带源码」重打，旧包已全部删除。
- `tools/package-marisa.mjs` 重写：在上游 `tools/package.mjs`（正式完整发布包实现）之上叠加 `plugins/marisa` + `plugins/config.json` + `mods/marisa-native/dist/`（一键更新.bat、安装前请先读我.txt）。玩家包**不带 MOD 源码**：`mods/marisa-native/source/` 是 GB 级美术提取中间产物。`start-windows.bat` 加了 `if exist "scripts\install-marisa.mjs"` 守卫（完整包里插件已就位，脚本幂等空跑）。
- `data/assets.json` 的改动来自 `node tools/fetch-assets.mjs --offline --allow-shrink`（摘除 4 个磁盘上不存在的攻击音效引用，官方打包脚本因此拒绝出包）——工具生成，符合「不手改生成数据」。
- 产物：`C:\Users\14693\Desktop\Stronghold-Protocol-v0.3.1.zip`（605.5 MB）+ 同内容解压目录 `...\Stronghold-Protocol-v0.3.1\Stronghold-Protocol\`（23716 文件/843 MB，node_modules 与美术 16712 已在内）。2026-10-21 包内 `node tools\doctor.mjs` 全绿（MANIFEST 6973 文件一致、依赖、前端库、数据、字体；可选项「本地客户端美术/官方特效」未提取属正常，仅影响 3D 棋盘等外观回退）。
- 再打包：`node tools/package-marisa.mjs [--dry-run | --update --from <基线> | --no-zip | --no-mod | --no-art | --keep-stage]`；默认 `--allow-dirty`（仓库常有未提交改动；正式发布请先 commit 再打）。

## 3. 验证记录（本轮）

- 定向套件（sweep 修复后）：`node --test "test/ui/*.test.js" test/lobby-plugins.test.js test/lobby.test.js test/test-mode.test.js test/i18n.test.js` → **1190 tests / 1172 pass / 0 fail**（18 skip = `SP_E2E=1` 浏览器用例）。
- `node tools/ci.mjs --only lint,imports,typecheck` → all steps passed；`node tools/i18n.mjs check` → 2185 msgids 100%。
- 全量 `npm test`（8589 条）约 117–126 条失败，**全部环境性**：Forge `symlinkSync/renameSync` 在本机 Windows EPERM、沙箱 setup 失败、本机未跟踪的 `plugins/marisa` + `config.json` 让 identity/welcome 断言多出 `plugins:1`（临时改名后该文件 22/22）。与干净 HEAD worktree 逐名对照**零回归**，且本轮异步化还修好了 HEAD 上 16 条超时 flaky。
- 真实浏览器（Edge，`CHROME_PATH`）+ 真实 marisa 插件截图验证：`test/e2e/out/v-01..v-06`（标题/测试模式按钮、大厅标签、插件面板含 MOD 管理器、建房后只读标签、测试房）与 `sweep-s-01..06`（房间报告、MOD 盟约/策略详情）；已被 .gitignore 排除，不入库。
- 实机 WebSocket 探针：`welcome.roomDefaults` → 大厅标签「插件 ×1」→ `room.create` 后房间自带默认集 → `setPlugins []` 变 vanilla → 恢复默认集，全链路通。

## 4. 本机环境的坑（接手前必读）

1. **PowerShell 内联传中文会毁编码**：曾把 `test/match/rules.test.js` 写坏（从 git 恢复后手工重做）。写中文一律走文件 / write 工具，或写脚本文件再执行。
2. **DSH 环境下 `process.execPath` 是 `DSH Desktop.exe`**：`spawnSync` 探针全挂、服务端脚本预检失败。跑服务端/测试要确保用真实 node（本机 node v24.21.0 在 PATH）。
3. **`hasChrome()` 为 false**：`SP_E2E=1` 用例只 skip。需要浏览器验证时用 Edge 并设 `CHROME_PATH` 环境变量。
4. **Windows 无 symlink 权限**：forgeImport 相关测试在本机恒败（EPERM），是环境问题，用干净 HEAD worktree 对照来归因。
5. **codemod 批量改测试易翻车**（async 插错参数位、编码损坏）：小范围手工编辑更稳。
6. 该环境曾三次并行子代理全部失败；直接顺序执行更可靠。
7. 本机 git 无全局 user.name/email（历史提交是 GitHub 网页端产生），提交需 `-c` 传身份。

## 5. 本轮关键文件地图

| 区域 | 文件 |
|---|---|
| 客户端界面 | `public/js/store.js`、`screens/title.js`、`screens/lobby.js`、`screens/room.js`、`screens/sweep.js`、`public/css/screens/sweep.css` |
| 插件 UI | `public/js/ui/pluginTag.js`（lobby 预选 store/裁剪/目录）、`ui/pluginPanel.js`（lobby 模式）、`ui/marisaSettings.js` |
| 服务端 | `server/lobby.js`（isOwnerAddress/testFromOwner）、`server/index.js`（warm 接入）、`server/plugins/scriptPreflight.js`、`contentSet.js`、`contentSets.js`（in-flight）、`roomSets.js`、`forgeImport.js`、**新增 `warmup.js`**、`server/studio/{index,trialChild}.js` |
| 打包 | `tools/package-marisa.mjs`（重写）、**新增 `tools/marisa-dist.mjs`、`tools/mb.mjs`** |
| 启动 | `scripts/start-windows.bat`（守卫）、`scripts/start-marisa.cmd`、**新增 `scripts/install-marisa.mjs`**、恢复 `scripts/测试模式.bat`、根目录**新增 `启动魔理沙MOD.cmd`**（删除旧的 `启动0.3.0测试.cmd`） |
| 测试 | `test/test-mode.test.js`、`test/lobby-plugins.test.js`、`test/lobby.test.js`、`test/ui/sweep.test.js`、`test/plugins/contentSets.test.js`、match/plugins/ui 多个套件改 await、**新增 `test/plugins/warmup.test.js`** |
| 文档与 i18n | `docs/DEV-MODE.md`（恢复）、`docs/{PLAYING,PLUGIN-GUIDE,PLUGINS,MARISA-0.3.0,MARISA-AUTHOR-20261019}.md`、`README.md`（根与 SP 内各一）、`public/i18n/{en,ja,ko,zh-TW}.json` |
| 随包分发 | `mods/marisa-native/dist/{一键更新.bat, 安装前请先读我.txt}` |

## 6. 玩家交付物（桌面，不入 git）

- `C:\Users\14693\Desktop\Stronghold-Protocol-v0.3.1.zip`（605.5 MB）——发给玩家/备份用这个。
- `C:\Users\14693\Desktop\Stronghold-Protocol-v0.3.1\Stronghold-Protocol\`——解压即用副本（占双倍磁盘，可自行删掉只留 zip）。
- 旧的 `魔理沙MOD更新包-v0.3.1`（zip+目录）已按用户要求删除。

## 7. 本次提交

- 单提交包含本轮全部改动（约 62 个修改文件 + 9 个新增 + 1 个删除），提交信息：
  `恢复测试模式并将插件管理器迁至大厅，附带进房预热加速、S.W.E.E.P. 房间内容集与玩家完整包 #1`
- 提交身份：`Ru_yl <185109257+Ruyl114514@users.noreply.github.com>`（`-c` 传入；本机无全局 git 身份）。
- 推送：`git push origin codex/marisa-author-0.3.1-20261019`（fork = `Ruyl114514/marisa-s-mod`）。
- 美术、node_modules、`plugins/*`（MOD 本体与 config.json）、`test/e2e/out` 截图均被 .gitignore 排除，未入库——在新机器按 §1 重建。

## 8. 待办与建议

1. e2e 四个文件（`test/ui/plugins*.e2e.test.js`、`marisa-native.e2e.test.js`）已按新流程改写，但本机无 Chrome 只能静态审阅——在有 Chrome 的机器跑 `SP_E2E=1 node --test test/ui/*.e2e.test.js` 复验。
2. 给 upstream PR #1 的描述按 AGENTS.md 要求补齐：改了什么/为什么/来源、`[ASSUMED]` 点、跑过的测试摘要行、golden 情况。
3. 玩家完整包建议在一台干净 Windows 上双击 `scripts\start-windows.bat` 复验一次完整首启路径（本机 doctor 全绿且起服验证过，但干净机器的 node 检测/浏览器打开分支没走过）。
4. `mods/marisa-native/dist/一键更新.bat` 是增量更新包时代的产物（面向「游戏文件/」目录结构），随完整包分发时语义略有出入——下次迭代可按完整包语境改写或从完整包剔除。
5. 可选：本地客户端美术提取（doctor 提示 3D 棋盘改用 2D、部分模型用替代样式）——纯外观，非必须。

## 9. 历史：0.2.6 及更早（仅供溯源）

- 当时分支 `codex/marisa-mod-0.2.6`；修复版发布 `marisa-0.2.6-20261015-fix1`；修复提交 `233cc11`（房间 `modOptions` 从 Lobby 传到 BattleSpec/浏览器模拟器；自定义配置内容哈希不一致导致战斗不出怪）。
- 旧单场测试示例：`node tools/mod-test.mjs --scenario kun-wave --stage act1autochess_m01 --round 2 --difficulty HARD --operator 乌尔比安 --skill 1 --seed 27 --seconds 40`（该场景只含飞行敌人，只能观察对空阻挡）。
- 0.2.6 的代码、发布包与测试报告是独立历史状态；处理当前任务以 0.3.1 checkout、其 git 状态与本文件为准。更早的适配背景见 `docs/MARISA-AUTHOR-20261019.md` 与 `docs/MARISA-0.3.0.md`。
