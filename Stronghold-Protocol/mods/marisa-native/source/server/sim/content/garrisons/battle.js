// server/sim/content/garrisons/battle.js — IN_BATTLE 特质 (garrisons) of the operators on the field.
//
// Each operator carries `unit.def.raw.garrisonIds` (elite chess carry the `_b` garrisons); the IN_BATTLE ones are
// dispatched here by their effectKey (bbStr.key for battle runes, else effectType — docs/DATA.md §4):
//
//   ADD_BOND            grants `give_garrison_id` to other operators before the first deployment (targets parsed from
//                       the text: 身前一格 / 身前一格【X】/ 自身和身前一格 / 同一行最右边 / 所有【X】). A unit owns a garrison id
//                       at most once (耀骑士临光 already carries the 144/159 it grants to itself). A granted trait keeps
//                       its data cap like a native one: 华法琳's garrison_95 stops at 7 / 14 layers per battle (PRTS 下半
//                       3月27日更新#2: 「从 初始12/精锐24 降低至 初始7/精锐14」; GitHub #175, PR #192 by @kukiC).
//   layer events        act1autochess_gar_event_useskill (skillStart) · _selfkillenemy (kill, every check_cnt) ·
//                       _selfdead (death 'killed'; texts with 替身 also on every substitute ⇄ body swap, read from the
//                       dollkeeper flag unit.trait.doll) · _consume_ammo (ammoUsed; range_id 0-1 self, 1-1 front tile,
//                       x-5 self + 4 adjacent, pooled counter) · _enemy_abflag_inrange (an enemy in range ENTERS
//                       'freeze', × prob) · act2autochess_gar_event_onstart (every deploy) ·
//                       act2autochess_gar_event_allyenemy_sleepstun_inrange (an enemy or operator in range ENTERS
//                       sleep / stun). "进入…时": re-applying a running status (a refresh) is not a new entry
//                       (engine statusApplied ctx.entered) — except a pulse that re-applies its own short status as a
//                       fresh one (applyStatus `reenter`: 缇缇 S2's sleep ward, DESIGN §24.8).
//                       MOD_TRIGGER_ally_liftoff (予愿安洁莉娜) polls the allies'
//                       起飞 flag `u.s.flags.liftoff` every tick — a false → true change is one take-off;
//                       MOD_TRIGGER_levitate_skill_cast fires on skillStart when the cast skill can apply 浮空 (its
//                       SkillSpec declares the status flag `levitate`).
//                       Targets: bond_by_id / bond_self (own active bonds) / bond_actived_maxstack;
//                       amounts: by_count / by_charcount_samerow / by_charlevel; conditions character_same_row /
//                       character_same_col (≥ check_count incl. self). Gains go through support.gainLayers with
//                       reason 'garrison', source = the trait's owner, cap = max_add_count_per_battle per (instance, bond)
//                       — per instance for bond_actived_maxstack (塑心: the highest bond may change, the cap does not).
//   act1autochess_gar_event_addition_cnt (魔王)  layerGain: a 'garrison' gain whose source stands on the tile in front
//                       of 魔王 (range_id 1-1) — or was knocked out there this instant (幽灵鲨 "被击倒时"; engine ctx.tile)
//                       — gets +extra_cnt per bond (the extra does not count toward the source's per-battle cap).
//   stat traits         GAIN_BUFF (battleRuneKey char_attribute_mul "攻击力和生命值+20%": a rune on the chess's base
//                       attributes, so atkMul / hpMul), attr_common_global_buff (spRecoveryFlat; "+X%" ATK / HP would be
//                       直接乘算), attrByBond ("每叠加N层…+X%": 直接乘算, support directMods),
//                       respawnTimeByBond, attrByBond_add_onstart, ab_damageScaleByBond — layer readers use
//                       floor(Σ layers of the listed ACTIVE bonds / divide_num) and are recomputed after every layer
//                       gain (research 02 §5 [ASSUMED] only active bonds count).
//   hit modifiers       act1autochess_gar_eff_attack_enemy (dmg.amount × atk vs check_tag enemies),
//                       ab_damageScaleByBond (bound / sluggish targets), _chaos (弱点伤害, research 04 glossary:
//                       phys/arts → whichever deals MORE after the engine's mitigation incl. the attacker's DEF/RES
//                       ignore and dealt/taken multipliers; a tie keeps the type).
//   NONE                风丸 "2 copies merge" — prep rule (chess.upgradeNum 2), nothing in battle.
//
// Hooks: priority 0, except 弱点伤害 (hit, WEAKNESS_PRIORITY −10: decided on the final amount after the ATK
// multipliers). install() registers nothing when no operator carries an IN_BATTLE garrison.

import * as S from '../support/index.js';
import { mitigate } from '../../damage.js';
import { frontOf } from '../../dir.js';
import { bodyInKeys, bodyKeys } from '../../body.js';

