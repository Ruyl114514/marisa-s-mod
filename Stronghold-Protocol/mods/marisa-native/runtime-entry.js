import makoto from './source/server/sim/content/kits/ops/op-makoto.js';
import amiya from './source/server/sim/content/kits/ops/op-amiya3.js';
import headbr from './source/server/sim/content/kits/ops/op-headbr.js';
import headb2 from './source/server/sim/content/kits/ops/op-headb2.js';
import helage from './source/server/sim/content/kits/ops/op-helage.js';
import kormr from './source/server/sim/content/kits/ops/op-kormr.js';
import aigis from './source/server/sim/content/kits/ops/op-aigis.js';
import yukari from './source/server/sim/content/kits/ops/op-yukari.js';
import aglna from './source/server/sim/content/kits/ops/mod-aglna2.js';
import kalts, {anchorKit, ANCHOR} from './source/server/sim/content/kits/ops/mod-kalts2.js';
import {markerKit, MARKER} from './source/server/sim/content/kits/ops/mod-aglna2.js';
import {install as rhode} from './source/server/sim/content/bonds/addon/battle.js';
import {install as kun} from './source/server/sim/content/bands/battle.js';
import {install as garrisons} from './source/server/sim/content/garrisons/battle.js';
import {installPrep} from './runtime-prep.js';
import {installPersonaBond} from './runtime-items.js';
import {contentDataOf, setGameData} from './source/server/sim/content/support/index.js';

export default function setup(sp) {
  for (const [id, fn] of [
    ['chess_char_4217_makoto',makoto.char_4217_makoto],
    ['char_4217_makoto',makoto.char_4217_makoto],
    ['chess_char_1037_amiya3',amiya.char_1037_amiya3],
    ['char_1037_amiya3',amiya.char_1037_amiya3],
    ['chess_char_1015_aglna2',aglna.char_1015_aglna2],
    ['chess_char_1052_kalts2',kalts.char_1052_kalts2],
    ['chess_char_115_headbr',headbr.char_115_headbr],
    ['char_115_headbr',headbr.char_115_headbr],
    ['chess_char_1051_headb2',headb2.char_1051_headb2],
    ['chess_char_188_helage',helage.char_188_helage],
    ['chess_char_4220_kormr',kormr.char_4220_kormr],
    ['char_4220_kormr',kormr.char_4220_kormr],
    ['chess_char_4218_aigis',aigis.char_4218_aigis],
    ['char_4218_aigis',aigis.char_4218_aigis],
    ['chess_char_4219_yukari',yukari.char_4219_yukari],
    ['char_4219_yukari',yukari.char_4219_yukari],
    [ANCHOR,anchorKit],[MARKER,markerKit],
  ]) sp.kits.register(id,fn);
  sp.content.register({id:'marisa:gameplay',install(battle){
    setGameData(contentDataOf(battle.data));
    rhode(battle);
    kun(battle);
    garrisons(battle);
    installPersonaBond(battle);
  }});
  installPrep(sp);
}
