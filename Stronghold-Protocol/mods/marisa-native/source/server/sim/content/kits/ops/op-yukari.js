// server/sim/content/kits/ops/op-yukari.js — 岳羽由加莉 (char_4219_yukari) MOD 卫戍棋子 kit: 5★ 辅助·护佑者
// (SUPPORT/supportiveranger), a 4-本 PRESET chess of this MOD (server/sim/content/index.js MOD_KIT_KEYS, keyed by the
// BARE chessId `chess_char_4219_yukari`). Not a 自选 pick: deliberately absent from kits/index.js OPERATOR_KIT_FILES so
// her charId never reaches KITTED_CHARS / the 自选编队 pool (shared/diy.js diyPool / validateDiyPicks).
//
// Forms (tools/mod-content.mjs MOD_CHESS_RECORDS): normal `_a` = PHASE_2 Lv1, skills at rank 4, no module;
// elite `_b` = PHASE_2 Lv1, rank 7. Full potential (潜能 6 = rank 5), like every MOD record.
// Sources: character_table / skill_table (zh_CN, as built into data/chess.json) and PRTS 岳羽由加莉 (SEES 联动干员,
// teamId `sees`; trait 触发型效果, S1 龙卷箭, S2 明镜止水, T1 治愈之风).
//
// - Trait (护佑者) "可以使用触发型效果协助作战": informational — the 触发型效果 itself is what S2 hands out, implemented
//   below. No separate `trait` entry (`professions.js` supportiveranger already makes her normal attacks 法术).
// - S1 龙卷箭 (MANUAL, instant, duration −1): three arrows at `multi_atk_scale` × ATK ARTS each, then a splash ARTS hit
//   at `final_atk_scale` × ATK, and every target hit is 浮空 (`levitate`) for `levitate` seconds.
//   Rank 4 bb: multi_atk_scale 0.55, final_atk_scale 2.5, levitate 1.5; rank 7: 0.65 / 3 / 1.5.
// - S2 明镜止水 (MANUAL, instant): blesses up to `max_target` ALLIES inside her attack range — 结城理 FIRST, then
//   Casters (术师) — with a 触发型效果: whenever a blessed ally CASTS A SKILL it gains `damage_up` 术法充盈 for
//   `duration` seconds. Rank 4 bb: max_target 3, duration 15, damage_up 0.15; rank 7: 4 / 15 / 0.2.
//   ⚠ 「术法充盈」 has no dedicated key in this repo (verified: `grep -rn '术法充盈|magicarcane' server/ public/ test/`
//   finds nothing), and the official blackboard key is the generic `damage_up`. [ASSUMED] it is implemented as an ARTS
//   damage amplification — the reading of 术法充盈 (PRTS: 造成法术伤害时伤害提升) — applied through the engine's own
//   `artsDealtMul` multiplier rather than inventing a new buff key nothing else understands.
// - T1 治愈之风 "技能结束后，治疗自身和攻击范围内最多3名干员相当于岳羽由加莉攻击力100%的生命值".
//   It is a 治疗 (heal), not 生命回复速度: the official text says 治疗, so `battle.heal` is correct (README fidelity
//   checklist item 11 — a heal, not an hpRegen buff). Her `_b` (rank 7) blackboard has the same max_target 3 / heal_scale 1.
// - Module (uniequip_002_yukari 命运的奖赏) is deliberately NOT declared: none of the ten MOD operators carries a
//   `modules[]` (the MOD convention), so adding one only for her would be inconsistent.
import { num, talentBb, skillRec, up } from '../shared/tier1.js';
import { bodyKeys } from '../../../body.js';

/** `damage_up` → the engine's arts-dealt multiplier (see the 术法充盈 note in the header). */
const artsBuff = (damageUp) => ({ artsDealtMul: 1 + damageUp });

/** Is the ally inside 岳羽由加莉's attack range? (`rangeKeySet` holds the body keys the engine uses for her range.) */
function inHerRange(unit, ally) {
  if (!unit?.rangeKeySet || !ally) return false;
  for (const k of bodyKeys(ally)) if (unit.rangeKeySet.has(k)) return true;
  return false;
}

