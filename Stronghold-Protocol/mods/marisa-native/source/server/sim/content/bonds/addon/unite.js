// server/sim/content/bonds/addon/unite.js — battle side of the MOD bond 我们联合 (`uniteShip`).
//
// Registered from addon/battle.js (that file keeps a one-line stub: `installUnite(battle)`); every implementation detail
// lives here, beside addon/unite-meta.js (the prep side, 五年计划). Nothing here changes an upstream public API.
//
// The owner's text, verbatim (as of the 2026-10-16 rework — the two superseded clauses are kept in the sections below):
//
//   盟约：我们联合
//   古米（发动技能时，我们联合叠1层，触发学生互助会叠2层），凛冬（发动技能叠1层，触发学生互助会叠2层），
//   怒潮凛冬（击杀叠2层，触发学生互助会叠3层）赫拉格（击杀叠2层，触发学生互助会叠3层）
//   场上存在1名干员时激活效果：学生互助会
//   我们联合每回合最多叠加10层
//   学生互助会改为，干员被击倒时，周围八格随机一名干员伸出援手，两名干员平均生命值，被击倒干员立即复活，
//   在3秒内获得20减伤。每回合一名干员伸出援手一次。
//
// =====================================================================================================================
// 叠层 (layer gains)
//
//   古米 chess_char_1_10_a    发动技能 (skillStart)  +1   ·  互助会触发时 +2
//   凛冬 chess_char_115_headbr_a  发动技能 (skillStart)  +1   ·  互助会触发时 +2
//   怒潮凛冬 chess_char_1051_headb2_a  击杀 (kill)         +2   ·  互助会触发时 +3
//   赫拉格 chess_char_188_helage_a     击杀 (kill)         +2   ·  互助会触发时 +3
//
// The two hooks are the engine's own: `skillStart` (skills.js:560) and `kill` (battle/deploy.js:85, ctx
// `{ killer, victim }`). A kill counts only for an ENEMY victim (`victim.side === 'enemy'`), the precedent of
// kits/ops/chess_char_5_19-mlynar.js:51.
//
// WHO the four are is NOT hard-coded by charId: membership is `support.isMember(battle, u, 'uniteShip')` (a chess's own
// `bonds` — every member's record carries `uniteShip`), exactly like every other bond in this directory. The
// baseChessId tables below only pick WHICH of the two groups a member belongs to, i.e. how much it stacks, which the
// task brief explicitly allows. A member whose baseChessId is in neither table (a non-member that gained the bond
// through 变形同构体, or a later member added to the declaration) stacks nothing here [ASSUMED].
//
// Every amount is read from the bond's own record buff (`MOD_bond_unite`, the record key — this bond is not an
// `env_gbuff_new` record, see BB_KEY in addon/battle.js) and only falls back to the constants below when the blackboard
// does not carry the key. A declaration that predates those keys therefore still behaves as the owner specified.
//
//   bb.layer_on_skill   (+1)   古米 / 凛冬: 发动技能
//   bb.layer_on_kill    (+2)   怒潮凛冬 / 赫拉格: 击杀
//   bb.aid_layer_skill  (+2)   古米 / 凛冬: 互助会触发
//   bb.aid_layer_kill   (+3)   怒潮凛冬 / 赫拉格: 互助会触发
//
// =====================================================================================================================
// 学生互助会 (Student Mutual Aid Society) — REWRITTEN by the owner ruling of 2026-10-16
//
//   「学生互助会改为，干员被击倒时，周围八格随机一名干员伸出援手，两名干员平均生命值，被击倒干员立即复活，
//     在3秒内获得20减伤。每回合一名干员伸出援手一次。」
//
//   Trigger: the engine's `death` hook, `ctx.reason === 'killed'` only (a 撤退 / 联防 forced exit is not 被击倒).
//   Condition: the bond is active for the knocked-out operator's owner AND at least one ELIGIBLE friendly operator
//   stands on one of the 8 tiles around it (support `N8` + `alliesAround` — N8 is the full ring, the unit's own tile
//   excluded; it is invariant under the victim's direction, so `alliesAround`'s rotation is immaterial here).
//   Helper: EXACTLY ONE of those eligible operators, drawn with `battle.rng.pick` — the sanctioned deterministic RNG of
//   `server/sim/` (Math.random is forbidden here; rng.js documents the stream, and `battle.rng` is seeded per battle, so
//   the draw replays identically). Before the ruling EVERY ally in the ring took part; now the text says 随机一名.
//   Group: the knocked-out operator + the one helper — TWO operators (the text says 两名干员).
//   Effect: those two operators average their HP ((victim + helper) ÷ 2, each written back clamped to its own `s.maxHp`
//   and floored at 1), the knocked-out operator revives at once, and the two take 20 % less damage for 3 s.
//
//   每回合一名干员伸出援手一次: an operator that has already been the helper once this round is NOT eligible again, so a
//   round with enough knock-outs cannot funnel them all through the same ally. The bookkeeping is a per-player Set of
//   unit ids in a battleStore (one battle = one round — support/index.js:308), i.e. exactly the 古米-cap lifetime.
//   A victim whose ring holds only already-spent helpers gets no aid at all (the quota is per helper, not per victim).
//
// ORDER MATTERS: `reviveNow` (content/items/battle.js) is `battle.redeploy(u, { free: true })`, i.e. a full-HP redeploy
// with a SP reset. The average is therefore computed from the pre-revive HP of the pair (the victim's is 0 — `kill()`
// writes `unit.hp = 0` before `_remove` fires `death`, battle/deploy.js:84) and written back AFTER the revive, over the
// revived operator too, so it stands at the average and not at full HP. A write is skipped for any pair member that is
// not alive (a dead operator must keep hp 0 — test/helpers/battleHarness.js checkInvariants).
//
// The revive gates the whole effect: `reviveNow` returns false when the operator's rest tile is taken by another body,
// and the clause reads 「平均生命值**并**复活」 as one effect [ASSUMED]. The helper is marked as spent only AFTER the
// revive succeeds, so a failed revive wastes neither the helper's quota nor the aid.
//
// 减伤 20 % is `dmgTakenMul: 0.8` — that key is the multiplier on damage TAKEN (buffs.js MUL_KEYS, damage.js:307), so
// 0.8 is −20 %, the precedent of kits/ops/chess_char_5_19-mlynar.js's damage_resistance reading.
//
// =====================================================================================================================
// 'death' priority: PRIO_AID = 9
//
// The revive-class savers are ordered, highest first: M3茧甲 PRIO_RESPAWN 13 (items/battle.js:80), 埃芒加德
// PRIO_BAND_REVIVE 12 (bands/battle.js:60), 阿戈尔 5's first-knock-out revive 11 (bonds/core.js:546), 不屈 10
// (addon/battle.js:976). The aid must judge AFTER all of them — 「互助会应在别人救起之后判断」 — and the engine's
// `on()` inserts by descending priority (battle/hooks.js:22), so 9 is the value directly below 不屈 10: every other
// rescue has had its say, and `c.revivedBy` / `u.alive` tell us whether the operator is already standing. 9 also stays
// above the default 0, so the aid still runs before the ordinary bookkeeping handlers.
//
// A knock-out another mechanism already picked up is skipped outright (`u.alive || u.removed`), which is what makes the
// order safe: 不屈's own "立刻重新部署" redeploys in place, and the aid must not average a group around an operator that
// is already back on its feet (that would also double-charge 减伤).

