// Enrich the author's literal sound references without changing which files play.
// This import-time step writes an offline supplement; ordinary rebuilds read that supplement.
import fs from 'node:fs';
import path from 'node:path';
import {bankPool} from '../../tools/assets/audio.mjs';

const input = path.join(import.meta.dirname, 'extra-audio-author.json');
const author = JSON.parse(fs.readFileSync(input, 'utf8'));
const known = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'extra-audio-0.3.1.json'), 'utf8'));
const official = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const officialPools = official.soundFXBanks.map(bankPool);

for (const [charId, unit] of Object.entries(author.units)) {
  if (known.units[charId]) continue;
  for (const [sounds, poolField, group] of [
    [{attack: unit.attack, hit: unit.hit}, 'pools', 'ordinary'],
    [unit.attacks, 'attackPools', 'attack'], [unit.hits, 'hitPools', 'hit'],
  ]) {
    for (const [role, url] of Object.entries(sounds ?? {})) {
      if (!url) continue;
      const soundPath = url.replace('/assets/audio/sfx/', '');
      const officialPool = officialPools.find(pool => pool.id.includes(charId) && pool.sounds[soundPath]);
      const id = officialPool?.id ?? `marisa.${charId}.${group}.${role}`;
      // [ASSUMED] The author's custom scalar sounds supply no bank parameters. Match the
      // existing unpooled playback defaults: cap 2, no takeover, pitch 1 and no delay.
      const pool = officialPool ?? {id, maxSoundAllowed: 2, popOldest: false,
        sounds: {[soundPath]: {minPitch: 1, maxPitch: 1, delay: 0}}};
      author.pools[id] = pool;
      unit[poolField] ??= {};
      unit[poolField][role] = id;
    }
  }
}
fs.writeFileSync(input, JSON.stringify(author, null, 2) + '\n');
console.log(`Prepared ${Object.keys(author.pools).length} author sound pools.`);
