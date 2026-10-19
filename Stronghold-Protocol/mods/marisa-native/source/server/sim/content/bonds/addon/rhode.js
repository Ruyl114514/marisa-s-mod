// server/sim/content/bonds/addon/rhode.js — battle side of the MOD bond 罗德岛 (`rhodeShip`), extracted from
// addon/battle.js so that the upstream shared file keeps only a thin registration stub (plan A1,
// docs/TASKS-AD.md §2). Nothing here changes an upstream public API: every symbol is either private to this
// file or re-exported by addon/battle.js for the existing tests.
//
// The runtime buff key is `MOD_bond_rhode` (data/bonds.json `rhodeShip.buffs[0]`, the same record as
// data/effects.json `bondeffect_rhode`) — unlike the other add-on bonds it is not an `env_gbuff_new` record,
// so its bb is read through MOD_KEY instead of `bondBb()`.
//
// Numbers come from that record's blackboard, never typed twice. The five clauses, the [ASSUMED] deviations of
// the DoT cap and the priority rationale are reproduced verbatim from addon/battle.js below.
//
//   罗德岛 rhodeShip   tier 1: a friendly non-member standing inside a member's CURRENT attack range gains n layers of ANY
//                      bond → 【罗德岛】 gains n too (hooked on the engine's `layerGain`, keyed on the gain's source unit; the
//                      member itself and other members never trigger it — a gain whose `source` is null cannot be located
//                      [ASSUMED]); every operator's healing received ×(1 + 0.01·floor(L/5)); damage over time landing on
//                      our operators ends 5 s after it landed (clause 3 — see the deviation note below); a healed operator
//                      deals 弱点伤害 to the enemies on the 8 tiles around it: actual heal × L × 0.1, credited to the healed
//                      operator (weaknessRetype, content/items/battle.js — the engine has no `weakness` damage type; the
//                      owner's decision for kill credit). The strike is guarded against re-entering itself: its damage
//                      names the healed operator, so a heal-driven trait it procs (咒愈师: 50 % of the damage dealt heals
//                      an ally — 刺玫's trait) would heal → strike → heal forever (each round × healRatio·L·0.1 ≈ 0.5,
//                      dying only below damage.js's 0.5 floor). Only the outermost strike of a chain fires. tier 2
//                      (2 distinct members on the field): a whole-field heal aura
//                      every interval(L) = 0.5 + 4.5·(1 − sqrt(L/100)) s — 5 s at L 0, 0.5 s at L ≥ 100 — of L HP per
//                      operator; the OVERHEAL (the heal minus the missing HP) becomes flat ATK 1:1 (`atkFlat`, additive
//                      with every other 直接乘算/加算), accumulating per operator up to 100 % of its own ATK and dropped 2 s
//                      after the last overflow. No caster heals the aura, so nothing gets its heal credit [ASSUMED].
//
// Hooks registered only when a bond needs them. Priorities: everything else on `addon/battle.js`'s bonds is 0 — except
// 罗德岛's `layerGain` −50 (clause 1: after 魔王's +n at 0, before the standing-buff re-read at −100) and its `heal`
// −1000 (clause 4: after every heal-amount modifier had its say, 明椒's included).
//
// 罗德岛 clause 3 ("我方干员受到的持续性伤害不超过5秒") has NO engine choke point. A damage-over-time effect in this
// engine is any buff with `interval` + an `onTick` that damages its own unit (ab:bleed — arts, tags ['enemyAbility',
// 'bleed']; boss:*Dot — phys; 深水区 / 污染 — true 'dot'), the engine has no hook for a buff being applied and no marker on
// a buff saying whether it deals damage, and enemy zones deal their tick from their own poll instead of a buff at all.
// The closest faithful version: Battle.addBuff — the point where a DoT lands — is wrapped once, every periodic buff with a
// finite declared duration landing on one of our operators is cut to dot_duration_cap s at once, and its first tick
// decides: damage taken (the operator's `stats.taken` rose) keeps it a DoT for good, no damage gives the buff its natural
// remaining time back and it is never cut again. Deviations [ASSUMED], all noted at installRhodeDotCap: a DoT whose
// `interval` is longer than the cap cannot be pre-cut (that would destroy a harmless slow buff before its first tick) and
// is only cut once it has damaged; a tick fully absorbed by a shield / 无敌 proves nothing; a never-expiring periodic buff
// (duration Infinity — 深水区's water, ab:pilot, auras) is presence-based rather than a timed DoT and is left alone.

