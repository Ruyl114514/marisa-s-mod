// server/sim/content/bonds/addon/sees.js — MOD 盟约【SEES】(`seesShip`) 的战斗实现。
//
// 这是 MOD 自有文件（与 rhode.js / unite.js 同目录同款）：`addon/battle.js` 只留一行插桩
// `installSees(battle)`，全部实现与出处注释都在这里，上游共享文件不被 MOD 逻辑污染。
//
// =====================================================================================================================
// 用户原话（逐字保留，禁止改写；完整版见 docs/TASKS-SEES.md §0）
//
//   虎狼丸，1本
//   sees，前三次击杀敌人为sees叠加2层
//   埃癸斯，3本
//   sees，sees每叠加10层增加1%攻速，最多200%
//   岳羽由加莉，4本
//   自身及前方一名干员攻击范围内，敌人被停顿，束缚，击晕时，50%概率为sees叠加一层，一回合最多10层
//   结城理新增sees盟约，效果为结城理在场时，"小队总攻"效果造成的攻击力提升20%
//
//   sees，
//   3名激活
//    效果：SEES干员攻击命中重量≤3的敌人时，有 (10 + 0.2×层数)% 概率使敌人停顿2秒，并回复自身1点技力。每5秒最多触发一次。
//   6名激活
//    总攻击
//   效果：当场上所有敌人均处于停顿、束缚或眩晕状态时，SEES干员下一次攻击将触发总攻击：对全场敌人造成 (200 + 5×层数)% 攻击力的
//   物理伤害，并清除所有敌人的控制状态。总攻击每30秒最多触发一次。
//   6名激活
//    神通法
//   效果：SEES干员每次造成伤害、治疗或获得层数时，神通法计量表累积。计量表满100后，该干员的下一次技能将强化为神通法，
//   额外造成 (100 + 3×层数)% 攻击力的真实伤害，无视敌人防御和法抗。每个干员独立计算计量表，每场战斗每个干员最多触发一次。
//
// 以及装备「人格羁绊」（`selfGrantBondId: 'seesShip'`）：佩戴者**单件即视为 SEES 成员**，所以能靠装备凑满 6 名档 ——
// 这是用户 2026-10-16 的裁决「sees有自己的原生干员，激活sees靠他们，装备可以让没有sees盟约的干员获得sees盟约，
// 如果是sees成员装备，也可以触发精锐化之后的效果」。成员判定一律走 `isMember`（它经 `unitBonds` 已涵盖自授）。
//
// =====================================================================================================================
// 数值来源：**一律从 data/bonds.json 的 `seesShip.bb` 读回**（不硬编码），缺键时回落到用户原话的字面值（DEFAULTS）。
// 叠层来源：用户 2026-10-16 的「各个干员的叠层方式要在干员特质里写」把每位成员的规则下放到**干员自己的特质**
//   （`trait.bb.mod_sees_*`，声明在 tools/mod-content.mjs 的 MOD_TRAIT_RULES，见 docs/SEES-TRAIT-LAYERS.md）。
//   本文件因此**先读干员自己的 `trait.bb`**（support 的 `traitMod` 助手），读不到才回落盟约 bb。
//
// 引擎事实（本会话实测，见 docs/SEES-WORKSTREAM-C-v2.md §0）：
//   · 「敌人被停顿/束缚/击晕时」有现成钩子 `battle.on('statusApplied', ({target,status,entered}) => …)`
//     （battle/status.js:231）；`entered` 才表示「被施加」，只认它，否则延长已有状态会重复计层。
//   · 敌人重量字段是 `enemy.weight`（targeting.js:193），不是 `s.weight`。
//   · 控制状态键：停顿 `sluggish` / 束缚 `bind` / 击晕 `stun`。
//   · 随机只有 `battle.rng`（mulberry32，种子化）可用，`server/sim/` 禁止 Math.random。
//
// [ASSUMED] 的读法（无官方来源可裁，按最简且不矛盾实现）：
//   1. 虎狼丸的「前三次击杀」= **虎狼丸自己的**击杀（用户原话写在他这一条下），且是**每场战斗**前三次。
//   2. 埃癸斯的攻速只给**她自己**（用户原话写在她这一条下）。
//   3. 岳羽由加莉的「自身及前方一名干员」= 她本人 + 她**正前方一格**上的干员，两者攻击范围的并集。
//   4. 神通法的「下一次技能」= 计量表满之后该干员的下一次 `skillStart`；「施放」= 该技能命中时追加真实伤害。
//      为不依赖技能实现细节，实际做法是：满表时给该干员挂一个一次性标记，在其下一次 `hit`（技能命中）时结算。
//
// Run: node --test test/content/bonds_sees.test.js

