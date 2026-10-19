// server/sim/content/bonds/addon/unite-meta.js — prep side of the MOD bond 我们联合 (`uniteShip`): 五年计划.
//
// Registered from addon/meta.js (that file keeps the registration stub only, `registerUniteMeta(registry)`); the
// implementation lives here, beside addon/battle.js (the MOD bond's battle side, which owns 学生互助会 / the layer
// gains). Nothing here changes an upstream public API: it only uses the meta handler context (ctx.shopSlots /
// ctx.setShopSlot / ctx.rollChess / ctx.layers / ctx.bondActive / ctx.gd), the same vocabulary bands/meta.js' own
// shop-rewriting strategies use.
//
// The owner's text, verbatim:
//
//   五年计划：
//           在50层之后，刷出来的装备将必然为进阶状态。第100层之后，必刷出一名当前已解锁的最高本数的干员
//
//   五年计划 (Five-Year Plan)   ≥ 50 layers   every shop EQUIPMENT (装备 = item) slot holds the 进阶 version
//                              ≥ 100 layers  one chess slot holds an operator of the highest unlocked tier
//
// 「进阶」= golden (精锐) — the only reading of that word in this repo: builtinMeta.js' 整备 comment 「the next
// purchased item becomes advanced (golden)」 and gamedata.isGolden.
//
// 「在50层之后」/「第100层之后」 are implemented as ≥ 50 / ≥ 100 — the owner's ruling for this task, the ordinary
// 「之后即可享受」 reading of the text. No blackboard carries either number, so they are constants here, unlike the
// other add-on bonds in this directory, which read every number from data/bonds.json.
//
// =====================================================================================================================
// Which refreshes count (read out of the engine, not assumed)
//
//   * 主动刷新 (g.refresh → PlayerState.refresh, server/match/player/economy.js:181-195) rerolls the shop and then
//     dispatches onRefresh with `{ slots, free, price }` — no `trigger` key. THIS is the refresh a player performs.
//   * 回合开始自动刷新 (PlayerState.startRound, server/match/player/round.js:35 `rollShop({ keepFrozen: true })`) never
//     dispatches onRefresh: Match.startRound rolls the shop for every player and only then dispatches onRoundStart
//     (server/match/match/phases.js:277-278). A handler that hung on onRefresh alone would leave every round-start
//     roll un-advanced, which contradicts 「刷出来的装备」 (the clause is about what the shop SHOWS).
//     ⇒ both hooks run the plan: onRefresh, and onRoundStart (the round's roll is already done by then).
//   * ev.trigger === true is the 特质 / SERVER_REFRESH_SHOP re-trigger
//     (EffectDispatcher.triggerGarrisons, server/match/effectsMeta.js:352 — `{ slots, free: true, price: 0, trigger: true }`):
//     it re-runs the 刷新时 traits of the owned chess WITHOUT rerolling the shop, so it produces no 刷出来的 card. It is
//     excluded, exactly like the two existing precedents (addon/meta.js 奇迹 `if (!ev || ev.trigger || …) return;`,
//     garrisons/meta.js 拉普兰德 `if (ev && ev.trigger) return;`). Nothing is lost: every card a player can see got there
//     through a manual refresh or a round-start roll, both covered above.
//
// =====================================================================================================================
// How the shop is read (verified — one correction to the task brief)
//
//   ctx.shopSlots() does NOT hand out writable slot objects: effectsMeta.js:519 maps each slot to a fresh snapshot
//   `{ kind, id, basePrice, sold, frozen }`. Only the INDICES are usable, and every write goes through
//   ctx.setShopSlot(i, { kind, id }) (effectsMeta.js:661), which re-derives basePrice from the data and clears `sold`
//   — exactly what bands/meta.js' 梓兰 (band_shop_refresh_copy_max_lv_char) does.
//
//   The 进阶 id of an ITEM cannot come from gd.goldenIdOf: that helper looks the base up through gd.chess() and then
//   gd.chess(alt) only (server/match/gamedata.js:229-234), so for an item id it always returns null. The item path the
//   engine itself uses is the record's own field (PlayerState.upgradeItem / _itemMergeable, acquire.js:205,264):
//   `rec.upgradeChessId || rec.goldenId`.
//
// =====================================================================================================================
// Choices worth recording
//
//   * Both clauses run only while the bond is ACTIVE (ctx.bondActive) — the file-wide rule of addon/meta.js
//     ("Milestones read the persistent layers and pay only while the bond is active"), applied by 助力 / 远见 / 奇迹.
//     A bond whose record is not in data/bonds.json yet (the declaration is another author's task) makes bondActive
//     false, so the handler is inert: no crash, no effect. While the record is missing the dispatcher does not even
//     reach it — the bond loop iterates gd.bondIds (effectsMeta.js:225).
//   * ≥ 100 replaces the FIRST unsold chess slot in engine index order, and only when no chess slot already shows that
//     tier. The slot choice is deliberately not drawn from ctx.rng: the seeded meta stream is shared with the 机变
//     draft and the choice cards, and a guaranteed card is already deterministic — there is no reason to displace
//     other draws.
//   * ≥ 100 never falls back to a lower tier when the top tier has no free copy: the text names 「最高本数」 only, and a
//     pool without a copy left cannot show that operator to anyone (the ordinary shop roll behaves the same). It also
//     never promotes a chess to 精锐 — 「装备」 in clause 1 means equipment, i.e. items.
//   * No toast / i18n: the shop card itself shows the 进阶 state, so no new interface string is introduced.