import { aggregateMods } from '../../../buffs.js';
import { weaknessRetype } from '../../items/battle.js';
import { num, bondLayers, activeBondIds, isOp, onField, fxOn, gainLayers, inRange, baseChessId, battleStore, COLS, passiveBuff } from '../../support/index.js';

/** 罗德岛 (`rhodeShip`) — the locked bond id this file implements. */
export const BOND = 'rhodeShip';
/** The runtime buff key of its record in data/bonds.json / data/effects.json. */
export const MOD_KEY = 'MOD_bond_rhode';
/** Standing-buff keys owned by this file (mirrored into addon/battle.js's `KEY` for the tests). */
export const KEY = Object.freeze({ heal: 'bond:rhodeShip:heal', atk: 'bond:rhodeShip:overflow' });

/** Live layers of `id` for the state's player (same helper addon/battle.js keeps for itself). */
const L = (battle, st, id) => bondLayers(battle, st.pid, id);
/** Same guard as units.js `_recalc` (finite or the fallback) — used only by rhodeOverflowAtk. */
const fin = (v, d) => (Number.isFinite(v) ? v : d);

// 罗德岛 rhodeShip (data/bonds.json `rhodeShip`, `spec.tiers`; bb = MOD_bond_rhode, see RHODE_MOD_KEY)

/** "受治疗效率提升（每5层+1%）": the target-side multiplier of the heal pipeline, 1 + 0.01·floor(L / 5). */
export function rhodeHealMul(bb, L) {
  const step = Math.max(1, Math.floor(num(bb.heal_eff_step, 5)));
  return 1 + num(bb.heal_eff_per_step, 0.01) * Math.floor(Math.max(0, num(L, 0)) / step);
}

/**
 * "治疗光环频次受层数影响［间隔(L) = MIN + (MAX − MIN) × (1 − sqrt(L / L_max))］": 5 s at L 0, 0.5 s at L 100 (the
 * formula's own domain — layers above aura_l_max are clamped, BOND_LAYER_CAP 999 would drive it negative otherwise).
 */
export function rhodeAuraInterval(bb, L) {
  const min = num(bb.aura_interval_min, 0.5), max = num(bb.aura_interval_max, 5);
  const lMax = Math.max(1e-9, num(bb.aura_l_max, 100));
  const l = Math.max(0, Math.min(lMax, num(L, 0)));
  return Math.max(0, min + (max - min) * (1 - Math.sqrt(l / lMax)));
}

/**
 * MOD（负责人 2026-10-07 追加的设定）：【罗德岛】的层数不会超过**已激活的其他盟约**中最高的层数。
 * 上限在每次加层时现算：没有任何其他已激活盟约（或它们都还是 0 层）时上限为 0，罗德岛也就不再叠层。
 * 这是加层入口 `layerGain` 上的钳制（见 installRhodeCap），所以不分来源 —— 镜像、驻防、道具、盟约之币、
 * 其它盟约的加成一律受限。
 */
export function rhodeLayerCap(battle, st) {
  let cap = 0;
  for (const id of activeBondIds(battle, st.pid)) {
    if (id === BOND) continue;
    cap = Math.max(cap, bondLayers(battle, st.pid, id));
  }
  // The bond that TRIGGERED a mirror has not been written yet when the nested 罗德岛 gain fires (addLayers emits
  // `layerGain` before it writes the layers), so the mirror path carries the post-gain count in as `rhodeCapHint`.
  return Math.max(cap, num(st.rhodeCapHint, 0));
}

/**
 * 在场【罗德岛】干员数（负责人 2026-10-08 的叠层效率按这个数算）：同一干员的普通/精锐只算一名，与该盟约的
 * BOARD 计数一致（`st.members` = 自己的 bonds 含 rhodeShip 的干员，含已倒下/未部署的，所以这里按 `onField` 过滤）。
 */
