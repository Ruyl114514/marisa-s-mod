// The plugin needs only the author's cold-wind scheduler. Host map devices stay in the host.
import {num} from './support/index.js';

export function startColdWind(battle, { playerId = null, interval, duration, first, ownerOnly = false } = {}) {
  const iv = num(interval, 0);
  if (!(iv > 0)) return null;
  const durOf = () => num(typeof duration === 'function' ? duration() : duration, 0);
  const handle = { cancelled: false, gusts: 0, timer: null, cancel() { this.cancelled = true; this.timer?.cancel(); } };
  const gust = () => {
    if (handle.cancelled || battle.finished) return;
    const dur = durOf();
    if (!(dur > 0)) return;
    let n = 0;
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden) continue;
      if (ownerOnly && playerId != null && e.ownerId !== playerId) continue;
      if (battle.applyStatus(e, 'cold', { duration: dur, source: null })) n++;
    }
    handle.gusts++;
    const R = battle.rect;
    battle.fx('coldWind', { x: (R.c0 + R.c1) / 2, y: (R.r0 + R.r1) / 2, playerId, n, duration: dur });
  };
  const firstDelay = Math.max(0, num(first, iv));
  handle.timer = battle.after(firstDelay, () => {
    if (handle.cancelled) return;
    gust();
    handle.timer = battle.every(iv, gust);
  });
  return handle;
}
