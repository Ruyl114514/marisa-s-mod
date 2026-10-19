// server/sim/content/kits/ops/op-aigis.js — 埃癸斯 (char_4218_aigis) MOD 卫戍棋子 kit: 5★ 狙击·攻城手 (SNIPER/skybreaker),
// a 3-本 PRESET chess of this MOD (server/sim/content/index.js MOD_KIT_KEYS, keyed by the BARE chessId
// `chess_char_4218_aigis`). Not a 自选 pick: deliberately absent from kits/index.js OPERATOR_KIT_FILES so her charId
// never reaches KITTED_CHARS / the 自选编队 pool (shared/diy.js diyPool / validateDiyPicks).
//
// Forms (tools/mod-content.mjs MOD_CHESS_RECORDS): normal `_a` = PHASE_2 Lv1, skills at rank 4, no module;
// elite `_b` = PHASE_2 Lv1, rank 7. Full potential (潜能 6 = rank 5), like every MOD record.
// Sources: character_table / skill_table (zh_CN, as built into data/chess.json) and PRTS 埃癸斯 (SEES 联动干员,
// teamId `sees`; trait 起飞/降落, S1 启动狂宴模式, S2 全弹发射, T2 反暗影特殊压制兵装).
//
// - Trait (攻城手) "部署后起飞，起飞后只攻击空中敌人；技能开启时降落且攻击造成群体物理伤害":
//   起飞 is the engine's `liftoff` flag (buffs.js:35 boolean OR key; 对地规避 targeting.js `evadesGround`, damage.js
//   `liftoffEvades`) — the same flag 蒂比's kit uses (`ops/chess_char_2_13-tippi.js` LIFTOFF_FLAGS). While airborne she
//   stays a ground unit on her tile (PRTS 行动方式 "起飞的干员仍然是地面单位").
//   「只攻击空中敌人」: implemented by narrowing her PROFILES' targetability while airborne (`canHitFly` only) — see
//   `install` below. 「技能开启时降落且攻击造成群体物理伤害」: the skill turns the flag off and enables a splash.
//   [ASSUMED] the trait does not say what happens after the skill ends; we re-take off when the skill's mods expire,
//   which is the only reading that keeps 「部署后起飞」 true for the rest of the deployment (PRTS draws her landing only
//   for the skill's duration).
// - S1 启动狂宴模式 (MANUAL, INCREASE_WITH_TIME, duration 20 s): ATK +`atk`, DEF +`def` while running,
//   attacks pick their victim RANDOMLY inside range (`rng.pick`), and she is 晕眩 for `stun` seconds after it ends.
//   Rank 4 bb: atk 0.7, def 0.3, stun 10; rank 7: atk 1, def 0.5, stun 10.
// - S2 全弹发射 (MANUAL, instant, duration −1): locks ONE enemy in range, `times` missiles each for `atk_scale` × ATK
//   PHYSICAL, then a final flying-kick hit for `kick_atk_scale` × ATK physical on the target AND the enemies around it.
//   Rank 4 bb: times 6, atk_scale 1, kick_atk_scale 2.1; rank 7: times 6, atk_scale 1.3, kick_atk_scale 2.7.
// - T1 is an official EMPTY slot (`name: null`, `hidden: true`, bb {}): nothing to implement.
// - T2 反暗影特殊压制兵装 "造成的物理伤害+12%，受到的物理伤害-12%" (full potential, phase 2): physical damage she DEALS
//   × `damage_scale`; physical damage she TAKES × (1 − `damage_resistance`). Implemented as a hit hook (outgoing) and a
//   damage-taken hook (incoming) so both halves are exact and independent of the damage pipeline's own multipliers.
// - Module (uniequip_002_aigis 约定的证明) is deliberately NOT declared: none of the ten MOD operators carries a
//   `modules[]` (the MOD convention — see the other MOD records), so adding one only for her would be inconsistent.
import { num, talentBb, skillRec, enemiesInGrid, up, statBuff } from '../shared/tier1.js';

/** Boolean flag set while she is airborne — the engine's own 起飞 flag (buffs.js:35, targeting.js evadesGround). */
const AIRBORNE = Object.freeze({ liftoff: true });