export function rhodeFieldCount(st) {
  const seen = new Set();
  for (const m of st.members[BOND]) if (onField(m)) seen.add(baseChessId(m));
  return seen.size;
}

/**
 * 叠层效率 (owner 2026-10-09, replacing the 2026-10-08 "per member × 25 %" ramp): a TWO-STEP curve — under
 * `bb.field_eff_member_min` (4) members the board stacks at `bb.field_eff_low` (50 %), and from that many members on at
 * `bb.field_eff_max` (100 %). The floor is applied once, to the layer total (the `layerGain` clamp below), never to the
 * efficiency itself. The PREP side mirrors this curve in server/match/rhodeMeta.js (rhodeEffOf) — the two halves of
 * clause 1 have to agree.
 *
 * Falls back to the old ramp (`field_eff_per_member × members`, capped at `field_eff_max`) when `field_eff_member_min`
 * is absent, so a data file that predates the 2026-10-09 curve still resolves.
 */
export function rhodeEffOf(bb, count) {
  const b = bb || {};
  const n = Math.max(0, num(count, 0));
  const min = num(b.field_eff_member_min, 0);
  if (min > 0) return n >= min ? num(b.field_eff_max, 1) : num(b.field_eff_low, 0.5);
  return Math.min(num(b.field_eff_max, 1), Math.max(0, num(b.field_eff_per_member, 0.25) * n));
}

/**
 * 【罗德岛】clause 1: "干员攻击范围内的其他非【罗德岛】干员叠加任何盟约层数时，同时叠加相等的【罗德岛】层数".
 * The engine's `layerGain` hook is the single layer-gain choke point (support.gainLayers → Battle.addLayers emits it for
 * every source: garrisons, traits, bands, items, choices, other bonds), and its ctx carries the gain's source unit —
 * the operator that gained. The grant itself is a plain support.gainLayers call, so the caps, the 魔王-style `layerGain`
 * modifiers (ctx.n) and the `layer` event of the nested gain all behave as they do for any other content.
 * The mirrored gain is skipped when the trigger is 罗德岛's own (it would feed itself) — the hook fires again for it.
 */
function rhodeMirror(battle, st, c) {
  const src = c.source;
  if (!src || src.kind !== 'op' || src.ownerId !== st.pid || !onField(src)) return 0;
  if (st.members[BOND].has(src)) return 0; // the member itself and other members never trigger it
  // CURRENT attack range of ANY on-field member of the player (support.inRange reads unit.rangeKeySet, refreshed with the
  // member's own range / direction changes); a knocked-out member has no range to stand in.
  let covered = false;
  for (const m of st.members[BOND]) if (onField(m) && inRange(m, src)) { covered = true; break; }
  if (!covered) return 0;
  const n = Math.floor(num(c.n, 0));
  if (!(n > 0)) return 0;
  // MOD (owner 2026-10-07): 罗德岛 may not out-layer the ACTIVE other bonds, and the triggering bond has not been
  // written yet (addLayers emits `layerGain` before it writes), so carry its post-gain count in as the cap hint for the
  // nested 罗德岛 gain this mirror is about to make.
  const hint = st.rhodeCapHint;
  st.rhodeCapHint = bondLayers(battle, st.pid, c.bondId) + n;
  let added;
  try {
    added = gainLayers(battle, { playerId: st.pid, bonds: BOND, n, requireActive: true, source: src, reason: 'bond' });
  } finally {
    st.rhodeCapHint = hint;
  }
  if (added > 0) fxOn(battle, 'bondProc', src, 'bond:rhodeShip', 'mirror', { n: added });
  return added;
}

/**
 * 【罗德岛】clause 4: "我方干员被治疗时，按实际被治疗的量对其周围8格造成弱点伤害（治疗量×层数×10%）". Hooked on the
 * engine's `heal` event, which fires before the HP is written and carries the amount after every multiplier (the source's
 * `healingDealtMul`, the target's `healingTakenMul` — clause 2's included), so "the amount actually restored" is the
 * engine's own clamp min(amount, missing HP) computed here exactly as damage.js does it. Priority −1000: every heal
 * amount modifier (明椒's talent …) has had its say by then.
 * 弱点伤害 has no damage type of its own: the instance is a phys/arts one retyped to whatever the victim resists less
 * (weaknessRetype, content/items/battle.js — 结城理's S3 uses the same helper), credited to the healed operator: that is
 * the owner's decision for the kill credit, and it is what makes the operator's 造成伤害 / the player's tally count it.
 * Being the healed operator's own damage instance, it rides that operator's own damage-dealt modifiers (as any damage it
 * deals does) on top of the fixed `healed × L × 0.1`.
 */