import {
  num, bondRecord, buffParams, bondActive, isMember, isOp, onField, playerOps, gainLayers, fxOn, baseChessId, N8, alliesAround,
  directMods, passiveBuff, battleStore, bondLayers,
} from '../../support/index.js';
import { reviveNow } from '../../items/battle.js';

/** The bond (locked id). */
export const BOND = 'uniteShip';
/** Its own record buff key (`bbStr.key` / `key` of the bond's single buff) — read through BB_KEY in addon/battle.js. */
export const MOD_KEY = 'MOD_bond_unite';
/** fx `src` / namespaced buff key of this bond's effects. */
export const KEY = 'bond:uniteShip';
/** The 3 s 减伤 30 % buff the aid puts on the whole group. */
export const GUARD_KEY = 'bond:unite:guard';
/** `death` priority (see the header: directly below 不屈's 10, after every other revive). */
export const PRIO_AID = 9;
/** 减伤 20 % (owner ruling 2026-10-16; was 30 %): the damage-TAKEN multiplier (not 0.2). */
const GUARD_TAKEN_MUL = 0.8;
const GUARD_SEC = 3;

/** Fallbacks for a declaration whose blackboard does not carry the keys yet (the owner's literal numbers). */
const DEFAULTS = Object.freeze({ layer_on_skill: 1, layer_on_kill: 2, aid_layer_skill: 2, aid_layer_kill: 3 });
/**
 * 古米 / 凛冬 — the 发动技能 group. baseChessId: normal and elite share it (support.baseChessId).
 *
 * 用户 2026-10-16 的裁决「各个干员的叠层方式要在干员特质里写」把这些规则**下放到了干员自己的特质**
 * （`trait.bb.mod_unite_*`，声明在 `tools/mod-content.mjs` 的 `MOD_TRAIT_RULES`，见 `docs/SEES-TRAIT-LAYERS.md`）。
 * 所以下面这三张表不再决定"谁叠几层"，而是**读出厂的回落表**：读得到就由 `layerOf()` 用干员自己的数值，
 * 读不到（旧数据 / 精简语料）才用盟约 bb 的 `layer_on_skill` 等键。保留数组是为了那个回落路径，
 * 以及"这位是不是这一组的成员"这个仍然要答案的问题。
 */
