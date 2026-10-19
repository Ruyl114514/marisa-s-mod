// Published packages contain shop records for the custom operators, but no DIY bodies.
// Derive prototype bodies from those exact normal/elite records. This keeps the author's
// balance and lets the existing DIY composer supply slot identity, price and affiliations.
import {statusKey} from '../../shared/standIn.js';

const BODY_FIELDS = ['stats', 'immunities', 'rangeId', 'rangeGrid', 'dmgType', 'attackKind',
  'projectile', 'canHitFly', 'targetPriority', 'trait', 'skills', 'talents', 'tokens', 'placeOnRanged', 'potDown'];
const UNIT_FIELDS = ['charId', 'name', 'appellation', 'rarity', 'profession', 'subProfessionId', 'subProfessionName', 'position', 'nationId'];
const pickFields = (record, fields) => Object.fromEntries(fields.filter(key => record[key] !== undefined)
  .map(key => [key, structuredClone(record[key])]));

export function addMissingDiyBodies(full, base) {
  const slots = Object.values(base.chess).filter(record => record.isDiy && [5, 6].includes(record.tier));
  const additions = Object.values(full.chess).filter(record => !record.isGolden
    && !base.chess[record.chessId] && !full.backups.units[record.charId]);
  for (const normal of additions) {
    const elite = full.chess[normal.goldenId];
    if (!elite) throw new Error(`Missing elite form for ${normal.charId}`);
    const forms = {};
    for (const slot of slots) {
      const record = slot.isGolden ? elite : normal;
      forms[statusKey(slot.status)] = {...pickFields(record, BODY_FIELDS), status: slot.status, modules: []};
    }
    full.backups.units[normal.charId] = {
      ...pickFields(normal, UNIT_FIELDS), forms, moduleNames: {}, standsIn: [], isNotObtainable: false,
      assets: {...normal.assets, avatarGolden: elite.assets.avatar, portraitGolden: elite.assets.portrait,
        spineGolden: elite.assets.spine},
    };
  }
}