function rhodeHealStrike(battle, st, t, amount) {
  const bb = st.bb[BOND];
  const lv = L(battle, st, BOND);
  const dmgAmount = amount * lv * num(bb.weakness_scale, 0.1);
  if (!(dmgAmount > 0)) return 0;
  // "周围8格" = the ring of Chebyshev radius weakness_radius (1 in the record: the 8 neighbours, the tile it stands on
  // excluded), clipped to the field
  const radius = Math.max(1, Math.floor(num(bb.weakness_radius, 1)));
  const keys = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
      const r = t.tileR + dr, c = t.tileC + dc;
      if (battle.grid.inRect(r, c)) keys.push(r * COLS + c);
    }
  }
  let hit = 0;
  // the engine's ally-side area selection (enemiesInKeys: no untargetable / 隐匿 enemy, no ground-only miss for a member
  // that cannot hit flyers — the same selector every other "周围" effect of this module uses)
  for (const e of battle.enemiesInKeys(keys, t, t.profile)) {
    if (!e.alive) continue;
    const d = battle.makeDamage({ amount: dmgAmount, type: 'arts', canDodge: false, tags: ['bond:rhodeShip', 'weakness'] });
    weaknessRetype(d, t, e);
    battle.dealDamage(t, e, d);
    hit++;
    fxOn(battle, 'strike', e, 'bond:rhodeShip', 'weakness', { from: t.id, n: Math.round(dmgAmount) });
  }
  return hit;
}

/** "场上同时存在两名罗德岛干员": 2 DISTINCT members on the board (support.baseChessId — a copy of one member is one). */
function rhodeAuraOn(battle, st) {
  const seen = new Set();
  for (const m of st.members[BOND]) if (onField(m)) seen.add(baseChessId(m));
  return seen.size >= 2;
}

/**
 * 【罗德岛】clause 5: "当场上同时存在两名罗德岛干员时，全场获得治疗光环。每5秒对全场施加一次治疗，治疗量为【罗德岛】
 * 层数；溢出的治疗量等量转化为攻击力（不超过自身攻击力的100%，2秒内不再溢出则消失），治疗光环频次受层数影响。"
 * The scheduler re-arms itself with the interval of the LIVE layer count at each pulse (`interval(L)`, rhodeAuraInterval):
 * the pulse is due at the nominal time, so the poll's 1/30 s granularity never accumulates.
 * The heal itself goes through battle.heal (禁疗 / noHeal units are refused by the pipeline, as for any other heal — a unit
 * that cannot receive the heal gets neither HP nor the overflow, so it is skipped); it is 无来源 (source null) — no caster
 * exists, so no unit's heal stat and no player's healingDone counts it [ASSUMED].
 * "全场" = the player's own operators on the field (the bond's 干员 vocabulary; a token / summon is not a 干员).
 * The overheal is `amount − actual`, with `actual` what battle.heal restored and `amount` the engine's own amount for this
 * heal — L × the target's healingTakenMul (clause 2's bonus included), or whatever a later `heal` handler made of it
 * (captured by the clause 4 hook at priority −1000, 明椒's talent included). It is 0 while the unit is missing HP.
 */
function rhodeAtkBasis(u) {
  // Exclude this bonus from its own cap. atkFlat would multiply the overflow by every ATK% skill again;
  // atkFinal bypasses ATK%, and dividing by the final multipliers preserves the promised actual ATK 1:1.
  const { add: m, mul } = aggregateMods(u.buffs.filter((b) => b.key !== KEY.atk));
  const finalMul = (mul.atkMul ?? 1) * (u.cultMul?.atk ?? 1);
  const b0 = u.base;
  const own = Math.max(0, fin(((b0.atk + (m.atkFlat ?? 0)) * Math.max(0, 1 + (m.atkPct ?? 0)) + (m.atkFinal ?? 0)) * finalMul, fin(b0.atk, 0)));
  return { own, finalMul };
}