const SKILL_MEMBERS = Object.freeze(['chess_char_1_10_a', 'chess_char_115_headbr_a']);
/** 怒潮凛冬 / 赫拉格 — the 击杀 group. */
const KILL_MEMBERS = Object.freeze(['chess_char_1051_headb2_a', 'chess_char_188_helage_a']);

// =====================================================================================================================
// Owner rulings of 2026-10 (the two additions) and 2026-10-16 (the cap widened to the whole bond)
//
//   1. 「古米叠层增加限制，技能触发时叠层每回合不超过10层」   ← SUPERSEDED by the 2026-10-16 ruling below
//      It used to cap ONLY 古米 (chess_char_1_10_a) and ONLY the 发动技能 (skillStart) source. Kept here as history.
//
//   1b. 2026-10-16 「我们联合每回合最多叠加10层」
//      The cap is now the BOND's, not one member's and not one source's: **every** layer 我们联合 gains in a round,
//      from every source (技能发动 / 击杀 / 学生互助会), counts against one shared quota of 10, and the excess is
//      dropped. The owner chose this reading explicitly (选项 1 of the 2026-10-16 question) and added
//      「文本也要跟进，还有保证能正常显示」 — so the declaration text must say the same thing (see the 文案 task).
//      Implemented through the shared entry point's own per-battle cap (`gainLayers`' `cap` / `capKey`,
//      support/index.js:332-357 — the 「每场战斗至多N层」 mechanism the engine already has), so the counter, the
//      clamping and the "hook extras (魔王) don't count toward it" semantics are the engine's, not a private one.
//      「每回合」 = one battle: `battle.round` is fixed when the Battle is built (Battle.js:81) and a battleStore is
//      per-Battle (support/index.js:308), so the cap's lifetime IS the round.
//      RETIRED: the per-古米 counter and `bb.gumi_skill_layer_per_round_max`. A declaration still carrying that key
//      keeps working because the bond-wide cap is the stricter one whenever it is ≤ that value.
//
//   2. 「凛冬和怒潮凛冬增加，我们联合每10层，攻击和生命增加5%，不超过100%」
//      ONLY 凛冬 (chess_char_115_headbr_a) and 怒潮凛冬 (chess_char_1051_headb2_a). Both get ATK and max HP
//      +stat_per_step (5 %) per full stat_step (10) layers, capped at stat_cap (100 %): floor(L / 10) × 5 %.
//      Applied as the ordinary 直接乘算 aura (support.directMods → atkPct / hpPct), re-read on every layer
//      gain the way addon/battle.js's own auras do (a `layerGain` hook that re-reads the LIVE layers on the
//      next tick — the gain is recorded after the hook fires, bonds/core.js:142-149).
// =====================================================================================================================
/** 古米: the only member whose skill-start layer gain used to be capped (kept for the 互助会 quota tables). */
export const GUMI = 'chess_char_1_10_a';
/** 凛冬 / 怒潮凛冬: the two members that scale their own ATK and max HP with the bond's layers. */
const STAT_MEMBERS = Object.freeze(['chess_char_115_headbr_a', 'chess_char_1051_headb2_a']);
/** Fallbacks for the two additions (the owner's literal numbers). */
const STAT_DEFAULTS = Object.freeze({ stat_per_step: 0.05, stat_step: 10, stat_cap: 1 });
/** 2026-10-16 「我们联合每回合最多叠加10层」 — the bond-wide per-round quota (all sources share it). */
export const LAYER_PER_ROUND_MAX = 10;
/** The `capKey` of that quota in support's per-battle cap store (one key per bond, shared by every source). */
export const LAYER_CAP_KEY = 'uniteShip:layersPerRound';
/** The aura's buff key (one per unit: it is replaced in place, never stacked). */
export const STAT_KEY = 'bond:uniteShip:stat';