/** 我们联合 (locked id; its declaration is written by another author — this handler tolerates its absence). */
const BOND = 'uniteShip';
/** 五年计划 clauses (the owner's literal numbers, implemented as ≥). */
export const FIVE_YEAR_GOLDEN_ITEM_LAYERS = 50;
export const FIVE_YEAR_TOP_TIER_LAYERS = 100;

/** Indices of the unsold shop slots of one kind ('chess' | 'item'). */
function unsoldSlots(ctx, kind) {
  return ctx.shopSlots().map((s, i) => (s && s.kind === kind && !s.sold ? i : -1)).filter((i) => i >= 0);
}

/** Clause 1 (≥ 50): every equipment slot holds the 进阶 (golden) id of what was rolled. Returns how many changed. */
export function goldenShopItems(ctx) {
  const slots = ctx.shopSlots();
  let n = 0;
  for (const i of unsoldSlots(ctx, 'item')) {
    const id = slots[i].id;
    if (ctx.gd.isGolden(id)) continue; // already advanced — a second run changes nothing
    const rec = ctx.gd.item(id);
    const gid = rec ? rec.upgradeChessId || rec.goldenId : null;
    if (!gid || !ctx.gd.item(gid)) continue; // the three MAGIC items have no advanced version
    // Owner ruling 2026-10-16 「五年计划精锐化的装备售价应为非精锐化装备的2倍，而不是固定5费」: the official data
    // prices EVERY 进阶 (isGolden) equipment record at purchasePrice 5 (56/56), so rewriting the slot id would show a
    // flat 5 no matter what the base cost. The explicit `price` overrides the re-derived basePrice
    // (effectsMeta.js setShopSlot: `Number.isFinite(slot.price) ? slot.price : gd.itemPrice(id)`), and `id` here is
    // still the BASE item of the slot, so ×2 is 2 × the non-进阶 price the owner asked for.
    if (ctx.setShopSlot(i, { kind: 'item', id: gid, price: ctx.gd.itemPrice(id) * 2 })) n++;
  }
  return n;
}

/** Clause 2 (≥ 100): one chess slot holds an operator of the highest unlocked tier (ctx.shopLevel()). */
export function topTierShopChess(ctx) {
  const tier = Math.max(1, ctx.shopLevel());
  const idx = unsoldSlots(ctx, 'chess');
  if (!idx.length) return 0;
  const slots = ctx.shopSlots();
  for (const i of idx) if (ctx.gd.tierOf(slots[i].id) === tier) return 0; // the guarantee already holds
  const id = ctx.rollChess({ tier });
  if (!id) return 0;
  return ctx.setShopSlot(idx[0], { kind: 'chess', id }) ? 1 : 0;
}

/** Both clauses of 五年计划, in the text's order (layers are the persistent ones; only while the bond is active). */
export function fiveYearPlan(ctx) {
  if (!ctx.bondActive(BOND)) return;
  const L = ctx.layers(BOND);
  if (L >= FIVE_YEAR_GOLDEN_ITEM_LAYERS) goldenShopItems(ctx);
  if (L >= FIVE_YEAR_TOP_TIER_LAYERS) topTierShopChess(ctx);
}

/** The two hooks the plan runs on (onRefresh carries `{ trigger }`: see the header). */
const HOOKS = {
  onRefresh(ctx, ev) {
    if (ev && ev.trigger) return; // 特质 / 特殊刷新: no reroll happened
    fiveYearPlan(ctx);
  },
  onRoundStart(ctx) {
    fiveYearPlan(ctx); // the round-start roll is already done and dispatched nothing itself
  },
};

/**
 * Register the prep side of 我们联合 on the meta registry. A handler already registered under this key is kept and
 * called first (the merge pattern of bonds/core.js registerMeta's 维多利亚 hammers), so a battle-side or later
 * registration of the same bond cannot silently drop these hooks — `MetaRegistry.register` replaces.
 * @param {{ get: (key: string) => object|null, bond: (id: string, h: object) => void }} registry
 */
export function registerUniteMeta(registry) {
  const prev = typeof registry.get === 'function' ? registry.get(`bond:${BOND}`) : null;
  const handler = { ...(prev || {}) };
  for (const [hook, fn] of Object.entries(HOOKS)) {
    const before = prev && typeof prev[hook] === 'function' ? prev[hook] : null;
    handler[hook] = before ? function merged(ctx, ev) { before.call(this, ctx, ev); fn(ctx, ev); } : fn;
  }
  registry.bond(BOND, handler);
}