function rhodeAtkTick({ unit: u, buff }) {
  const { own, finalMul } = rhodeAtkBasis(u);
  // Skill endings and expiring buffs can lower the cap between aura pulses. Do not refresh the expiry here.
  buff.data.amount = Math.min(buff.data.amount, own * buff.data.capRatio);
  const value = finalMul > 0 ? buff.data.amount / finalMul : 0;
  if (buff.mods.atkFinal !== value) { buff.mods.atkFinal = value; u.markDirty(); }
}

function rhodeOverflowAtk(battle, u, overflow, bb, decay) {
  const cur = u.findBuff(KEY.atk);
  const { own, finalMul } = rhodeAtkBasis(u);
  if (!(finalMul > 0)) { battle.removeBuff(u, KEY.atk); return 0; }
  const prev = cur ? num(cur.data.amount, 0) : 0;
  const capRatio = Math.max(0, num(bb.aura_atk_cap_ratio, 1));
  const cap = capRatio * own;
  const next = Math.min(cap, prev + overflow);
  if (!(next > 0)) return 0;
  // one buff per operator, replaced by every overflow: its own `duration` is the "2秒内不再溢出则消失" timer, and reading
  // the total back from its data means an expiry (or a death, which drops non-persistent buffs) starts from 0 again
  battle.addBuff(u, { key: KEY.atk, duration: decay, refresh: 'replace', mods: { atkFinal: next / finalMul },
    data: { amount: next, capRatio }, onTick: rhodeAtkTick });
  return next;
}

/** 禁疗: the heal pipeline refuses this unit (damage.js heal, source null ⇒ not `self`). */
const rhodeHealRefused = (u) => !!(u.s.flags.noHeal || u.s.flags.healFree || (u.profile && u.profile.noHeal));

function rhodePulse(battle, st) {
  const bb = st.bb[BOND];
  const decay = num(bb.aura_decay_sec, 2);
  const lv = L(battle, st, BOND);
  const interval = rhodeAuraInterval(bb, lv);
  if (rhodeAuraOn(battle, st)) {
    let anchor = null;
    for (const u of st.ops) {
      if (!onField(u)) continue;
      anchor ??= u;
      if (rhodeHealRefused(u)) continue;
      st.probe = u;
      st.probeAmt = null;
      const actual = battle.heal(null, u, lv);
      st.probe = null;
      const amount = st.probeAmt != null ? st.probeAmt : lv * num(u.s.healingTakenMul, 1);
      const overflow = Math.max(0, amount - actual);
      if (overflow > 0 && decay > 0) rhodeOverflowAtk(battle, u, overflow, bb, decay);
    }
    if (anchor) fxOn(battle, 'bondProc', anchor, 'bond:rhodeShip', 'aura', { L: lv, interval });
    // content event: the aura pulsed (the client's own heal numbers ride on the engine's heal events)
    battle.emit('rhodeAura', { playerId: st.pid, layers: lv, interval, heal: lv });
  }
  return interval;
}

function installRhodeAura(battle, st) {
  const arm = () => {
    if (battle.finished) return;
    st.auraAt = (st.auraAt ?? battle.time) + rhodeAuraInterval(st.bb[BOND], L(battle, st, BOND));
    battle.after(Math.max(0, st.auraAt - battle.time), () => {
      if (battle.finished) return;
      rhodePulse(battle, st);
      arm();
    });
  };
  arm();
}

