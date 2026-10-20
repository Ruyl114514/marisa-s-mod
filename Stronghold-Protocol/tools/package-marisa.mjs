#!/usr/bin/env node
// tools/package-marisa.mjs — 魔理沙 MOD 完整包：在**上游完整发布包**之上叠加 MOD。
//
//   node tools/package-marisa.mjs [--update --from <基线>] [--out <dir>] [--dry-run] [--no-zip]
//     [--no-mod] [--no-art] [--keep-stage] [--allow-dirty] [--no-install]
//
// 这条命令默认带 `--allow-dirty`：本仓库正在改造中（测试模式恢复、插件面板搬家、进房加速、S.W.E.E.P. 报告
// 支持 MOD 内容集……），一堆文件还没提交，而 `git ls-files` 取不到未提交的新文件，上游的 importProblems 会
// 把 `server/plugins/warmup.js` 报成「not shipped」。所以在下面把它补进 shipped 集合，并跳过「有未提交改动」
// 这条检查（真要按上游的纪律打包，就先 commit 再跑，那时不必加这两个开关）。
//
// 产物（默认写到桌面，文件夹名 Stronghold-Protocol）：
//   Stronghold-Protocol/
//     ├─ MANIFEST.json / UPDATE.json   上游更新协议（server/update.js 读它，`npm run doctor` 也读它）
//     ├─ data/、public/、server/、shared/、scripts/、tools/、packs/、schemas/、docs/
//     ├─ plugins/marisa、plugins/config.json   MOD 本体（git 忽略，这里显式带上）
//     ├─ mods/marisa-native/dist/      只带一键更新.bat 与安装前请先读我.txt，不带 MOD 源码
//     └─ node_modules/（`npm ci --omit=dev` 在暂存目录里现装，所以玩家的机器不用先装依赖）
//   Stronghold-Protocol.zip
//
// 玩家包**不带 MOD 源码**：`mods/marisa-native/source/` 是从官方客户端提取美术的中间产物
// （按需在本机生成，GB 级），构建脚本与 profile 源码对玩游戏的人没有用处；打包与回退要用到的
// 一键更新.bat 与说明文件放在 mods/marisa-native/dist/ 下随包分发。
//
// 为什么不自己列文件清单：上游 tools/package.mjs 就是「完整发布包」的正式实现 —— 它按 `git ls-files`
// 白名单选文件、把 data/assets.json 列的全部美术一起带上、在暂存目录跑 npm ci --omit=dev、
// 写 MANIFEST.json、按 zip、并做一堆检查（个人路径扫描、导入可达性、package.json 脚本可达性）。
// 完整包必须能**从零开服**，所以美术（600.9 MB）和生产 node_modules 都得带，这正是它的职责。
// 本脚本只补两件它做不到的事：
//   ① git 忽略的 `plugins/marisa` + `plugins/config.json`（MOD 本体；源码仓库里由
//      scripts/install-marisa.mjs 从 bundle/ 安装，完整包里直接带上，所以那个脚本在包里是空跑）；
//   ② `mods/marisa-native/dist/` 下给玩家的两个文件。
//
// MOD 美术 = MOD 的 assets 清单里、游戏清单里没有、且 public/ 下真实存在的文件
// （mods/marisa-native/source/data/assets.json vs data/assets.json）。MOD 引用的美术基本都来自官方
// 那份清单（已随游戏分发），真正属于 MOD 自己的只有 11 个 —— 完整包比原版只多 5 MB 的插件本体。
//
// --update 会读一份基线完整包（或它的解压目录），按上游 UPDATE 协议只打包变化的部分，玩家解压覆盖即可。
// --dry-run 只打印计划与检查结果，什么都不写。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  FOLDER, plan, formatSummary, build, buildUpdate, readBases, formatBases, formatUpdate,
  zipFolder, packageOutIsUnsafe, scanNames, scanFiles, trackedFiles,
} from './package.mjs';
import { copyDist } from './marisa-dist.mjs';
import { MANIFEST_FILE, inManifest, parseManifest } from '../server/update.js';
import { manifestText } from './package-update.mjs';
import { MB } from './mb.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const NOZIP = argv.includes('--no-zip');
// --no-mod 只打上游原版完整包（调试用）
const NOMOD = argv.includes('--no-mod');
// --no-art 让上游按 lite 计划走（美术由玩家首次启动时 npm run setup 下载）—— 完整包默认带美术
const LITE = argv.includes('--no-art');
const NOINSTALL = argv.includes('--no-install');
const value = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const OUT = path.resolve(value('--out', path.join(os.homedir(), 'Desktop')));
const BASES = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--from') for (const one of String(argv[++i] || '').split(',')) if (one.trim()) BASES.push(path.resolve(one.trim()));
}
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------
// MOD 侧的文件：git 忽略的插件本体 + mods/ 目录
// ---------------------------------------------------------------------------