export default {
  char_4219_yukari: (bb, chess) => {
    const b1 = skillRec(chess, 'skchr_yukari_1')?.bb ?? {};
    const b2 = skillRec(chess, 'skchr_yukari_2')?.bb ?? {};
    const t0 = talentBb(chess, 0);
    return {
      skills: {
        // 龙卷箭: 3 arrows + a splash, all ARTS, everything hit is 浮空.
        skchr_yukari_1: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const multi = num(b1.multi_atk_scale);
            const final = num(b1.final_atk_scale);
            const lev = num(b1.levitate);
            const main = unit.skill?.target?.alive ? unit.skill.target
              : battle.foesInRadius(unit.x, unit.y, 3).sort((a, b) => a.uid - b.uid)[0];
            if (!main) return;                // 「立即发射三发箭矢」 — 没有目标就不发动
            const hit = (t) => {
              battle.dealDamage(unit, t, battle.makeDamage({ amount: unit.s.atk * multi, type: 'arts', isSkill: true, tags: ['skill'] }));
            };
            for (let i = 0; i < 3; i++) {
              if (!main.alive || main.removed) break;
              hit(main);
            }
            if (!(final > 0)) return;
            // 「随后追加一次…范围法术伤害并浮空所有目标」 — 目标及其周围的敌人都吃这一下并浮空。
            const around = battle.foesInRadius(main.x, main.y, 1).filter((e) => e.alive);
            const all = around.includes(main) ? around : [main, ...around];
            for (const e of all) {
              if (!e.alive) continue;
              battle.dealDamage(unit, e, battle.makeDamage({ amount: unit.s.atk * final, type: 'arts', isSplash: true, isSkill: true, tags: ['skill'] }));
              if (lev > 0 && e.alive) battle.applyStatus(e, 'levitate', { duration: lev, source: unit });
            }
          },
        },
        // 明镜止水: bless up to max_target allies (结城理 first, then Casters) with a trigger-on-skill arts buff.
        skchr_yukari_2: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const n = Math.max(0, Math.floor(num(b2.max_target)));
            const dur = num(b2.duration);
            const up_ = num(b2.damage_up);
            if (!(n > 0) || !(dur > 0) || !(up_ > 0)) return;
            // 「优先选择结城理、术师干员」: 结城理 first, then every 术师/Caster, then the rest — a stable order so the
            // blessing is deterministic (the pick order is the only thing that decides who gets it).
            const inRange = battle.allyUnits.filter((a) => a && a.alive && a.deployed && a.kind === 'op' && a.side === 'ally' && a !== unit && inHerRange(unit, a));
            const rank = (a) => (a.def?.charId === 'char_4217_makoto' ? 0 : (a.def?.profession === 'CASTER' ? 1 : 2));
            const chosen = inRange.slice().sort((a, b) => rank(a) - rank(b) || a.uid - b.uid).slice(0, n);
            for (const a of chosen) a.mem.yukariBless = dur > 0 ? 1 : 0;
            if (!chosen.length) return;
            battle.on('skillStart', (c) => {
              const a = c.unit;
              if (!a || a === unit || !a.mem?.yukariBless || !a.alive) return;
              battle.addBuff(a, { key: 'talent:yukari:bless', duration: dur, refresh: 'replace', mods: artsBuff(up_), tags: ['talent'] });
            }, { owner: unit });
          },
        },
      },
      talents: [
        {
          // 治愈之风: after a skill ends, heal herself + up to max_target allies in her attack range.
          install(battle, unit) {
            const n = Math.max(0, Math.floor(num(t0.max_target)));
            const scale = num(t0.heal_scale);
            if (!(n > 0) || !(scale > 0)) return;
            battle.on('skillEnd', (c) => {
              if (c.unit !== unit || !up(unit)) return;
              const amount = unit.s.atk * scale;
              battle.heal(unit, unit, amount, { self: true, tags: ['talent'] });
              const allies = battle.allyUnits
                .filter((a) => a && a.alive && a.deployed && a.kind === 'op' && a.side === 'ally' && a !== unit && inHerRange(unit, a))
                .sort((a, b) => a.uid - b.uid)
                .slice(0, n);
              for (const a of allies) battle.heal(unit, a, amount, { tags: ['talent'] });
            }, { owner: unit });
          },
        },
      ],
    };
  },
};