/**
 * 【罗德岛】clause 3 ("我方干员受到的持续性伤害不超过5秒"). The file header explains why the engine offers no choke point for
 * a DoT: this is the closest faithful version. Battle.addBuff is the point where a DoT lands on one of our operators, so it
 * is wrapped (once per battle) and every PERIODIC buff with a finite declared duration lands already cut:
 *   * `interval <= dot_duration_cap` — the buff is cut at once (`timeLeft = min(timeLeft, cap)`), so a 10 s DoT is a 5 s
 *     one from the moment it is applied;
 *   * not yet proven to be a DoT — the first tick decides. A tick that leaves the operator's `stats.taken` untouched (a
 *     heal-over-time, an aura, 抵抗's 麻痹 decay …) gives the buff its natural remaining time back and it is never cut
 *     again; a tick that did damage (a shield absorbed it: nothing was taken, so it stays unproven) marks the buff a DoT
 *     for good, and every later tick re-cuts it so it ends `dot_duration_cap` s after it was APPLIED.
 * Deviations [ASSUMED], see the header: a DoT whose `interval` is longer than the cap cannot be pre-cut (the operator
 * would lose a harmless buff before it ever ticked) and is only cut once it has damaged, and a tick fully absorbed by a
 * shield / 无敌 proves nothing. `duration` keeps the declared value; only `timeLeft` (what the engine expires buffs by) is
 * capped.
 */
function installRhodeDotCap(battle, isOurOp, cap) {
  if (!(cap > 0)) return;
  const store = battleStore(battle, 'bonds:addon:rhode', () => ({ patched: false, watched: new WeakSet(), state: new WeakMap() }));
  if (store.patched) return;
  store.patched = true;
  const add = battle.addBuff;
  battle.addBuff = function (unit, desc) {
    const b = add.call(this, unit, desc);
    if (!b || !isOurOp(unit)) return b;
    if (!(b.interval > 0) || typeof b.onTick !== 'function' || !Number.isFinite(b.duration) || !(b.duration > cap)) return b;
    let st = store.state.get(b);
    if (!st) {
      st = { start: this.time, preCut: b.interval <= cap, dot: false };
      store.state.set(b, st);
      const tick = b.onTick;
      b.onTick = function (ctx) {
        const u = ctx && ctx.unit;
        const before = num(u && u.stats ? u.stats.taken : 0, 0);
        try {
          return tick.call(this, ctx);
        } finally {
          const s = store.state.get(b);
          // 这个 return 只是「没有记账对象」的守卫。它会顺带吞掉 tick 抛出的异常，而这是**有意**的：DoT 上限是尽力
          // 而为的收尾记账，不该让一次记账失败把整场战斗判成超时（引擎对钩子抛错的处理正是 force-end，见
          // test/sim/robustness.test.js）。改成 `if (s && u) { … }` 会让异常外泄，语义不同 —— 所以显式保留并说明。
          // eslint-disable-next-line no-unsafe-finally
          if (!s || !u) return;
          const elapsed = Math.max(0, battle.time - s.start);
          if (num(u.stats ? u.stats.taken : 0, 0) > before + 1e-9) {
            s.dot = true;
            s.preCut = false;
          } else if (s.preCut) {
            // not a DoT (yet): give back the natural remaining time of the declared duration, once
            if (b.timeLeft < b.duration - elapsed) b.timeLeft = Math.max(0, b.duration - elapsed);
            s.preCut = false;
          }
          if (s.dot) {
            const left = Math.max(0, cap - elapsed);
            if (b.timeLeft > left) b.timeLeft = left; // the engine's own buff tick removes it once timeLeft runs out
          }
        }
      };
    }
    if (st.preCut) b.timeLeft = Math.min(b.timeLeft, cap);
    return b;
  };
}

// =====================================================================================================================
// registration — the thin surface addon/battle.js calls (plan A1: the upstream file keeps only these calls)

/** Clause 2 ("受治疗效率提升（每5层+1%）"): one standing buff per operator, re-applied on every layer change. */
export function rhodeApplyPassive(battle, st) {
  const mul = rhodeHealMul(st.bb[BOND], L(battle, st, BOND));
  for (const u of st.ops) passiveBuff(battle, u, KEY.heal, { healingTakenMul: mul });
}

/**
 * Register every 罗德岛 hook for the players that have the bond (clauses 1, 3, 4 are always at tier 1; the
 * whole-field heal aura of clause 5 needs tier ≥ 2 = two distinct members). A no-op when nobody has it.
 */
