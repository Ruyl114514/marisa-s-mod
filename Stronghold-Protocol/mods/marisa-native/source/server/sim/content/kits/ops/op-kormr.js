// server/sim/content/kits/ops/op-kormr.js — 虎狼丸 (char_4220_kormr) MOD 卫戍棋子 kit: 1★ 近卫·剑豪 (WARRIOR/sword),
// a 1-本 PRESET chess of this MOD (server/sim/content/index.js MOD_KIT_KEYS, keyed by the BARE chessId
// `chess_char_4220_kormr`). Not a 自选 pick: deliberately absent from kits/index.js OPERATOR_KIT_FILES so his charId
// never reaches KITTED_CHARS / the 自选编队 pool (shared/diy.js diyPool / validateDiyPicks).
//
// Forms (tools/mod-content.mjs MOD_CHESS_RECORDS): normal `_a` = PHASE_0 Lv1, skills at rank 4;
// elite `_b` = PHASE_0 Lv1, rank 7. Full potential (潜能 6 = rank 5), like every MOD record.
// Sources: character_table / skill_table (zh_CN, as built into data/chess.json) and PRTS 虎狼丸
// (talent 黑色猎犬; SEES 联动干员, teamId `sees`).
//
// - Trait (剑豪) "普通攻击连续造成两次伤害，且不受部署数量限制，但再部署时间极长": the double hit is the profession
//   default (`professions.js` sword `P({ hits: 2 })`), so no `trait` entry and nothing to implement here.
//   「不受部署数量限制」 is an official-mode concept (the 部署位 budget) the 卫戍 mode has no equivalent of; the chess
//   record carries `stats.deployLimit: 1` like every other piece. 「再部署时间极长」 is the record's
//   `stats.respawnTime: 200` (the official phase-0 value, ~3× a normal operator). [ASSUMED] the 部署数量 half is
//   recorded as informational text rather than modelled — no 卫戍 plumbing exists for it.
// - Skill: the official operator has **no skills at all** (`character_table.char_4220_kormr.skills` is empty — every
//   official 1★ operator is skill-less by design; all 860 TIER_1 operators have 0 skill slots). The 卫戍 data layer
//   nonetheless requires every chess to expose at least one selectable skill (`test/data.test.js`
//   "skills[] = every skill unlocked at the status" and `test/match/loadout.test.js` "selectable skills"), so his
//   record keeps the mode's generic low-rarity stand-in `skcom_atk_up[1]` 攻击力强化·α型 with its OFFICIAL blackboard
//   (`bb.atk` 0.3 at rank 4, 0.4 at rank 7 — from skill_table, not invented). [ASSUMED] that skill is a 卫戍-mode
//   placeholder, not official kit: it is the generic spec the `content/generic.js` fallback already implements
//   exactly, so this kit authors no `skills` entry for it (the generic spec is byte-equivalent and a hand-written
//   duplicate could drift).
// - T1 黑色猎犬 「部署后对周围一定范围内最近的1名敌人发动总计6次无视闪避的斩击，每次斩击造成相当于攻击力
//   `atk_scale` 的法术伤害，最后一次斩击改为造成攻击力 `final_atk_scale` 的法术伤害并使目标恐惧 `fear` 秒」
//   (rank 4 full potential: atk_scale 2, final_atk_scale 4, fear 4). Implemented below.
import { num, talentBb, skillRec, enemiesInGrid, up } from '../shared/tier1.js';

/**
 * [ASSUMED] The gap between the talent's six slashes, in seconds. The official text says 「总计6次」 and the battle
 * skeleton plays six separate slash animations, but no data table carries an interval (character_table's talent
 * blackboard has only atk_scale / final_atk_scale / fear). 0.25 s keeps the whole sequence inside one second-ish and
 * matches the pace of the other multi-hit talents of this repo (予愿安洁莉娜 / 蕾缪安's pulse intervals). Named so a
 * later source can replace it in one place.
 */
const SLASH_INTERVAL = 0.25;

/** 「总计6次」 — the total number of slashes. No blackboard key carries it (only the text), so it is a named constant. */
const SLASH_COUNT = 6;