/** 收集一个目录下的所有文件（相对该目录的路径，posix 风格）。 */
const tree = (abs) => {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(abs, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(r); continue; }
      if (e.isFile()) out.push(r);
    }
  };
  walk('');
  return out.sort();
};

const bundle = path.join(REPO, 'mods/marisa-native/bundle/marisa');
const MOD_PLUGIN = tree(bundle).map((rel) => ({ abs: path.join(bundle, rel), rel: `plugins/marisa/${rel}` }));
const MOD_POLICY = [{ abs: path.join(REPO, 'plugins/config.json'), rel: 'plugins/config.json' }];
/**
 * mods/ 下随包分发的只有 dist/ 里这两个文件：给玩家的一键更新.bat 与安装前请先读我.txt。
 * **玩家包不带 MOD 源码**：mods/marisa-native/source/ 是从官方客户端提取美术的中间产物
 * （按需在本机生成，GB 级），构建脚本与 profile 源码对玩游戏的人没用，还会让包大出几十 MB。
 * 插件本体在 mods/marisa-native/bundle/marisa，随包放到 plugins/marisa（见 MOD_PLUGIN），
 * 所以 scripts/install-marisa.mjs 在包里是空跑，也就不必进包。
 */
const MOD_SOURCE = [
  { abs: path.join(REPO, 'mods/marisa-native/dist/一键更新.bat'), rel: 'mods/marisa-native/dist/一键更新.bat' },
  { abs: path.join(REPO, 'mods/marisa-native/dist/安装前请先读我.txt'), rel: 'mods/marisa-native/dist/安装前请先读我.txt' },
];

/** MOD 侧总共要覆盖/新增的文件（按仓库相对路径）。 */
const modFiles = () => [...MOD_PLUGIN, ...MOD_POLICY, ...MOD_SOURCE];

/**
 * 上游 `trackedFiles(root)` 走 `git ls-files`，本会话新写的、还没提交的文件（`server/plugins/warmup.js`）
 * 以及 git 忽略的 MOD 侧文件都不在里面，于是 importProblems 误报「imports … (not shipped)」。
 * 这里把它们补进 `paths`：plan() 会照常按 isPlayerFile() 过滤，所以不该船的依然不会船。
 */
const trackedWith = (extra) => {
  const have = new Set(trackedFiles(REPO));
  for (const rel of extra) if (fs.existsSync(path.join(REPO, rel))) have.add(rel);
  return [...have];
};

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const env = { ...process.env };
// 这台机器跑过大量本地测试，用户名可能出现在某些文件里；完整包是给玩家的，默认不带本机痕迹。
if (!env.SP_PACKAGE_SCAN_USER) env.SP_PACKAGE_SCAN_USER = '0';
// 本会话新写的文件还没提交，`git ls-files` 取不到它们，上游的 importProblems 会误报「not shipped」。
// MOD 侧的文件同理（git 忽略）。把它们加进 shipped 集合再算导入可达性。
const UNCOMMITTED = ['server/plugins/warmup.js', ...modFiles().map((r) => r.rel)];

let p;
try {
  p = plan(REPO, { lite: LITE, allowDirty: true, env, paths: trackedWith(UNCOMMITTED) });
} catch (e) { console.error(`package: ${e.message}`); process.exit(1); }

