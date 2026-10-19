// Exercise the published alliance in a real Match, including equipment membership and shop prices.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareMarisaTest} from '../../tools/marisa-test-runtime.mjs';
import {createRegistry} from '../../server/match/effectsMeta.js';
import {makeMatch, give, legalTileFor} from '../match/harness.js';
import {pieceBondIds} from '../../public/js/ui/gameLogic/bonds.js';

test('Students Union shop guarantees and Persona Bond membership use the ordinary Match flow', async t => {
  const profile = await prepareMarisaTest();
  const data = profile(['marisa']).data;
  const harness = makeMatch({mode: 'solo', difficulty: 'NORMAL', data, registry: createRegistry()}).start().toPrep(1);
  t.after(() => harness.m.dispose());
  const match = harness.m, player = harness.ps('p_0');
  const operatorId = 'chess_x_marisa_headbr_a';
  give(match, player, operatorId, 'board', legalTileFor(match, player, operatorId));
  const bondId = 'bond_x_marisa_uniteShip';
  assert.equal(player.bonds[bondId].active, true);
  player.addLayers(bondId, 100);
  player.shop.level = 5;
  const item = Object.values(data.items).find(record => !record.isGolden && record.upgradeChessId && record.price > 0);
  player.shop.slots = [{kind: 'item', id: item.id, basePrice: item.price, sold: false},
    {kind: 'chess', id: 'chess_char_1_01_a', basePrice: 1, sold: false}];
  match.dispatch(player, 'onRefresh', {free: false, price: 1});
  assert.equal(player.shop.slots[0].id, item.upgradeChessId);
  assert.equal(player.shop.slots[0].basePrice, match.gd.itemPrice(item.id) * 2);
  assert.equal(match.gd.tierOf(player.shop.slots[1].id), 5);

  const sees = 'bond_x_marisa_seesShip';
  const equipment = Object.values(data.items).find(record => record.selfGrantBondId === sees);
  const wearer = give(match, player, 'chess_char_1_02_a', 'board', legalTileFor(match, player, 'chess_char_1_02_a'));
  wearer.items = [player.newPiece('item', equipment.id)];
  player.recompute();
  assert.equal(player.bonds[sees].count, 1);
  assert.ok(pieceBondIds(data.chess[wearer.id], wearer.items, id => data.items[id]).includes(sees));
  assert.equal(match.dispatcher.errors, 0);
  assert.deepEqual(harness.logs.error, []);
});