export default {
  char_4220_kormr: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    // His one selectable skill is the mode's generic low-rarity stand-in `skcom_atk_up[1]` 攻击力强化·α型 with the
    // OFFICIAL skill_table blackboard (`atk` 0.3 at rank 4 / 0.5 at rank 7, duration 20 s). `content/generic.js` derives
    // exactly this spec from `atk → mods.atkPct` and `duration > 0 ⇒ kind: 'duration'`, but `tools/kit-coverage.mjs`
    // only counts a skill as authored when the CHESS'S OWN KIT names it under `skills`, so it is spelled out here —
    // byte-equivalent to the fallback, and read from the record so it can never drift from the data.
    const sb = skillRec(chess, 'skcom_atk_up[1]') ?? {};
    const skill = {
      kind: 'duration',
      duration: num(sb.duration, 20),
      mods: { atkPct: num(sb.bb?.atk) },
    };
    return {
      skills: { 'skcom_atk_up[1]': skill },
      talents: [
        {
          install(battle, unit) {
            const scale = num(t0.atk_scale);
            const finalScale = num(t0.final_atk_scale);
            const fear = num(t0.fear);
            if (!(scale > 0) || !(finalScale > 0)) return;
            /**
             * 「部署后」: pick the nearest enemy in the ring around him and run the six-slashes sequence.
             * 次数 = SLASH_COUNT total: the first SLASH_COUNT−1 at `atk_scale`, the last at `final_atk_scale`.
             * 目标一旦被击倒（或离开/消失）就中断 —— 原话是「对…1名敌人」，不换目标。
             * 斩击「无视闪避」⇒ canDodge: false；每次都是法术伤害。
             */
            /**
             * 「周围一定范围内最近的1名敌人」: the NEAREST enemy of the ring around him. `enemiesInGrid(battle, unit,
             * null)` = the unit's own attack range, best-targets-first (tier1.js: enemiesInKeys + sortEnemyTargets);
             * the nearest is then the first by distance, ties broken by uid (deterministic).
             */
            const nearestEnemy = () => {
              const ring = enemiesInGrid(battle, unit, null);
              if (!ring.length) return null;
              return ring.slice().sort((a, b) => (Math.abs(a.tileR - unit.tileR) + Math.abs(a.tileC - unit.tileC))
                - (Math.abs(b.tileR - unit.tileR) + Math.abs(b.tileC - unit.tileC)) || a.uid - b.uid)[0];
            };
            const strike = (target) => {
              if (!up(unit) || unit.mem.kormrStruck || !target) return;
              unit.mem.kormrStruck = true;
              let n = 0;
              const slash = () => {
                if (!up(unit) || !target.alive || target.removed) return;
                n += 1;
                const last = n >= SLASH_COUNT;
                battle.dealDamage(unit, target, battle.makeDamage({
                  amount: unit.s.atk * (last ? finalScale : scale),
                  type: 'arts',
                  canDodge: false,                        // 「无视闪避」
                  isSkill: true,
                  tags: ['talent'],
                }));
                if (last) {
                  if (fear > 0 && target.alive) battle.applyStatus(target, 'fear', { duration: fear, source: unit });
                  battle.fx('swordStorm', { x: unit.x, y: unit.y, id: unit.id });
                  return;
                }
                battle.after(SLASH_INTERVAL, slash);
              };
              slash();
            };
            // 「部署后」: arm on deploy, then fire once a target is actually in range. The enemy wave of a real battle
            // is spawned by the stage, not necessarily before the operator lands, so a one-shot attempt at the deploy
            // event itself would silently do nothing whenever the tile is still empty — the official behaviour is the
            // howl going off as soon as there is something to howl at. Armed per deployment.
            const arm = () => { unit.mem.kormrArmed = true; unit.mem.kormrStruck = false; };
            battle.on('deploy', (c) => { if (c.unit === unit) arm(); }, { owner: unit });
            battle.on('tick', () => {
              if (!unit.mem.kormrArmed) return;
              const t = nearestEnemy();
              if (t) strike(t);
            }, { owner: unit });
            if (up(unit)) arm();
          },
        },
      ],
    };
  },
};