const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY = Object.freeze([]);
/** Status keys for check_ab_flag values used by the data (16 = 冻结). */
const AB_FLAG_STATUS = Object.freeze({ 16: 'freeze' });

function garrisonIdsOf(u) {
  const list = u?.def?.raw?.garrisonIds ?? u?.def?.garrisonIds;
  return Array.isArray(list) ? list : EMPTY;
}

// ---------------------------------------------------------------------------------------------------------------------
// install

/** battle → Map(effectKeyOrRuneKey → instances), installed by `install()`; read by `garrisonBonus`. */
const BONUS = new WeakMap();

/**
 * 结城理「总攻击 +20%」那条驻防的 effectKey —— addon/sees.js 通过它把数值读回去。
 * 与 `tools/mod-content.mjs` 的 `MOD_GARRISONS.garrison_makoto_sees_a.effectKey` 必须一致。
 */
export const ALLOUT_BONUS_KEY = 'act1autochess_gar_eff_alloutBonus';

export function install(battle) {
  const all = [];
  const owned = new Map(); // unit → Set(garrisonId)
  const add = (unit, g, grantedBy = null) => {
    let set = owned.get(unit);
    if (!set) { set = new Set(); owned.set(unit, set); }
    if (set.has(g.garrisonId)) return null;
    set.add(g.garrisonId);
    const bb = g.bb || {};
    const cap = S.num(bb.max_add_count_per_battle, 0) > 0 ? S.num(bb.max_add_count_per_battle) : Infinity;
    const it = {
      // The battle rune of the record (bbStr.key, e.g. the MOD_TRIGGER_* of the MOD chess, DATA §4) wins over the
      // generic effectKey: it is what selects the handler, while effectKey stays the data's coarse family
      // (act1autochess_gar_event_selfdead covers every MOD_TRIGGER_* record).
      unit, g, gid: g.garrisonId, key: (g.bbStr && g.bbStr.key) || g.effectKey, bb, bbStr: g.bbStr || {}, grantedBy,
      cap, capKey: `gar:${g.garrisonId}:${unit.id}`, cnt: 0, k: -1,
    };
    all.push(it);
    return it;
  };
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    for (const gid of garrisonIdsOf(u)) {
      const g = S.garrisonRecord(gid);
      if (g && g.eventType === 'IN_BATTLE') add(u, g);
    }
  }
  if (!all.length) return;

  const grants = [];
  for (const it of all.slice()) {
    if (it.key !== 'ADD_BOND') continue;
    const g2 = S.garrisonRecord(it.bbStr.give_garrison_id);
    if (!g2 || g2.eventType !== 'IN_BATTLE') continue;
    for (const t of grantTargets(battle, it)) {
      const got = add(t, g2, it);
      if (got) grants.push(got);
    }
  }

  const by = new Map();
  for (const it of all) {
    let arr = by.get(it.key);
    if (!arr) { arr = []; by.set(it.key, arr); }
    arr.push(it);
  }
  for (const [key, list] of by) {
    const inst = INSTALLERS[key];
    if (inst) inst(battle, list);
  }
  installHitMods(battle, by);
  installReaders(battle, by);

  if (grants.length) {
    battle.on('battleStart', () => {
      for (const it of grants) S.fxOn(battle, 'garrisonGrant', it.unit, `gar:${it.grantedBy.gid}`, it.gid, { from: it.grantedBy.unit.id });
    });
  }
  // 由 addon 侧读回的「驻防加成」表（见 garrisonBonus）
  BONUS.set(battle, by);
}

/**
 * 读回某位玩家的某条**非叠层**驻防加成（当前只有结城理的「总攻击 +20%」用它）。
 *
 * 为什么需要这个出口：那条效果的文字与数值按用户裁决写在**干员驻防**里（`bb.allout_bonus`），
 * 但「总攻击」本身实现在盟约 addon（`addon/sees.js`）—— 两边不能各实现一次同一件事。
 * 所以驻防只维护「持有者在场」这个事实（`it.active`，见 `act1autochess_gar_eff_alloutBonus`），
 * addon 通过这里把数值读回去乘算。
 *
 * 同一 key 有多条实例时**求和**（每个持有者一条；两位结城理不可能同时在场，求和是安全的默认）。
 * @param {object} battle
 * @param {string} pid
 * @param {string} key `bbStr.key`（battle rune）或 `effectKey`
 * @param {string} bbKey 读哪一个 bb 键（如 `allout_bonus`）
 * @returns {number} 0 when nobody carries it / the carrier is off field
 */
export function garrisonBonus(battle, pid, key, bbKey) {
  const by = BONUS.get(battle);
  if (!by) return 0;
  let sum = 0;
  for (const it of by.get(key) ?? []) {
    if (!it.active) continue;
    if (it.unit.ownerId !== pid) continue;
    sum += S.num(it.bb[bbKey], 0);
  }
  return sum;
}

