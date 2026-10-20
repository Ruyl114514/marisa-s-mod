// ui/pluginTag.js — the plugin tag and the small facts the screens show of plugins (DESIGN §32 P1a): kept apart from
// the 插件 panel (ui/pluginPanel.js), which loads only when it opens, so the pages that show the tag carry just this.
//
//   * PluginTag — the tag under the title of 选择模拟协议 (screens/lobby.js, `lobby`): 「原版」, or 「插件 ×N」 for the
//     plugins this player takes into the room they create — marked unofficial (「非官方」) when they change gameplay
//     (a content set of its own, DESIGN §32.6); a tap loads the panel (ui/pluginPanel.js PluginPanel) and opens it, and
//     the panel edits that choice. Before any choice is made the tag follows the server's own default set (the plugins
//     every new room gets, from the welcome), so it tells the truth about the room 创建 will make.
//   * lobbyPlugins — that choice: an array of `{ id, settings? }` kept in this browser (sp.pref.lobby-plugins), or null
//     while the choice is the server's default. screens/lobby.js sends it right after room.create.
//   * roomPluginFacts — what a room's plugins are for this player; lobbyFacts — the same shape for that choice;
//     factsText, pluginTagText, sizeText, pluginMicro — their words.
//   * roomPlugins — the plugins a room may switch on (the catalogue's).
//   * UnofficialMark — the small 「非官方」 / MOD mark of a match with gameplay plugins (the briefing, the HUD corner, the
//     result; DESIGN §32.6, the design study's §7.4); nothing for the original game.
// Texts go through t() (docs/I18N.md).

import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { createStore, loadPref, savePref, useStore } from '../store.js';
import { catalog, cosmeticPlugins } from '../content.js';
import { isPluginId } from '../../../shared/plugins/manifest.js';
import { t } from '../../../shared/i18n.js';
import { rulePhrases } from '../../../shared/plugins/rules.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** A size in KB / MB. @param {number} n */
export const sizeText = (n) => (!Number.isFinite(n) ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The plugin classes that make a room unofficial (a content set of its own: server/plugins/roomSets.js). */
export const GAMEPLAY_CLASSES = ['content', 'script', 'trusted'];

/**
 * What the room's plugins are for this player: `count` (0 = the original art), the ids switched on and those switched on
 * automatically, whether this player may change them (the host, outside a match), the room's warnings.
 * @param {any} room room.state payload
 * @param {any} myId
 */
export function roomPluginFacts(room, myId) {
  const list = Array.isArray(room?.content?.plugins) ? room.content.plugins.filter((p) => p && typeof p.id === 'string') : [];
  const c = room?.content;
  return {
    count: list.length,
    plugins: list,
    on: new Set(list.map((p) => p.id)),
    auto: new Set(list.filter((p) => p.auto).map((p) => p.id)),
    chosen: list.filter((p) => !p.auto).map((p) => p.id),
    editable: room?.hostId != null && room.hostId === myId && !room.inMatch,
    inMatch: !!room?.inMatch,
    warnings: Array.isArray(c?.warnings) ? c.warnings.filter((w) => w && typeof w.code === 'string') : [],
    vs: typeof c?.vs === 'string' ? c.vs : null,
    // gameplay plugins (DESIGN §32.6): the room plays a content set of its own — unofficial
    modded: !!c && c.vanilla === false,
    cs: typeof c?.cs === 'string' ? c.cs : null,
    modes: Array.isArray(c?.modes) ? c.modes.filter((m) => m && typeof m.id === 'string') : [],
    modeId: typeof c?.modeId === 'string' ? c.modeId : null,
    dataBytes: Number.isFinite(c?.dataBytes) ? c.dataBytes : 0,
    rules: c?.rules && typeof c.rules === 'object' && !Array.isArray(c.rules) ? c.rules : null,
  };
}

/** The preference key of the plugins a player takes into the room they create (screens/lobby.js). */
export const LOBBY_PLUGINS_PREF = 'lobby-plugins';

/** One entry of the choice, or null when it names no plugin. @param {any} e */
const lobbyEntry = (e) => {
  if (e && typeof e === 'object' && isPluginId(e.id)) {
    const s = e.settings;
    return s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).length ? { id: e.id, settings: s } : { id: e.id };
  }
  return typeof e === 'string' && isPluginId(e) ? { id: e } : null;
};

/** @returns {{ entries: { id: string, settings?: Record<string, any> }[] | null }} */
function loadLobbyPlugins() {
  const raw = loadPref(LOBBY_PLUGINS_PREF, null);
  if (!Array.isArray(raw)) return { entries: null };
  return { entries: raw.map(lobbyEntry).filter(Boolean) };
}