export default {
  char_4218_aigis: (bb, chess, _def) => {
    const b1 = skillRec(chess, 'skchr_aigis_1')?.bb ?? {};
    const b2 = skillRec(chess, 'skchr_aigis_2')?.bb ?? {};
    const t1 = talentBb(chess, 1);
    const dmgScale = num(t1.damage_scale, 1);
    const dmgRes = num(t1.damage_resistance, 0);
    return {
      skills: {
        // 启动狂宴模式: timed ATK/DEF, random targeting, self-stun on end.
        skchr_aigis_1: {
          kind: 'duration',
          duration: num(chess?.skills?.find((s) => s.skillId === 'skchr_aigis_1')?.duration, 20),
          mods: { atkPct: num(b1.atk), defPct: num(b1.def) },
          flags: { liftoff: false },          // 技能开启时降落
          targeting: { random: true },        // 「随机攻击范围内的目标」
          onEnd({ battle, unit }) {
            const stun = num(b1.stun);
            if (stun > 0 && up(unit)) battle.applyStatus(unit, 'stun', { duration: stun });
          },
        },
        // 全弹发射: `times` missiles at atk_scale, then a splash kick at kick_atk_scale.
        skchr_aigis_2: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const times = Math.max(1, Math.floor(num(b2.times, 6)));
            const per = num(b2.atk_scale);
            const kick = num(b2.kick_atk_scale);
            // 「锁定范围内一个目标」: the best target inside her own attack range (tier1's enemiesInGrid with a null
            // grid = `unit.rangeKeys`, best-first). An instant skill has no `skill.target` of its own.
            const target = enemiesInGrid(battle, unit, null, { n: 1 })[0];
            if (!target) return;              // 范围内没有敌人就不发动
            for (let i = 0; i < times; i++) {
              if (!target.alive || target.removed) break;
              battle.dealDamage(unit, target, battle.makeDamage({
                amount: unit.s.atk * per, type: 'phys', isSkill: true, tags: ['skill'],
              }));
            }
            if (!(kick > 0)) return;
            // 「之后自身飞踢向目标，对目标及目标周围敌人造成…物理伤害」 — 目标 + 其周围（溅射）。
            const near = battle.foesInRadius(target.x, target.y, 1).filter((x) => x.alive);
            const all = near.includes(target) ? near : [target, ...near];
            for (const e of all) {
              if (!e.alive) continue;
              battle.dealDamage(unit, e, battle.makeDamage({
                amount: unit.s.atk * kick, type: 'phys', isSplash: true, isSkill: true, tags: ['skill'],
              }));
            }
            battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id });
          },
        },
      },
      talents: [
        {},                                   // official empty slot (index 0)
        {
          // 反暗影特殊压制兵装 — 造成的物理伤害 ×damage_scale、受到的物理伤害 ×(1 − damage_resistance)。
          // 两个半段都走引擎自己的乘区（buffs.js MUL_KEYS）：`physDealtMul` 是「造成的物理伤害」，
          // `physTakenMul` 是「受到的物理伤害」（与 `dmgTakenMul`/脆弱 分开，正好对应官方「物理伤害」这个限定）。
          install(battle, unit) {
            const mods = {};
            if (dmgScale !== 1) mods.physDealtMul = dmgScale;
            if (dmgRes > 0) mods.physTakenMul = Math.max(0, 1 - dmgRes);
            if (Object.keys(mods).length) statBuff(battle, unit, 'talent:aigis:antishadow', mods);
          },
        },
      ],
      install(battle, unit) {
        // 起飞/降落: the trait's own state. 部署后起飞; while airborne she can only hit air units.
        const airborne = (on) => {
          if (on) {
            unit.mem.aigisAir = true;
            battle.addBuff(unit, { key: 'trait:aigis:liftoff', flags: AIRBORNE, persist: true, allowDead: true, refresh: 'replace' });
          } else {
            unit.mem.aigisAir = false;
            battle.removeBuff(unit, 'trait:aigis:liftoff');
          }
        };
        battle.on('deploy', (c) => { if (c.unit === unit) airborne(true); }, { owner: unit });
        if (up(unit)) airborne(true);
        // The skill's own liftoff flag (flags.liftoff: false on S1) drops her; when the skill's buffs expire she is
        // airborne again — the reading of 「部署后起飞」 used here ([ASSUMED], see the header).
        battle.on('skillStart', (c) => { if (c.unit === unit && c.skill && c.skill.id === 'skchr_aigis_1') airborne(false); }, { owner: unit });
        battle.on('skillEnd', (c) => { if (c.unit === unit && c.skill && c.skill.id === 'skchr_aigis_1') airborne(true); }, { owner: unit });
      },
    };
  },
};