// ---------------------------------------------------------------------------------------------------------------------
// ADD_BOND targets (before deployment: home tiles)

function opsOf(battle, pid) {
  const out = [];
  for (const u of battle.allyUnits) if (S.isOp(u) && u.ownerId === pid && !u.removed) out.push(u);
  return out;
}
function opAtHome(battle, pid, r, c) {
  for (const u of battle.allyUnits) if (S.isOp(u) && u.ownerId === pid && !u.removed && u.homeR === r && u.homeC === c) return u;
  return null;
}

function grantTargets(battle, it) {
  const u = it.unit;
  const desc = it.g.desc || '';
  const need = it.bbStr.check_bond_id || null;
  const ok = (t) => !!t && (!need || S.isMember(battle, t, need));
  const front = () => { const [fr, fc] = frontOf(u.homeR, u.homeC, u.dir); return opAtHome(battle, u.ownerId, fr, fc); };
  if (desc.includes('所有')) return opsOf(battle, u.ownerId).filter(ok);
  if (desc.includes('同一行最右边')) {
    let best = null;
    for (const t of opsOf(battle, u.ownerId)) {
      if (t.homeR !== u.homeR) continue;
      // a board position ("最右边" of the player's own board: the mirrored Final Assault right side counts from the left)
      const col = (x) => (x.player && x.player.mirror ? -x.homeC : x.homeC);
      if (!best || col(t) > col(best)) best = t;
    }
    return ok(best) ? [best] : [];
  }
  const out = [];
  if (desc.includes('自身和身前') && ok(u)) out.push(u);
  const f = front();
  if (ok(f)) out.push(f);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// layer gains

function targetBonds(battle, it) {
  const u = it.unit;
  switch (it.bbStr.bond_type) {
    case 'bond_self': return S.unitBonds(u).filter((b) => S.bondActive(battle, u.ownerId, b));
    case 'bond_actived_maxstack': { const b = S.topActiveBond(battle, u.ownerId); return b ? [b] : EMPTY; }
    default: return ids(it.bbStr.bond_id);
  }
}

function amountOf(battle, it) {
  const bb = it.bb;
  switch (it.bbStr.bond_add_type) {
    case 'by_charcount_samerow': return S.rowMates(battle, it.unit).length * S.num(bb.bond_add_count_multi, S.num(bb.bond_add_count, 1));
    case 'by_charlevel': return S.tierOf(it.unit) * S.num(bb.bond_add_count, 1);
    default: return S.num(bb.bond_add_count, 0);
  }
}

function conditionMet(battle, it) {
  const ck = it.bbStr.conditionkey;
  const need = S.num(it.bb.check_count, 0);
  if (ck === 'character_same_row') return S.rowMates(battle, it.unit).length >= need;
  if (ck === 'character_same_col') {
    let n = 0;
    for (const a of battle.allyUnits) if (S.isOp(a) && a.ownerId === it.unit.ownerId && S.onField(a) && a.tileC === it.unit.tileC) n++;
    return n >= need;
  }
  return true;
}

/**
 * The live per-battle layer cap of a garrison instance. A record can tie its cap to how many members of another bond
 * stand on the field — 结城理's kill adder (owner 2026-10-07): "一回合上限为在场的【拉特兰】人数，如果没激发、或人数
 * 少于 3，上限 3 层", and "精锐化的结城理上限提升到 24 层". So `bb.cap_by_bond` names that bond, `bb.cap_min` is the
 * floor for the normal record and `bb.cap_min_elite` the floor for the elite one (the elite form is read off the unit's
 * own chess record, `isGolden`). The count is read fresh at every gain. Without `cap_by_bond` the instance keeps the
 * static `max_add_count_per_battle` cap computed in add().
 */
function capOf(battle, it) {
  const bondId = it.bb.cap_by_bond;
  if (!bondId) return it.cap;
  const elite = !!(it.unit.def && it.unit.def.raw && it.unit.def.raw.isGolden);
  const min = elite ? S.num(it.bb.cap_min_elite, S.num(it.bb.cap_min, 3)) : S.num(it.bb.cap_min, 3);
  return Math.max(min, S.bondMembers(battle, it.unit.ownerId, bondId, { fieldOnly: true }).length);
}

/**
 * 盟约级的每回合叠层上限（`bb.bond_layer_per_round_max` + `bbStr.bond_layer_cap_key`）。
 *
 * 为什么需要它：用户 2026-10-16 裁决「我们联合每回合最多叠加10层」——那是**盟约级**的配额，
 * **所有来源合计**（技能 / 击杀 / 学生互助会），不是某一位或某一个来源的。而这几位成员的叠层
 * 现在由各自的驻防触发（见 docs/SEES-GARRISON-MOVE.md），所以驻防必须能把配额交给 `gainLayers` 的
 * `cap` / `capKey`（引擎自带的「每场战斗至多 N 层」机制，support/index.js:332-357），
 * 且**同一个 key 在整场战斗内共用**——这样古米用完 10 层后凛冬的技能也叠不动。
 *
 * 没声明这两个键时返回 null：那时驻防只受自己的 `max_add_count_per_battle` / `cap_min` 约束，
 * 与改动前一致（结城理 / 予愿安洁莉娜 / 阿米娅(医疗) 那几条就是这样）。
 */
function bondCapOf(it) {
  const cap = S.num(it.bb.bond_layer_per_round_max, 0);
  const key = it.bbStr.bond_layer_cap_key;
  if (!(cap > 0) || typeof key !== 'string' || !key) return null;
  return { cap, key };
}

/** Fire a layer-gain garrison instance. Returns the layers added. */
export function fireGain(battle, it) {
  if (!conditionMet(battle, it)) return 0;
  const bonds = targetBonds(battle, it);
  if (!bonds.length) return 0;
  let n = amountOf(battle, it);
  // bond_actived_maxstack (塑心 garrison_90 "当前已激活且层数最多的盟约层数+1（每场作战至多10层）"): the cap is the instance's
  // own over the battle, whichever bond is the highest at each gain — per (instance, bond) a change of the highest bond
  // granted a fresh 10 (PR #178 review). The base amount counts toward it (魔王's extra does not, as in gainLayers).
  const whole = it.bbStr.bond_type === 'bond_actived_maxstack' && Number.isFinite(it.cap);
  if (whole) {
    n = Math.min(Math.floor(n), Math.max(0, Math.floor(it.cap) - (it.wholeUsed ?? 0)));
    if (!(n > 0)) return 0;
  }
  // 盟约级配额（用户裁决）：与 unite.js 的 grant 共用同一个 capKey，所以两边互相计入。
  const shared = whole ? null : bondCapOf(it);
  const added = S.gainLayers(battle, {
    playerId: it.unit.ownerId, bonds, n, requireActive: true, source: it.unit, reason: 'garrison',
    cap: whole ? Infinity : (shared ? shared.cap : capOf(battle, it)),
    capKey: whole ? null : (shared ? shared.key : it.capKey),
  });
  if (whole && added > 0) it.wholeUsed = (it.wholeUsed ?? 0) + n;
  if (added > 0) S.fxOn(battle, 'garrison', it.unit, `gar:${it.gid}`, it.key, { n: added });
  return added;
}

const byUnit = (list) => {
  const m = new Map();
  for (const it of list) {
    let a = m.get(it.unit);
    if (!a) { a = []; m.set(it.unit, a); }
    a.push(it);
  }
  return m;
};

function isFrontOf(holder, u) {
  if (!u || u === holder || u.ownerId !== holder.ownerId || !S.onField(u)) return false;
  const [fr, fc] = frontOf(holder.tileR, holder.tileC, holder.dir);
  return u.tileR === fr && u.tileC === fc;
}
/**
 * 魔王: the gain's source (an operator of the holder's player) stands in front of it. `tile` = the engine's layerGain
 * ctx.tile: where the source stands, or where it was knocked out this very instant (幽灵鲨 "被击倒时" gains fire on death).
 */
function sourceInFront(holder, u, tile) {
  if (!u || u === holder || u.ownerId !== holder.ownerId || !S.isOp(u) || !Array.isArray(tile)) return false;
  const [fr, fc] = frontOf(holder.tileR, holder.tileC, holder.dir);
  return tile[0] === fr && tile[1] === fc;
}
function ammoScope(it, u) {
  const h = it.unit;
  switch (it.bbStr.range_id) {
    case '1-1': return S.onField(h) && isFrontOf(h, u);
    case 'x-5': return u === h || (S.onField(h) && S.onField(u) && u.ownerId === h.ownerId && S.isOp(u) && Math.abs(u.tileR - h.tileR) + Math.abs(u.tileC - h.tileC) === 1);
    default: return u === h;
  }
}

/** `{ [skillId]: SkillSpec }` of a kit, or null. */
function altSkillsOf(u) {
  const m = u.kit?.skills;
  return m && typeof m === 'object' ? m : null;
}

/**
 * "释放可施加浮空的技能": the cast skill (the live SkillRuntime, its spec, or the spec authored for its id) declares that it
 * can apply 浮空 — the SkillSpec FIELD `levitate` (tier3 予愿安洁莉娜 S2 重力自定义; a spec field because the spec's `flags`
 * are the caster's own state: a `levitate` flag there would make HER 浮空/stunned), or the status catalogue's own flag
 * `levitate` in `flags` (the older route, still accepted). 起飞 lives in `liftoff`, never here.
 */
function levitateCast(u, skill) {
  if (specAppliesLevitate(skill?.spec)) return true;
  const id = skill?.id;
  return !!(id && specAppliesLevitate(altSkillsOf(u)?.[id]));
}
/** The 浮空 capability marker of one SkillSpec: the field `levitate`, or the status flag in `flags`. */
function specAppliesLevitate(spec) {
  return !!(spec && (spec.levitate === true || (spec.flags && spec.flags.levitate)));
}

const INSTALLERS = {
  act1autochess_gar_event_useskill(battle, list) {
    const m = byUnit(list);
    battle.on('skillStart', ({ unit }) => {
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
  },

  act1autochess_gar_event_selfkillenemy(battle, list) {
    const m = byUnit(list);
    for (const it of list) it.allies = /我方干员/.test(it.g.desc || '');
    battle.on('kill', ({ killer, victim }) => {
      const arr = killer ? m.get(killer) : null;
      if (!arr || !victim) return;
      for (const it of arr) {
        if (!(victim.side === 'enemy' || (it.allies && victim.side === 'ally' && victim.kind === 'op'))) continue;
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.check_cnt, 1)) === 0) fireGain(battle, it);
      }
    });
  },

  act1autochess_gar_event_selfdead(battle, list) {
    const m = byUnit(list);
    battle.on('death', ({ unit, reason }) => {
      if (reason !== 'killed') return;
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
    const swaps = list.filter((it) => /替身/.test(it.g.desc || ''));
    if (!swaps.length) return;
    for (const it of swaps) it.doll = false;
    battle.on('tick', () => {
      for (let i = 0; i < swaps.length; i++) {
        const it = swaps[i];
        const u = it.unit;
        const doll = !!(u.trait && u.trait.doll);
        if (doll === it.doll) continue;
        it.doll = doll;
        if (u.alive && u.deployed) fireGain(battle, it);
      }
    });
  },

  act1autochess_gar_event_consume_ammo(battle, list) {
    battle.on('ammoUsed', ({ unit }) => {
      if (!unit) return;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (!ammoScope(it, unit)) continue;
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.consume_count, 1)) === 0) fireGain(battle, it);
      }
    });
  },

  act1autochess_gar_event_enemy_abflag_inrange(battle, list) {
    const watched = new Set(list.map((it) => AB_FLAG_STATUS[S.num(it.bb.check_ab_flag, 16)] ?? 'freeze'));
    // "进入冻结时": only a new entry (engine ctx.entered — a refresh of a running freeze is not one)
    battle.on('statusApplied', ({ target, status, entered }) => {
      if (!target || !watched.has(status) || !entered || target.side !== 'enemy') return;
      for (const it of list) {
        if (status !== (AB_FLAG_STATUS[S.num(it.bb.check_ab_flag, 16)] ?? 'freeze')) continue;
        if (!S.onField(it.unit) || !S.inRange(it.unit, target)) continue;
        if (battle.rng() < S.num(it.bb.prob, 1)) fireGain(battle, it);
      }
    });
  },

  act2autochess_gar_event_onstart(battle, list) {
    const m = byUnit(list);
    battle.on('deploy', ({ unit }) => {
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
    // Player-confirmed: 远牙's granted trait also gains on each body / substitute switch (DESIGN §28.5).
    // Restrict this extra trigger to that trait; use its existing amounts, active-bond checks and battle cap.
    const farTooth = byUnit(list.filter((it) => it.gid === 'garrison_108_a' || it.gid === 'garrison_108_b'));
    if (farTooth.size) battle.on('dollSwap', ({ unit }) => {
      const arr = farTooth.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
  },

  act2autochess_gar_event_allyenemy_sleepstun_inrange(battle, list) {
    battle.on('statusApplied', ({ target, status, entered }) => { // "进入沉睡/晕眩时": new entries only (ctx.entered)
      if (!target || (status !== 'sleep' && status !== 'stun') || !entered) return;
      if (!(target.side === 'enemy' || (target.side === 'ally' && target.kind === 'op'))) return;
      for (const it of list) if (S.onField(it.unit) && S.inRange(it.unit, target)) fireGain(battle, it);
    });
  },

  /**
   * 予愿安洁莉娜 "己方任意干员起飞时（含自身），使已激活的【叙拉古】【迅捷】层数各+1": 起飞 is the skill flag
   * `liftoff` of the airborne allies (蒂比 / 予愿安洁莉娜's skills, gamedata_const ba.liftoff) — the engine has no 起飞
   * event, the flag is read off `u.s.flags.liftoff` and polled here: a false → true change is one take-off (the take-off
   * of a unit already listed at install time counts too: previous = false).
   */
  MOD_TRIGGER_ally_liftoff(battle, list) {
    const prev = new Map();
    battle.on('tick', () => {
      for (const u of battle.allyUnits) {
        const air = !!(u.s.flags.liftoff && u.alive && u.deployed);
        if (air === (prev.get(u) ?? false)) continue;
        prev.set(u, air);
        if (air) for (const it of list) fireGain(battle, it);
      }
    });
  },

  /**
   * 岳羽由加莉 "自身及前方一名干员的攻击范围内，敌人被停顿、束缚或击晕时，有 50% 概率使【SEES】层数+1；
   * 每回合最多由此获得 10 层"（用户原话，逐字见 docs/TASKS-SEES.md §0）。
   *
   * 触发用引擎**现成的** `statusApplied` 事件（`server/sim/battle/status.js:231`），`entered` 才表示「目标此前
   * 没有该状态」—— 只认它，否则「延长已有状态」会重复计层。控制状态键：停顿 `sluggish` / 束缚 `bind` /
   * 击晕 `stun`（与 `sees.js` 的 `CONTROL_STATUSES` 同一组）。
   *
   * 范围 = 持有者本人 **+ 她正前方一格上的干员**（用户原话「自身及前方一名干员」）两者的攻击范围并集；
   * 「范围」判定照 kits 的 `inRange`：`bodyInKeys(target, unit.rangeKeySet)`。
   * 概率 `bb.prob`、每回合上限 `bb.cap_min`（走 `fireGain` 的 cap / capKey —— 与结城理那条同样的机制）。
   */
  act1autochess_gar_event_statusctrl(battle, list) {
    const CONTROL = ['sluggish', 'bind', 'stun'];
    const inRange = (u, e) => !!u && !!u.rangeKeySet && bodyInKeys(e, u.rangeKeySet);
    const watchersOf = (it) => {
      const out = [it.unit];
      // 正前方一格上的干员（同一位玩家、在场）
      const [fr, fc] = frontOf(it.unit.tileR, it.unit.tileC, it.unit.dir);
      for (const a of battle.allyUnits) {
        if (!a || a === it.unit || a.side !== 'ally' || !a.alive || !a.deployed) continue;
        if (a.ownerId !== it.unit.ownerId) continue;
        for (const k of bodyKeys(a)) if (Math.floor(k / 21) === fr && k % 21 === fc) return [...out, a];
      }
      return out;
    };
    battle.on('statusApplied', (c) => {
      const t = c.target;
      if (!t || t.side !== 'enemy' || !t.alive) return;
      if (!CONTROL.includes(c.status)) return;
      if (c.entered === false) return;   // 延长已有状态不算「被施加」
      for (const it of list) {
        if (!S.onField(it.unit)) continue;
        if (!watchersOf(it).some((w) => inRange(w, t))) continue;
        if (!(battle.rng() < S.num(it.bb.prob, 0.5))) continue;
        it.cnt++;
        fireGain(battle, it);
      }
    });
  },

  /**
   * 结城理 "自身在场时，'总攻击'造成的攻击力提升 20%"（用户原话）。
   *
   * 这不是叠层，而是 `addon/sees.js` 里「总攻击」的**乘区**。所以这条驻防不调 `fireGain`：它在 install 时把
   * 「持有者在场」这一事实登记成 `it.active`（`tick` 上维护，与 `MOD_TRIGGER_ally_liftoff` 同一套轮询写法），
   * 由 `sees.js` 通过 `garrisonBonus(battle, pid, '…alloutBonus')` 读回。
   * 这样「加成写在干员驻防里」与「总攻击实现在盟约 addon 里」不重复实现同一件事。
   */
  act1autochess_gar_eff_alloutBonus(battle, list) {
    const refresh = () => { for (const it of list) it.active = !!(it.unit.alive && it.unit.deployed); };
    refresh();
    battle.on('tick', refresh);
  },

  /**
   * 予愿安洁莉娜 "每次释放可施加浮空的技能时，使已激活的【远见】层数+1": the cast itself is the trigger (skillStart),
   * the condition is that the cast skill can apply 浮空. A kit declares that with the skill flag `levitate` on the spec
   * (tier3 予愿安洁莉娜 S2 重力自定义) — the same spec-flag route as 起飞. The keys are marked so that a skill spec of
   * the very chess carrying the garrison (its own take-off flag) can never satisfy the check by accident.
   */
  MOD_TRIGGER_levitate_skill_cast(battle, list) {
    const m = byUnit(list);
    battle.on('skillStart', ({ unit, skill }) => {
      const arr = m.get(unit);
      if (!arr || !levitateCast(unit, skill)) return;
      for (const it of arr) if (S.onField(it.unit)) fireGain(battle, it);
    });
  },

  act1autochess_gar_event_addition_cnt(battle, list) {
    battle.on('layerGain', (ctx) => {
      if (ctx.reason !== 'garrison' || !ctx.source) return;
      for (const it of list) {
        const h = it.unit;
        if (h.ownerId !== ctx.playerId || !S.onField(h)) continue;
        if (it.bbStr.range_id && it.bbStr.range_id !== '1-1') continue;
        if (sourceInFront(h, ctx.source, ctx.tile)) ctx.n += S.num(it.bb.extra_cnt, 0);
      }
    });
  },

  GAIN_BUFF(battle, list) {
    for (const it of list) {
      const mods = {};
      if (S.num(it.bb.atk, 0) > 0) mods.atkMul = S.num(it.bb.atk);
      if (S.num(it.bb.max_hp, 0) > 0) mods.hpMul = S.num(it.bb.max_hp);
      if (S.num(it.bb.def, 0) > 0) mods.defMul = S.num(it.bb.def);
      S.passiveBuff(battle, it.unit, `gar:${it.gid}`, mods);
    }
  },

  attr_common_global_buff(battle, list) {
    for (const it of list) {
      const mods = {};
      if (S.num(it.bb.sp_recovery_per_sec, 0)) mods.spRecoveryFlat = S.num(it.bb.sp_recovery_per_sec);
      Object.assign(mods, S.directMods({ atk: S.num(it.bb.atk, 0), hp: S.num(it.bb.max_hp, 0) }));
      if (S.num(it.bb.attack_speed, 0)) mods.aspd = S.num(it.bb.attack_speed);
      S.passiveBuff(battle, it.unit, `gar:${it.gid}`, mods);
    }
  },

  // grants are resolved in install(); 风丸's rule lives in the prep economy
  ADD_BOND() {},
  NONE() {},
};

// ---------------------------------------------------------------------------------------------------------------------
// layer readers (每叠加N层)

const READERS = new Set([
  'act1autochess_gar_eff_attrByBond', 'act1autochess_gar_eff_respawnTimeByBond',
  'act2autochess_gar_eff_attrByBond_add_onstart', 'act2autochess_gar_eff_ab_damageScaleByBond',
]);

/** floor(Σ layers of the listed active bonds / divide_num). */
export function stepsOf(battle, it) {
  const div = Math.max(1, S.num(it.bb.divide_num, 1));
  let sum = 0;
  for (const b of it.bonds ?? (it.bonds = ids(it.bbStr.bond_id))) if (S.bondActive(battle, it.unit.ownerId, b)) sum += S.bondLayers(battle, it.unit.ownerId, b);
  return Math.floor(sum / div);
}

function attrMods(bb, k) {
  // "每叠加N层，本干员攻击力+X%": a 直接乘算 bonus like every other "+X%" of the 卫戍 systems (support directMods)
  const m = S.directMods({ atk: S.num(bb.atk, 0) * k, hp: S.num(bb.max_hp, 0) * k, def: S.num(bb.def, 0) * k });
  if (S.num(bb.attack_speed, 0)) {
    // 「每有N层…攻击速度+X%（最多+Y%）」（MOD 埃癸斯 garrison_aigis_aspd_a）：`attack_speed` 是每档的百分点
    // （+1% = 1，与 `mods.aspd` 同单位），`max_attack_speed` 是**百分点上限**（+200% = 200），
    // 未声明上限时保持既有行为（不夹取）。
    let v = S.num(bb.attack_speed) * k;
    const cap = S.num(bb.max_attack_speed, 0);
    if (cap > 0) v = Math.min(cap, v);
    m.aspd = v;
  }
  if (S.num(bb.hp_recovery_per_sec, 0)) m.hpRegen = S.num(bb.hp_recovery_per_sec) * k;
  if (S.num(bb.sp_recovery_per_sec, 0)) m.spRecoveryFlat = S.num(bb.sp_recovery_per_sec) * k;
  return m;
}

function applyReader(battle, it) {
  const k = stepsOf(battle, it);
  if (k === it.k) return;
  it.k = k;
  const u = it.unit;
  const key = `gar:${it.gid}`;
  switch (it.key) {
    case 'act1autochess_gar_eff_attrByBond':
      if (k > 0) S.passiveBuff(battle, u, key, attrMods(it.bb, k));
      else battle.removeBuff(u, key);
      break;
    case 'act1autochess_gar_eff_respawnTimeByBond':
      // 耀骑士临光's 144: −1.5 % / −3 % per 3 卡西米尔 layers with no minimum in the blackboard (divide_num, respawn_time
      // only) — clamped at 0 like every other redeploy multiplier, so a knock-out timer can reach 0 s (GitHub #370;
      // until 0.2.1 a 0.05 floor kept it at 5 % of the base time from 192 layers, 96 for the elite)
      if (k > 0) S.passiveBuff(battle, u, key, { redeployMul: Math.max(0, 1 + S.num(it.bb.respawn_time, 0) * k) });
      else battle.removeBuff(u, key);
      break;
    case 'act2autochess_gar_eff_attrByBond_add_onstart': {
      const b = u.findBuff(key);
      if (b && b.timeLeft > 0) onstartBuff(battle, it, b.timeLeft);
      break;
    }
    default: break; // damageScale reads it.k in the hit hook
  }
}

function onstartBuff(battle, it, duration) {
  const k = Math.max(0, it.k);
  const key = `gar:${it.gid}`;
  if (!(k > 0) || !(duration > 0)) { battle.removeBuff(it.unit, key); return; }
  battle.addBuff(it.unit, { key, duration, refresh: 'replace', mods: { atkFlat: S.num(it.bb.atk, 0) * k, hpFlat: S.num(it.bb.max_hp, 0) * k } });
}

function installReaders(battle, by) {
  const list = [];
  for (const key of READERS) for (const it of by.get(key) ?? EMPTY) list.push(it);
  if (!list.length) return;
  const recompute = () => { for (const it of list) applyReader(battle, it); };
  recompute();
  let pending = false;
  battle.on('layerGain', () => {
    if (pending) return;
    pending = true;
    battle.after(0, () => { pending = false; recompute(); });
  });
  const onstart = by.get('act2autochess_gar_eff_attrByBond_add_onstart');
  if (onstart) {
    const m = byUnit(onstart);
    battle.on('deploy', ({ unit }) => {
      const arr = m.get(unit);
      if (!arr) return;
      for (const it of arr) { it.k = stepsOf(battle, it); onstartBuff(battle, it, S.num(it.bb.duration, 0)); }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// hit modifiers

/**
 * 弱点伤害 (research 04 §glossary: "each hit is dealt as whichever of physical/arts yields MORE damage against that
 * target's DEF/RES"): the engine's own mitigation formula incl. the attacker's DEF/RES ignore stats; a tie keeps the
 * original type.
 */
export function weaknessType(source, target, dmg) {
  const ss = source && source.s ? source.s : null;
  const ign = {
    defIgnorePct: S.num(dmg.defIgnorePct, 0) + (ss ? S.num(ss.defIgnorePct, 0) : 0),
    defIgnoreFlat: S.num(dmg.defIgnoreFlat, 0) + (ss ? S.num(ss.defIgnoreFlat, 0) : 0),
    resIgnorePct: S.num(dmg.resIgnorePct, 0) + (ss ? S.num(ss.resIgnorePct, 0) : 0),
    resIgnoreFlat: S.num(dmg.resIgnoreFlat, 0) + (ss ? S.num(ss.resIgnoreFlat, 0) : 0),
  };
  const ph = mitigate(dmg.amount, 'phys', target.s, ign) * (ss ? S.num(ss.physDealtMul, 1) : 1) * S.num(target.s.physTakenMul, 1);
  const ar = mitigate(dmg.amount, 'arts', target.s, ign) * (ss ? S.num(ss.artsDealtMul, 1) : 1) * S.num(target.s.artsTakenMul, 1);
  if (ar > ph + 1e-9) return 'arts';
  if (ph > ar + 1e-9) return 'phys';
  return dmg.type;
}
const bound = (t) => !!(t.s && t.s.flags && t.s.flags.bind) || !!t.findBuff('bind');

/** Priority of the 弱点伤害 conversion: after every default-priority hit modifier, so the final amount decides. */
export const WEAKNESS_PRIORITY = -10;

function installHitMods(battle, by) {
  const m = new Map();
  const push = (it, kind) => {
    let a = m.get(it.unit);
    if (!a) { a = []; m.set(it.unit, a); }
    a.push({ it, kind });
  };
  for (const it of by.get('act1autochess_gar_eff_attack_enemy') ?? EMPTY) push(it, 'tag');
  for (const it of by.get('act2autochess_gar_eff_ab_damageScaleByBond') ?? EMPTY) push(it, 'ab');
  if (m.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      const arr = source ? m.get(source) : null;
      if (!arr || !target || target.side !== 'enemy' || !dmg || dmg.type === 'element') return;
      for (let i = 0; i < arr.length; i++) {
        const { it, kind } = arr[i];
        if (kind === 'tag') {
          // an ATK multiplier: fixed-value DoT ticks are not ATK-based
          if (Array.isArray(dmg.tags) && dmg.tags.includes('dot')) continue;
          const tags = target.def && target.def.tags;
          if (Array.isArray(tags) && tags.includes(it.bbStr.check_tag)) dmg.amount *= S.num(it.bb.atk, 1);
        } else if (it.k > 0) {
          const hit = (S.num(it.bb.check_ab_flag, 0) && bound(target)) || (S.num(it.bb.check_sluggish, 0) && !!target.findBuff('sluggish'));
          if (hit) dmg.mul = S.num(dmg.mul, 1) * (1 + S.num(it.bb.damage_scale_per_stack, 0) * it.k);
        }
      }
    });
  }
  const chaos = new Set((by.get('act1autochess_gar_eff_chaos') ?? EMPTY).map((it) => it.unit));
  if (chaos.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!source || !chaos.has(source) || !target || target.side !== 'enemy' || !dmg) return;
      if (dmg.type === 'phys' || dmg.type === 'arts') dmg.type = weaknessType(source, target, dmg);
    }, { priority: WEAKNESS_PRIORITY });
  }
}