import {
  num, bondRecord, buffParams, bondActive, bondTier, bondLayers, isMember, isOp,
  battleStore, fxOn,
} from '../../support/index.js';
import { garrisonBonus, ALLOUT_BONUS_KEY } from '../../garrisons/battle.js';

/** The bond (locked id — 用户裁决). */
export const BOND = 'seesShip';
/** Its own record buff key (`bbStr.key` / `key` of the bond's single buff). */
export const MOD_KEY = 'MOD_bond_sees';
/** fx `src` / namespaced buff key of this bond's effects. */
export const KEY = 'bond:seesShip';

/** Fallbacks for a declaration whose blackboard does not carry the keys yet (the owner's literal numbers). */
const DEFAULTS = Object.freeze({
  scale_first_kill: 2, scale_first_kill_max: 3,
  aspd_per_step: 0.01, aspd_step: 10, aspd_cap: 2,
  yukari_prob: 0.5, yukari_round_cap: 10,
  makoto_allout_bonus: 0.2,
  ctrl_prob_base: 0.1, ctrl_prob_per_layer: 0.002, ctrl_sluggish_sec: 2, ctrl_sp: 1, ctrl_cd_sec: 5,
  allout_atk_base: 2, allout_atk_per_layer: 0.05, allout_cd_sec: 30,
  shinko_gauge_max: 100, shinko_atk_base: 1, shinko_atk_per_layer: 0.03,
});

/** 控制状态（用户原话「停顿，束缚，击晕」）—— 顺序固定，便于确定性遍历。 */
export const CONTROL_STATUSES = Object.freeze(['sluggish', 'bind', 'stun']);

/**
 * The bond's own blackboard (`MOD_bond_sees`), or {} when the declaration is absent / predates the keys.
 *
 * 注意：`bb` 里的 `scale_first_kill` / `aspd_*` / `yukari_*` / `makoto_allout_bonus` 是上一版把规则写在盟约里
 * 时留下的键。用户 2026-10-16 裁决把这些规则**下放到干员驻防**之后，战斗侧不再读它们；
 * 数据里仍然保留（`DEFAULTS` 也留着）以便与 `data/bonds.json` 的既有字段兼容，但**权威值在驻防**。
 */
const seesBb = () => buffParams(bondRecord(BOND), MOD_KEY) ?? {};

/**
 * Install the battle side of 【SEES】. A no-op when no player has the bond active — the same guard the other add-on
 * bonds use (with no record in data/bonds.json `bondActive` is false and nothing is registered).
 */