/** The plugins this player takes into the next room, or null while that is the server's default set (see the header). */
export const lobbyPlugins = createStore(loadLobbyPlugins());
lobbyPlugins.subscribe((s) => savePref(LOBBY_PLUGINS_PREF, s.entries));

/** @param {{ id: string, settings?: Record<string, any> }[] | null} entries */
export function setLobbyPlugins(entries) {
  lobbyPlugins.set({ entries: Array.isArray(entries) ? entries.map(lobbyEntry).filter(Boolean) : null });
}

/**
 * The choice as room.setPlugins takes it (shared/protocol.js): `[{ id, settings? }]`, or null when there is no choice
 * of this browser's (the server's own default set stands). @param {any} entries
 */
export const lobbySelection = (entries) => (Array.isArray(entries)
  ? entries.map(lobbyEntry).filter(Boolean).map((e) => ({ id: e.id, ...(e.settings ? { settings: e.settings } : {}) }))
  : null);

/**
 * The same, without the ids this server no longer offers. A pre-selection outlives the servers it was made on: a plugin
 * removed since would make the whole set be refused (server/lobby.js resolveContent — one unknown id fails every entry),
 * so the choice is trimmed to what the catalogue has before it is sent. `offered` is null while the catalogue is not
 * loaded — the choice then goes as it is, as room.setPlugins always has.
 * @param {any} entries @param {any[] | null} offered @returns {{ id: string, settings?: any }[] | null}
 */
export function lobbySelectionFor(entries, offered) {
  const sel = lobbySelection(entries);
  if (!sel || !Array.isArray(offered)) return sel;
  const ids = new Set(offered.map((p) => p.id));
  return sel.filter((e) => ids.has(e.id));
}

/** The plugins a room may switch on: the loaded cosmetic and gameplay plugins of scope `room` (the catalogue's order). */
export const roomPlugins = (plugins) => [
  ...cosmeticPlugins(plugins, 'room'),
  ...(Array.isArray(plugins) ? plugins : []).filter((p) => p && GAMEPLAY_CLASSES.includes(p.class) && p.status === 'loaded' && Array.isArray(p.scope) && p.scope.includes('room')),
].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

/**
 * The room the choice would make, in the shape of roomPluginFacts (the panel and the tag read both the same way):
 * `offered` is the catalogue's room plugins (roomPlugins) — the classes of the chosen ones come from it, so 「非官方」
 * shows before the room exists.
 * @param {{ entries: any, defaults?: string[] | null, offered?: any[] | null }} c
 */
export function lobbyFacts({ entries, defaults = null, offered = null }) {
  const known = new Map((Array.isArray(offered) ? offered : []).map((p) => [p.id, p]));
  const picked = Array.isArray(entries) ? entries : (Array.isArray(defaults) ? defaults.map((id) => ({ id })) : []);
  const list = picked.map(lobbyEntry).filter(Boolean).map((e) => {
    const p = known.get(e.id);
    return { id: e.id, ...(p?.version ? { version: p.version } : {}), ...(p?.class ? { class: p.class } : {}), ...(e.settings ? { settings: e.settings } : {}) };
  });
  return {
    count: list.length,
    plugins: list,
    on: new Set(list.map((p) => p.id)),
    auto: new Set(),
    chosen: list.map((p) => p.id),
    editable: true,
    inMatch: false,
    warnings: [],
    vs: null,
    modded: list.some((p) => GAMEPLAY_CLASSES.includes(p.class)),
    cs: null,
    modes: [],
    modeId: null,
    dataBytes: 0,
    rules: null,
  };
}

/**
 * The active non-default rules in words, or '' when the room plays the official options.
 * @param {Record<string, string>|null|undefined} rules
 */
export function ruleLine(rules) {
  const phrases = rulePhrases(rules);
  if (!phrases.length) return '';
  return t('规则：{text}', { text: phrases.map((p) => t(p)).join('；') });
}

/** Does the room play gameplay plugins (a content set of its own: unofficial — DESIGN §32.6)? @param {any} room */
export const isModdedRoom = (room) => !!room?.content && room.content.vanilla === false;

/**
 * The small unofficial mark of a match with gameplay plugins (see the header): 「非官方」 (or the HUD's MOD), nothing for
 * the original game. @param {{ room: any, compact?: boolean, class?: string }} props
 */