/** The bond's own blackboard (`MOD_bond_unite`), or {} when the declaration is absent / predates the keys. */
const uniteBb = () => buffParams(bondRecord(BOND), MOD_KEY) ?? {};
const int = (v, d) => Math.max(0, Math.floor(num(v, d)));

/**
 * Install the battle side of 我们联合. A no-op when no player has the bond active (the declaration is another author's
 * task: with no record in data/bonds.json `bondActive` is false and nothing is registered, exactly like the other
 * add-on bonds' `st.tiers[id] <= 0` guard).
 */
export function installUnite(battle) {
  if (!battle || !Array.isArray(battle.players) || !battle.players.length) return;
  const pids = new Set();
  for (const ps of battle.players) if (bondActive(battle, ps.playerId, BOND)) pids.add(ps.playerId);
  if (!pids.size) return;

  const bb = uniteBb();
  // `layer_on_skill` / `layer_on_kill` 的战斗侧已下放到干员驻防（技能/击杀钩子由 garrisons/battle.js 挂），
  // 所以这里不再读它们；`aid_layer_*` 仍由本文件用（学生互助会触发时各自叠的额度）。
  const aidSkill = int(bb.aid_layer_skill, DEFAULTS.aid_layer_skill);
  const aidKill = int(bb.aid_layer_kill, DEFAULTS.aid_layer_kill);
  const statStep = Math.max(1, int(bb.stat_step, STAT_DEFAULTS.stat_step));
  const statPer = num(bb.stat_per_step, STAT_DEFAULTS.stat_per_step);
  const statCap = num(bb.stat_cap, STAT_DEFAULTS.stat_cap);

  /**
   * 「谁叠几层」的数值来源。
   *
   * 用户 2026-10-16 裁决：这类规则写在**干员驻防**里（照波登可 `garrison_102_a` 的既有写法，卡片上是
   * 「持续叠加」那一条；见 docs/SEES-GARRISON-MOVE.md）。战斗侧由
   * `server/sim/content/garrisons/battle.js` 的 `act1autochess_gar_event_useskill` /
   * `act1autochess_gar_event_selfkillenemy` 直接叠层 —— 所以本函数的技能/击杀两条路径**不再自己叠层**，
   * 只保留「学生互助会触发时各自叠多少」与「每 10 层的加成」这两件盟约自己的事。
   *
   * 曾经的两次错误尝试（都记在案上，避免重犯）：
   *   1. 把这些规则注入 `trait.desc`（位置错了，卡片上根本不该是特性）；
   *   2. 读 `trait.bb` 的 `mod_*` 键（同样是往特性里塞盟约规则）。
   * 现在的权威位置是驻防；盟约 bb 只负责全局量（每回合 10 层上限 / 每 10 层的加成）。
   */
  const aidLayerOf = (u) => {
    const id = baseChessId(u);
    return SKILL_MEMBERS.includes(id) ? aidSkill : KILL_MEMBERS.includes(id) ? aidKill : 0;
  };

  // 2026-10-16 「我们联合每回合最多叠加10层」: ONE quota shared by every source of this bond's layers
  // (技能发动 / 击杀 / 学生互助会). The engine's own per-battle cap does the clamping, so the excess is
  // dropped without a private counter and 魔王-style hook extras stay outside it (support/index.js:329).
  const layerCap = int(bb.layer_per_round_max, LAYER_PER_ROUND_MAX);

  /** One layer gain through the shared entry point (support.gainLayers — never `ps.bonds[...].layers` directly). */
  const grant = (u, n, reason) => {
    if (!(n > 0) || !u) return 0;
    const added = gainLayers(battle, {
      playerId: u.ownerId, bonds: BOND, n, requireActive: true, source: u, reason,
      // the bond-wide quota of the round; when a declaration asks for 0 / a negative quota, nothing is granted
      cap: layerCap, capKey: LAYER_CAP_KEY,
    });
    if (added > 0) fxOn(battle, 'layer', u, KEY, BOND, { bond: BOND, n: added });
    return added;
  };
  /** 学生互助会 quota: the set of operators that have already lent a hand this round (one per round each). */
  const helped = () => battleStore(battle, 'unite:aidHelper', () => new Set());

  // 凛冬 / 怒潮凛冬: 「每10层，攻击和生命增加5%，不超过100%」 — floor(L / step) × per, capped.
  // The buff is replaced in place (passiveBuff's refresh:'replace'), so a re-run after a layer gain
  // simply moves the number; a member that leaves the field keeps the match-long passive like the
  // other add-on auras do. Each player's own layer count drives their own units (two players on a
  // 联防 field never buff each other's — the file-wide rule of this directory).
  // 数值取盟约 bb 的 stat_step / stat_per_step / stat_cap（用户原话「每10层…各+5%（最多+100%）」）。
  const statPctOf = (pid) => {
    const L = Math.max(0, num(bondLayers(battle, pid, BOND), 0));
    return Math.min(statCap, Math.floor(L / statStep) * statPer);
  };
  const applyStats = () => {
    for (const pid of pids) {
      const pct = statPctOf(pid);
      for (const u of playerOps(battle, pid, { fieldOnly: false })) {
        if (!STAT_MEMBERS.includes(baseChessId(u))) continue;
        if (pct > 0) passiveBuff(battle, u, STAT_KEY, directMods({ atk: pct, hp: pct }));
        else battle.removeBuff(u, STAT_KEY);
      }
    }
  };
  applyStats();
  battle.on('battleStart', applyStats);
  battle.on('deploy', ({ unit }) => { if (unit && pids.has(unit.ownerId)) applyStats(); });
  battle.on('layerGain', (c) => {
    if (!pids.has(c.playerId) || c.bondId !== BOND) return;
    // the gain is written AFTER this hook, so re-read the live layers next tick (bonds/core.js:142)
    battle.after(0, applyStats);
  }, { priority: -100 });

  // 古米 / 凛冬的「发动技能时叠1层」与 怒潮凛冬 / 赫拉格的「击杀时叠2层」**不在这里** ——
  // 按用户 2026-10-16 的裁决，它们写在干员驻防里（garrison_headbr_skill_a / garrison_headb2_kill_a /
  // garrison_helage_kill_a），由 server/sim/content/garrisons/battle.js 的
  // act1autochess_gar_event_useskill / act1autochess_gar_event_selfkillenemy 直接叠层。
  // 本文件再挂同样的钩子会**双重计层**，所以刻意不挂。

  // 学生互助会 (rewritten 2026-10-16: 随机一名 helper / 两名干员平均生命值 / 20 减伤 / 每回合一名干员一次)
  battle.on('death', (c) => {
    if (c.reason !== 'killed') return;
    const v = c.unit;
    if (!isOp(v) || !pids.has(v.ownerId) || !bondActive(battle, v.ownerId, BOND)) return;
    // Someone else already picked it up (M3茧甲 13, 埃芒加德 12, 阿戈尔 11, 不屈 10 — all above PRIO_AID): leave it.
    if (v.alive || v.removed) return;
    // 「周围八格随机一名干员」: the eligible ring — a friendly operator (干员, so `isOp` keeps summons out) that has
    // NOT lent a hand yet this round. `alliesAround`/`allyAt` already require alive + not a device.
    const spent = helped();
    const ring = [];
    for (const a of alliesAround(battle, v, N8)) if (isOp(a) && onField(a) && !spent.has(a.id)) ring.push(a);
    if (!ring.length) return; // 「若周围八格存在干员」 / every eligible helper already spent this round
    // ONE helper, drawn deterministically: `battle.rng` is the seeded per-battle stream `server/sim/` sanctions
    // (rng.js; Math.random is banned here and the draw replays identically). Sorted by id first so the CANDIDATE
    // ORDER does not depend on the engine's internal iteration order — the same board then draws the same way.
    // A single candidate consumes NO draw (the house idiom: op-mantra.js:283 / op-cqbw.js:140 draw only when there
    // is a real choice), so a board with one neighbour keeps the battle's RNG stream untouched.
    ring.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const helper = ring.length === 1 ? ring[0] : battle.rng.pick(ring);
    if (!helper) return;
    // 「两名干员平均生命值」: the pair's total BEFORE the revive (the victim is at 0 right now — kill() wrote it
    // before `death` fired), averaged over TWO.
    const avg = (num(v.hp, 0) + num(helper.hp, 0)) / 2;
    if (!reviveNow(battle, c, 'bond')) return; // 「并复活」 — a rest tile taken by another body spends nothing
    spent.add(helper.id); // 「每回合一名干员伸出援手一次」 — spent only once the revive actually happened
    for (const a of [v, helper]) {
      if (!a.alive) continue; // a dead operator keeps hp 0 (checkInvariants)
      a.hp = Math.max(1, Math.min(a.s.maxHp, avg)); // the revived operator too: the average, never full HP
      battle.addBuff(a, { key: GUARD_KEY, duration: GUARD_SEC, mods: { dmgTakenMul: GUARD_TAKEN_MUL } });
    }
    fxOn(battle, 'bondProc', v, KEY, 'aid', { n: 2 });
    // 互助会触发时：在场四位成员各自叠自己的额度 (owner's ruling: 全员各自叠 — now inside the bond-wide 10/round quota).
    // 额度取这位干员自己特质里的 mod_unite_aid_layer（用户 2026-10-16 下放），读不到才回落「技能组 / 击杀组」。
    for (const m of playerOps(battle, v.ownerId, { fieldOnly: true })) {
      if (!isMember(battle, m, BOND)) continue;
      grant(m, aidLayerOf(m), 'bond');
    }
  }, { priority: PRIO_AID });
}