export function installRhode(battle, states, byPid) {
  const rhode = states.filter((st) => st.tiers[BOND]);
  if (!rhode.length) return;
    // clause 1: mirror any layer gain of a friendly non-member inside a member's current range onto 罗德岛. −50: after the
  // 魔王-style `layerGain` modifiers (priority 0, they raise ctx.n — support.gainLayers documents the ctx.n contract),
  // before the standing-buff re-read at −100.
  battle.on('layerGain', (c) => {
    if (c.bondId === BOND) return; // 罗德岛's own layers (incl. this mirror) never trigger it again
    const st = byPid[c.playerId];
    if (!st || !st.tiers[BOND]) return;
    rhodeMirror(battle, st, c);
  }, { priority: -50 });
  // MOD（负责人 2026-10-09）：【罗德岛】的叠层效率是两档曲线 —— 在场成员少于 4 名时 50%，4 名及以上 100%
  // （`bb.field_eff_low` / `bb.field_eff_member_min` / `bb.field_eff_max`，rhodeEffOf），再受「不超过已激活的其他
  // 盟约中最高的层数」的上限约束。
  // −60：在魔王式加成（priority 0）与镜像（−50，它会为罗德岛再发一次 layerGain）之后运行，保证连镜像加进来的
  // 那份也一并按效率折算；早于常驻 buff 重读（−100）。钳制只改 ctx.n，超出部分不计入层数、也不触发 `layer` 事件。
  // 效率不足 1 层时把零头攒在 st.rhodeFrac 里（同技力回复的做法），长期不失真。
  battle.on('layerGain', (c) => {
    if (c.bondId !== BOND) return;
    const st = byPid[c.playerId];
    if (!st || !st.tiers[BOND]) return;
    const bb = st.bb[BOND] || {};
    const eff = rhodeEffOf(bb, rhodeFieldCount(st));
    const total = Math.max(0, num(st.rhodeFrac, 0)) + Math.max(0, num(c.n, 0)) * eff;
    let n = Math.floor(total + 1e-9);
    st.rhodeFrac = total - n;
    const room = rhodeLayerCap(battle, st) - L(battle, st, BOND);
    if (n > room) n = Math.max(0, room);
    c.n = n;
  }, { priority: -60 });
  const rhodePids = new Set(rhode.map((st) => st.pid));
  // Skills and other buffs may end after the aura's onTick in the same frame.
  // Clamp again before the next attack reads ATK, without extending the bonus lifetime.
  battle.on('beforeAttack', ({attacker}) => {
    if (!attacker || !rhodePids.has(attacker.ownerId)) return;
    const buff = attacker.findBuff(KEY.atk);
    if (buff) rhodeAtkTick({unit: attacker, buff});
  }, {priority: 1000});
  installRhodeDotCap(battle, (u) => !!(u && u.side === 'ally' && u.kind === 'op' && rhodePids.has(u.ownerId)), num(rhode[0].bb[BOND].dot_duration_cap, 5));
  // clause 4: the engine's heal event (fired before the HP is written) sees the final amount
  battle.on('heal', (c) => {
    const t = c.target;
    if (!t || t.side !== 'ally' || !isOp(t) || !t.alive || !t.deployed) return;
    const st = byPid[t.ownerId];
    if (!st || !st.tiers[BOND]) return;
    // the aura's own heal (rhodePulse): remember the engine's final amount for its overflow
    if (st.probe === t) st.probeAmt = num(c.amount, 0);
    // Re-entrancy guard: while this strike's own damage resolves, a heal-driven trait it sets off (咒愈师's
    // "every damage dealt heals an ally for 50 % of it" — 刺玫's trait and its INC-X 60 % module) heals again and
    // would strike again. The damage instance names the healed operator as its source, so the trait fires inside the
    // strike itself and each round multiplies by healRatio × L × 0.1 (~0.5): a geometric cascade that only dies below
    // damage.js's 0.5 event floor — tens of thousands of emissions inside a single tick, which is what made the
    // golden match corpus stop converging. Firing only the outermost strike ends it at the first round.
    if (st.striking) return;
    const actual = Math.max(0, Math.min(num(c.amount, 0), t.s.maxHp - t.hp)); // damage.js heal(): the clamp it will apply
    if (!(actual > 0)) return;
    st.striking = true;
    try { rhodeHealStrike(battle, st, t, actual); } finally { st.striking = false; }
  }, { priority: -1000 });
  for (const st of rhode) if (st.tiers[BOND] >= 2) installRhodeAura(battle, st);
}
