// The host already handles ordinary equipment stats. Only Persona Bond's layer-based
// attack bonus needs a script; its membership grant is read by the shared membership paths.
import {bondLayers, directMods, itemRecord, itemsOf, num, passiveBuff} from './source/server/sim/content/support/index.js';

export function installPersonaBond(battle) {
  const holders = battle.allyUnits.filter(unit => unit.kind === 'op' && itemsOf(unit).some(id =>
    itemRecord(id)?.selfGrantBondId === 'seesShip'));
  if (!holders.length) return;

  function refresh() {
    for (const unit of holders) {
      let attackBonus = 0;
      for (const id of itemsOf(unit)) {
        const item = itemRecord(id);
        if (item?.selfGrantBondId !== 'seesShip' || !item.isGolden) continue;
        const params = item.params ?? {};
        const steps = Math.floor(bondLayers(battle, unit.ownerId, 'seesShip') / Math.max(1, num(params.stat_step, 10)));
        attackBonus += Math.min(num(params.stat_cap, 0.2), steps * num(params.atk_per_step, 0.05));
      }
      passiveBuff(battle, unit, 'item:marisa:persona-bond', directMods({atk: attackBonus}));
    }
  }
  refresh();
  // layerGain runs before the engine writes the new total. Read it on the next timer pass.
  battle.on('layerGain', event => {
    if (event.bondId === 'seesShip') battle.after(0, refresh);
  });
}