log(`${NOMOD ? '原版' : '魔理沙 MOD'} 完整包 · version ${p.version}`);
log(formatSummary(p));
log(`MOD 插件：${MOD_PLUGIN.length} 个文件（${MB(MOD_PLUGIN.reduce((n, r) => n + fs.statSync(r.abs).size, 0))}）+ plugins/config.json`);
log(`MOD 附带：${MOD_SOURCE.length} 个文件（mods/marisa-native/dist/，一键更新.bat 与安装前请先读我.txt；不带源码）`);
const names = scanNames(env);
const scanHits = scanFiles(REPO, modFiles().map((r) => r.rel), { home: true, names });
for (const h of scanHits) log(`个人路径扫描：${h}`);
log(scanHits.length ? `MOD 侧扫描：${scanHits.length} 处命中（见上）` : 'MOD 侧扫描：ok');

if (DRY) {
  log('--dry-run：未写入任何文件');
  process.exit(p.problems.length ? 1 : 0);
}
if (p.problems.length) { console.error(`package: 计划有问题，先解决上面的 ${p.problems.length} 条`); process.exit(1); }

const dest = path.resolve(OUT);
if (packageOutIsUnsafe(dest, REPO)) {
  console.error(`package: 拒绝写进仓库或它的父目录：${dest}`);
  process.exit(1);
}

const opts = { out: dest, install: !NOINSTALL, force: true, keepStage: argv.includes('--keep-stage'), env, log };
let r;
try {
  if (BASES.length) {
    const bases = readBases(BASES, p.version, { log });
    log(formatBases(bases));
    r = buildUpdate(REPO, p, bases, opts);
    log(formatUpdate(r, p.version));
  } else {
    r = build(REPO, p, opts);
  }
} catch (e) { console.error(`package: ${e.message}`); process.exit(1); }

// ---------------------------------------------------------------------------
// 把 MOD 侧铺到上游暂存目录上，然后重新打包
// ---------------------------------------------------------------------------

const stage = r.stage;
if (!stage) { console.error('package: 上游没有保留暂存目录（需要 --keep-stage），无法叠加 MOD'); process.exit(1); }

for (const f of modFiles()) {
  if (!fs.existsSync(f.abs)) { console.error(`package: MOD 文件缺失：${f.rel}`); process.exit(1); }
  const to = path.join(stage, f.rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(f.abs, to);
}
// dist/ 下的一键更新.bat / 安装前请先读我.txt 也进完整包（mods/marisa-native/ 下已有一份，这里放到包根目录）
copyDist(stage);
log(`MOD 叠加完成：${modFiles().length} 个文件 → ${stage}`);
// MANIFEST.json 要覆盖新加进来的文件：上游写的是它自己那份计划的清单，MOD 侧的文件不在其中。
// 用 server/update.js / package-update.mjs 的同一套读写函数，保证 `npm run doctor` 与更新协议读得懂这份清单。
// （上游写完 MANIFEST 后还跑了 stageProblems 校验，我们的文件与 MANIFEST 都是它之后加的，所以那份校验不再适用；
// 玩家侧的第一次校验交给 `npm run doctor`。）
const files = new Map();
for (const f of tree(stage)) {
  if (!inManifest(f)) continue;
  const body = fs.readFileSync(path.join(stage, f));
  files.set(f, { size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') });
}
const text = manifestText({ app: p.version, files });
parseManifest(text); // 像上游那样读回来一遍，格式坏了当场炸
fs.writeFileSync(path.join(stage, MANIFEST_FILE), text);
log(`${MANIFEST_FILE}：${files.size} 个文件（含 MOD 插件与 MOD 源码）`);

if (!NOZIP) {
  // 上游的 build() 已经用 plan 里的文件打过一次 zip（里面没有 MOD 侧的文件），所以这里覆盖它。
  const work = path.dirname(stage);
  const zip = `${work}.zip`;
  fs.rmSync(zip, { force: true });
  zipFolder(work, zip);
  log(`zip：${zip}（${(fs.statSync(zip).size / 1048576).toFixed(1)} MB）`);
} else {
  // 上游自己那份 zip 里缺 MOD 侧的文件，留着会误导：删掉，只留解压即用的目录
  fs.rmSync(`${path.dirname(stage)}.zip`, { force: true });
  log('--no-zip：跳过打包');
}
log(`完成。解压后把里面的 ${FOLDER} 文件夹放到任意位置，双击 scripts\\start-windows.bat 即可开服。`);
