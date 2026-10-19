// server/sim/content/kits/ops/op-headbr.js — 凛冬 (char_115_headbr) MOD 卫戍棋子 kit: 5★ 先锋·尖兵 (PIONEER/pioneer),
// a 3-本 PRESET chess of this MOD (server/sim/content/index.js MOD_KIT_KEYS, keyed by the BARE chessId
// `chess_char_115_headbr`). Not a 自选 pick: she is deliberately absent from kits/index.js OPERATOR_KIT_FILES so her
// charId never reaches KITTED_CHARS / the 自选编队 pool (shared/diy.js diyPool / validateDiyPicks).
//
// Forms (tools/mod-content.mjs MOD_CHESS_RECORDS, derived through the official buildChess pipeline —
// see .dsh-tmp/sync/RECORD-DERIVATION.md): normal `_a` = PHASE_1 Lv55, skills at rank 4, no module;
// elite `_b` = PHASE_2 Lv50, rank 7. Full potential (潜能 6 = rank 5), like every MOD record.
// Sources: character_table / skill_table (zh_CN, as built into data/chess.json) and PRTS 凛冬 (talent 冲锋领袖,
// S1 冲锋号令·γ型, S2 乌萨斯战吼).
//
// - Trait (尖兵) "能够阻挡两个敌人": the profession default (block 2), so no traitOverride and no `trait` entry.
//   Her SOL-X 冬将军的毕业礼物 has no battle_equip_table row (0 entries — verified), so the MOD record strips it
//   (`module: null`, `modules: []`, the MOD convention): its 阻挡敌人时攻防各+8% never reaches the sim.
// - T1 冲锋领袖 「自身部署费用-1」(PHASE_1) / 「编入队伍时所有【先锋】职业干员的部署费用-1」(PHASE_2), bb `cost: -1`:
//   a 整备期 (prep-side) deployment-cost effect, NOT a battle aura. The sim's chess records carry no deploy-cost
//   channel: `data/chess.json` has no cost-reduction field, and the deployment cost the sim charges is the record's
//   own `stats.cost` (already at its full-potential value, with 潜能's own 部署费用-1 folded in by the generator).
//   [ASSUMED] The 编入队伍 half would have to live in the match's 干员持有 / loadout layer (server/match), which is
//   upstream code this kit must not reach into; it is therefore not implemented here, and neither is the PHASE_1
//   self half (already part of `stats.cost` via 潜能 rank 0 / 4: COST −1 each — see the derived `potDown`).
//   Recorded as a deliberate omission rather than silently dropped: 卫戍协议 charges the chess record's cost.
// - S1 冲锋号令·γ型 (AUTO, no target, INCREASE_WITH_TIME 35 SP / 20 init, instant): +cost DP at once. An AUTO skill
//   acting on nobody fires as soon as its SP is full (`trigger: 'SP_FULL'`) — the same skill and the same rule as
//   推进之王 / 德克萨斯 (op-siege.js S1, chess_char_1_08-texas.js).
// - S2 乌萨斯战吼 (MANUAL, INCREASE_WITH_TIME 35 SP / 20 init, 10 s): for its duration ATK +atk and DEF +def
//   (rank 7: +45 %, rank 10 data: +60 %), her attack interval becomes `interval` s (a FLAT new interval in seconds:
//   0.905 at rank 7, 0.83 at rank 10 — not a ratio; batMod's flat convention), and she gains `cost` DP at once.
//   ⚠ `value` (11 at rank 7, 12 at rank 10) is the skill text's own display number for the DP line
//   ("逐渐获得11点部署费用"): the engine grants `cost` per the blackboard, and `value` is not a separate effect.
//   The skill is MANUAL with no range: the data's trigger resolves to the ordinary MANUAL rule.
import { num, skillRec } from '../shared/tier1.js';

const S1 = 'skcom_charge_cost[3]';
const S2 = 'skchr_headbr_2';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

/**
 * 乌萨斯战吼's `interval` is the **absolute** attack interval in seconds the skill sets (0.905 s at rank 7,
 * 0.83 s at rank 10), not a delta and not a ratio — so it cannot go through `batMod` (which reads a flat ADDITION
 * of the base attack time, or a "间隔…缩短" ratio). `units.js` computes
 * `interval = bat × (1 + ΣbatPct) × 100 / aspd`, so the relative change to ask for is `interval / bat − 1`.
 */
const batRatio = (interval, chess) => {
  const bat = num(chess?.stats?.bat, 0);
  if (!(bat > 0) || !(interval > 0)) return 0;
  return Math.max(-0.9, interval / bat - 1);
};

export default {
  char_115_headbr: (bb, chess) => {
    const b1 = bbOf(chess, S1);
    const b2 = bbOf(chess, S2);
    // The duration mods the engine applies for the skill's 10 s and expires with it (the declarative form the other
    // duration kits use: op-shining.js S1 `{ kind: 'duration', mods: { … } }`).
    const mods = {};
    if (num(b2.atk)) mods.atkPct = num(b2.atk);
    if (num(b2.def)) mods.defPct = num(b2.def);
    const bat = batRatio(num(b2.interval), chess);
    if (bat) mods.batPct = bat;
    return {
      skills: {
        [S1]: {
          kind: 'instant', trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            const n = num(b1.cost);
            if (!(n > 0)) return;
            battle.addDp(unit.ownerId, n);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
          },
        },
        [S2]: {
          kind: 'duration',
          mods,
          onStart({ battle, unit }) {
            // 乌萨斯战吼 grants `cost` DP at once, on top of the timed ATK / DEF / interval mods above.
            const dp = num(b2.cost);
            if (!(dp > 0)) return;
            battle.addDp(unit.ownerId, dp);
            battle.fx('dp', { x: unit.x, y: unit.y, n: dp, id: unit.id });
          },
        },
      },
    };
  },
};