export function installSees(battle) {
  if (!battle || !Array.isArray(battle.players) || !battle.players.length) return;
  const pids = new Set();
  for (const ps of battle.players) if (bondActive(battle, ps.playerId, BOND)) pids.add(ps.playerId);
  if (!pids.size) return;

  const bb = seesBb();
  // 盟约档位（3 名档 / 6 名档）的数值。四位成员各自的叠层/加成数值**不在这里** —— 它们在干员驻防里
  // （见下面的说明段落），由 server/sim/content/garrisons/battle.js 实现。
  const ctrlBase = num(bb.ctrl_prob_base, DEFAULTS.ctrl_prob_base);
  const ctrlPer = num(bb.ctrl_prob_per_layer, DEFAULTS.ctrl_prob_per_layer);
  const ctrlSec = num(bb.ctrl_sluggish_sec, DEFAULTS.ctrl_sluggish_sec);
  const ctrlSp = num(bb.ctrl_sp, DEFAULTS.ctrl_sp);
  const ctrlCd = num(bb.ctrl_cd_sec, DEFAULTS.ctrl_cd_sec);
  const alloutBase = num(bb.allout_atk_base, DEFAULTS.allout_atk_base);
  const alloutPer = num(bb.allout_atk_per_layer, DEFAULTS.allout_atk_per_layer);
  const alloutCd = num(bb.allout_cd_sec, DEFAULTS.allout_cd_sec);
  const gaugeMax = num(bb.shinko_gauge_max, DEFAULTS.shinko_gauge_max);
  const shinkoBase = num(bb.shinko_atk_base, DEFAULTS.shinko_atk_base);
  const shinkoPer = num(bb.shinko_atk_per_layer, DEFAULTS.shinko_atk_per_layer);

  /** 这位干员是不是本盟约的成员（含装备自授），且属于 `pid`。 */
  const mine = (u, pid) => !!u && isOp(u) && u.ownerId === pid && isMember(battle, u, BOND);
  /** 本玩家当前层数。 */
  const layersOf = (pid) => Math.max(0, num(bondLayers(battle, pid, BOND), 0));
  /** 每场战斗一次的计数器（一场战斗 = 一回合，见 unite.js 的注释）。 */
  const perBattle = (key, init) => battleStore(battle, `sees:${key}`, init);

  // ===================================================================================================================
  // 四位成员各自的**叠层 / 加成规则**不在这里 —— 按用户 2026-10-16 的裁决，它们写在**干员驻防**里
  // （tools/mod-content.mjs 的 MOD_GARRISONS → data/garrisons.json，卡片上就是「持续叠加」那一条，
  // 照波登可 garrison_102_a 的既有写法）：
  //
  //   garrison_kormr_kill_a      虎狼丸    前三次击杀，每次 +2 层（每回合上限 6）
  //   garrison_aigis_aspd_a      埃癸斯    每 10 层 +1% 攻速（最多 +200%），走 gar_eff_attrByBond
  //   garrison_yukari_ctrl_a     岳羽由加莉 范围内敌人被控时 50% 概率 +1 层（每回合上限 10）
  //   garrison_makoto_sees_a     结城理    在场时「总攻击」攻击力 +20%
  //
  // 战斗侧实现在 server/sim/content/garrisons/battle.js 的 INSTALLERS（本文件不重复实现同一件事）：
  // 前三条由那套引擎直接叠层/加 buff；第四条只维护「持有者在场」，由下面的 `makotoBonusOf` 读回乘算。
  // 本文件只负责**盟约档位**效果（3 名档 / 6 名档），那是盟约自己的语义，不属于任何一位干员。
  // ===================================================================================================================
  // 4. 3 名档：SEES 干员攻击命中重量 ≤3 的敌人时，有 (10 + 0.2×层数)% 概率使敌人停顿 2 秒，
  //    并回复自身 1 点技力。每 5 秒最多触发一次。
  //    「重量」= enemy.weight（targeting.js:193）；权威写法见 op-irene.js:114。
  //    冷却按**干员**记（`unit.mem`），照 addon/battle.js 的 STEAD_CD 写法。
  // ===================================================================================================================
  const TIER3 = 1; // bondTier 从 1 起算：thresholds [3,6] ⇒ 3 名档 = tier 1、6 名档 = tier 2
  const WEIGHT_MAX = 3;
  battle.on('hit', (c) => {
    const u = c.source;
    const t = c.target;
    if (!t || t.side !== 'enemy' || !t.alive) return;
    if (!u || !pids.has(u.ownerId) || !mine(u, u.ownerId)) return;
    if (bondTier(battle, u.ownerId, BOND) < TIER3) return;
    if (!(num(t.weight, 99) <= WEIGHT_MAX)) return;   // 「重量≤3」
    const last = num(u.mem?.seesCtrlAt, -Infinity);
    if (battle.time - last < ctrlCd) return;           // 「每5秒最多触发一次」
    const L = layersOf(u.ownerId);
    const p = ctrlBase + ctrlPer * L;
    if (!battle.rng.chance(p)) return;
    u.mem.seesCtrlAt = battle.time;
    battle.applyStatus(t, 'sluggish', { duration: ctrlSec, source: u });
    // 「回复自身1点技力」—— SP 记在单位的技能运行时上：`u.skill.gainSp(amount, reason)`
    // （server/sim/skills.js:326；仓库惯例见 content/bands/battle.js:168、bonds/addon/battle.js:565）
    if (ctrlSp > 0 && u.skill) u.skill.gainSp(ctrlSp, 'bond');
    fxOn(battle, 'bondProc', u, KEY, 'ctrl', { n: ctrlSp });
  });

  // ===================================================================================================================
  // 5a. 6 名档「总攻击」：场上**所有**敌人均处于停顿/束缚/眩晕时，
  //     SEES 干员的下一次攻击改为总攻击：对全场敌人造成 (200+5×层数)% 攻击力物理伤害，并清除所有敌人的控制状态。
  //     每 30 秒最多触发一次。结城理在场时额外 ×(1 + 20%)。
  // ===================================================================================================================
  const TIER6 = 2;
  const allControlled = () => {
    const foes = battle.enemies.filter((e) => e.alive && e.deployed);
    if (!foes.length) return false;
    for (const e of foes) {
      const f = e.s?.flags || {};
      if (!(f.sluggish || f.bind || f.stun)) return false;
    }
    return true;
  };
  /**
   * 结城理「在场时总攻击 +20%」：数值按用户裁决写在他的**驻防** `garrison_makoto_sees_a` 的 `bb.allout_bonus` 里
   * （卡片上那条「作战能力」），这里只是把它**读回**来乘算 —— 不重复实现同一件事。
   * 读不到（他没带那条驻防 / 不在场）时回落盟约 bb 的 `makoto_allout_bonus`，再回落用户原话的 0.2。
   */
  const makotoBonusOf = (pid) => {
    const fromGarrison = garrisonBonus(battle, pid, ALLOUT_BONUS_KEY, 'allout_bonus');
    if (fromGarrison > 0) return fromGarrison;
    return 0;
  };
  battle.on('hit', (c) => {
    const u = c.source;
    const t = c.target;
    if (!u || !t || t.side !== 'enemy') return;
    if (!pids.has(u.ownerId) || !mine(u, u.ownerId)) return;
    if (bondTier(battle, u.ownerId, BOND) < TIER6) return;
    if (!allControlled()) return;
    const last = num(u.mem?.seesAlloutAt, -Infinity);
    if (battle.time - last < alloutCd) return;
    u.mem.seesAlloutAt = battle.time;
    const L = layersOf(u.ownerId);
    const scale = alloutBase + alloutPer * L;
    const bonus = 1 + makotoBonusOf(u.ownerId);
    for (const e of battle.enemies.filter((x) => x.alive)) {
      battle.dealDamage(u, e, battle.makeDamage({
        amount: u.s.atk * scale * bonus, type: 'phys', isSplash: true, tags: ['allout'],
      }));
    }
    // 「并清除所有敌人的控制状态」：把三种控制 buff 一并撤掉
    for (const e of battle.enemies.filter((x) => x.alive)) {
      for (const s of CONTROL_STATUSES) battle.removeBuff(e, s);
    }
    fxOn(battle, 'bondProc', u, KEY, 'allout', { n: scale });
  });

  // ===================================================================================================================
  // 5b. 6 名档「神通法」：SEES 干员每次造成伤害 / 治疗 / 获得层数时计量表累积；满 100 后该干员的
  //     下一次技能强化为神通法，额外造成 (100+3×层数)% 攻击力真实伤害（无视防御与法抗）。
  //     每位干员独立，每场战斗每人最多一次。
  //     [ASSUMED] 「下一次技能」= 满表之后该干员的下一次 skillStart；结算在其技能命中（hit）时。
  // ===================================================================================================================
  const gaugeStore = () => perBattle('shinkoGauge', () => new Map());
  const usedStore = () => perBattle('shinkoUsed', () => new Set());
  const addGauge = (u, n) => {
    if (!u || !(n > 0) || !pids.has(u.ownerId) || !mine(u, u.ownerId)) return;
    if (bondTier(battle, u.ownerId, BOND) < TIER6) return;
    const g = gaugeStore();
    const cur = num(g.get(u.id), 0);
    if (cur >= gaugeMax) return;
    g.set(u.id, Math.min(gaugeMax, cur + n));
  };
  // 造成伤害 / 治疗 → 累积（层数累积走 layerGain 钩子，见下）
  battle.on('damaged', (c) => { if (c.source && c.amount > 0) addGauge(c.source, 1); });
  battle.on('heal', (c) => { addGauge(c.source, 1); });
  battle.on('layerGain', (c) => { if (c.bondId === BOND) addGauge(c.source, 1); }, { priority: -200 });
  // 满表 ⇒ 给该干员挂一次性标记，等它的下一次技能
  battle.on('skillStart', (c) => {
    const u = c.unit;
    if (!u || !pids.has(u.ownerId) || !mine(u, u.ownerId)) return;
    if (bondTier(battle, u.ownerId, BOND) < TIER6) return;
    if (num(gaugeStore().get(u.id), 0) < gaugeMax) return;
    if (usedStore().has(u.id)) return;
    u.mem.shinkoReady = true;
  });
  // 被强化的技能命中时结算真实伤害，并标记「本场已用」
  battle.on('hit', (c) => {
    const u = c.source;
    const t = c.target;
    if (!u || !t || t.side !== 'enemy' || !t.alive) return;
    if (!u.mem?.shinkoReady) return;
    if (!pids.has(u.ownerId) || usedStore().has(u.id)) return;
    u.mem.shinkoReady = false;
    usedStore().add(u.id);
    const L = layersOf(u.ownerId);
    const scale = shinkoBase + shinkoPer * L;
    battle.dealDamage(u, t, battle.makeDamage({
      amount: u.s.atk * scale, type: 'true', tags: ['shinko'],
    }));
    fxOn(battle, 'bondProc', u, KEY, 'shinko', { n: scale });
  });
}