export function UnofficialMark({ room, compact = false, class: cls = '' }) {
  if (!isModdedRoom(room)) return null;
  // the gameplay plugins only (a cosmetic one beside them changes no battle)
  const n = roomPluginFacts(room, null).plugins.filter((p) => p.class === 'content').length;
  const tip = t('非官方：本局使用了改变玩法的插件（{n} 个），不计入统计总览', { n });
  return html`<span class=${cx('modmark', compact && 'modmark--compact', cls)} title=${tip} aria-label=${tip} data-testid="unofficial-mark">
    ${compact ? 'MOD' : t('非官方')}
  </span>`;
}

/** What a set of plugin facts says: 「插件 ×N」 or 「原版」, and the room's rules. @param {any} f */
export const factsText = (f) => [f.count ? t('插件 ×{n}', { n: f.count }) : t('原版'), ruleLine(f.rules)].filter(Boolean).join(' · ');

/** What the tag says: 「插件 ×N」 or 「原版」. @param {any} room */
export const pluginTagText = (room) => factsText(roomPluginFacts(room, null));

/** A label for a catalogue entry's micro line in 设置 (ui/settings.js). @param {any} p */
export const pluginMicro = (p) => [p?.id, p?.version ? `v${p.version}` : null, Number.isFinite(p?.artBytes) ? sizeText(p.artBytes) : null].filter(Boolean).join(' · ');

/**
 * The same tag, read only: the room's plugins as text, no panel behind it. screens/room.js shows this — a room's plugins
 * are chosen on 选择模拟协议 (PluginTag above), so the room only reads the result.
 * @param {{ room: any, myId?: any }} props
 */
export function PluginTagStatic({ room }) {
  const f = roomPluginFacts(room, null);
  const rulesText = ruleLine(f.rules);
  return html`<span class=${cx('plugtag plugtag--static', f.count && 'is-modded', f.modded && 'is-unofficial', rulesText && 'plugtag--rules')}
      data-testid="plugin-tag" title=${f.modded ? t('本房间使用了改变玩法的插件（非官方）') : t('插件')} aria-label=${factsText(f)}>
    <${Icon} name=${f.count ? 'edit' : 'check'} />${f.count ? t('插件 ×{n}', { n: f.count }) : t('原版')}${f.modded ? html`<b class="plugtag__mod">${t('非官方')}</b>` : null}${rulesText ? html`<span class="plugtag__rules" data-testid="plugin-rules">${rulesText}</span>` : null}
  </span>`;
}

/**
 * The tag under the title: 「原版」 or 「插件 ×N」; a tap loads the panel and opens it. With `lobby` it shows (and edits)
 * the plugins this player takes into the room they create — the panel writes ui/pluginTag.js lobbyPlugins instead of
 * asking a server (there is no room yet), and screens/lobby.js sends that choice right after room.create. `defaults`
 * (the server's default set, from the welcome) is what the tag reads before this browser has a choice of its own.
 * @param {{ room?: any, myId?: any, lobby?: boolean, defaults?: string[] | null }} props
 */
export function PluginTag({ room = null, myId, lobby = false, defaults = null }) {
  // the panel's component once loaded (a function in state: set through an updater)
  const [Panel, setPanel] = useState(null);
  const picked = useStore((s) => s.entries, Object.is, lobbyPlugins);
  const cat = useStore((s) => s, Object.is, catalog);
  const offered = lobby && cat.status === 'ready' ? roomPlugins(cat.plugins) : null;
  const f = lobby ? lobbyFacts({ entries: picked, defaults, offered }) : roomPluginFacts(room, myId);
  const rulesText = ruleLine(f.rules);
  // before the room exists there is nothing to describe — the tag says what the next room will carry instead
  const tip = lobby
    ? (f.modded ? t('这一局会用改变玩法的插件（非官方）；点这里挑') : t('点这里挑这一局要用的插件'))
    : (f.modded ? t('本房间使用了改变玩法的插件（非官方）') : t('插件'));
  const open = () => {
    import('./pluginPanel.js').then((m) => setPanel(() => m.PluginPanel), (err) => console.warn('[plugins] the panel did not load', err));
  };
  return html`<button type="button" class=${cx('plugtag', f.count && 'is-modded', f.modded && 'is-unofficial', rulesText && 'plugtag--rules')} data-testid="plugin-tag" onClick=${open}
      title=${tip} aria-label=${factsText(f)}>
    <${Icon} name=${f.count ? 'edit' : 'check'} />${f.count ? t('插件 ×{n}', { n: f.count }) : t('原版')}${f.modded ? html`<b class="plugtag__mod">${t('非官方')}</b>` : null}${rulesText ? html`<span class="plugtag__rules" data-testid="plugin-rules">${rulesText}</span>` : null}
  </button>
  ${Panel ? html`<${Panel} open=${true} room=${room} myId=${myId} lobby=${lobby} defaults=${defaults} onClose=${() => setPanel(null)} />` : null}`;
}
