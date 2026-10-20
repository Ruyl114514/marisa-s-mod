// Building a content set is not free. The gameplay plugins' script preflight spawns a child process that evaluates their
// scripts under SES (seconds, not milliseconds), and the composition itself reads and hashes every file of every plugin.
// A host who opens a room pays that once, and until now they paid it in the room.create that needed it — in front of the
// very click they had just made. The set a server hands to every new room without being asked (plugins/config.json
// `default`) is known at boot, so it is built here instead: in the background, right after the server starts listening,
// while nothing else on the process is waiting for it.
//
// Two rules make this safe to do at all:
//   - it is never required to succeed. A server whose default plugins cannot be built still starts, still serves the
//     original game, and still lets a host pick plugins at create time — the room's own resolve reports the real problem
//     to that host, at the moment they ask (server/lobby.js resolveContent).
//   - it holds nothing. The set is left in the ordinary cache (server/plugins/contentSets.js keep()), not held like a
//     running room's set, so it neither counts against the server's maxSets limit nor keeps a room's set alive.
//
// `warm: false` on startServer turns it off (tests that build their own plugins, and anyone measuring a cold start).

const NOOP_LOG = { info() {}, warn() {}, error() {} };

const text = (of) => {
  const e = of && (of.detail || of.error);
  return typeof e === 'string' ? e : String(e ?? of);
};

/**
 * Build the server's default plugin set in the background.
 * @param {{
 *   plugins?: { defaults?: () => string[], resolve?: (ids: string[], opts?: object) => Promise<object> } | null,
 *   log?: { info?: Function, warn?: Function },
 *   enabled?: boolean,
 * }} options
 * @returns {Promise<object | null>} the resolve result, or null when there was nothing to warm or it failed.
 *   Never rejects: callers may await it (close) or ignore it (a test that wants the cold path).
 */
export function warmDefaultPlugins({ plugins = null, log = NOOP_LOG, enabled = true } = {}) {
  if (enabled !== true || !plugins || typeof plugins.resolve !== 'function') return Promise.resolve(null);
  let ids;
  try {
    ids = plugins.defaults?.() ?? [];
  } catch (e) {
    // a broken policy file is the lobby's warning (it says so at create time), not a reason to fail the boot
    log.warn?.(`[plugins] the default plugins cannot be read: ${text(e)}`);
    return Promise.resolve(null);
  }
  if (!Array.isArray(ids) || !ids.length) return Promise.resolve(null);
  const started = Date.now();
  // A macrotask, not a microtask: the composition below is synchronous for a long stretch (it reads and hashes every
  // file before the preflight child is spawned), and a microtask would run it before startServer's own promise reaches
  // its caller — turning a background warm-up into a delayed boot. setImmediate runs after that caller has been resumed.
  return new Promise((resolve) => {
    setImmediate(() => {
      Promise.resolve()
        .then(() => plugins.resolve(ids, { scope: 'room' }))
        .then((r) => {
          const ms = Date.now() - started;
          if (r && r.ok) {
            log.info?.(`[plugins] default set ${ids.join(', ')} built in ${ms} ms — the first room that opens with it skips the wait`);
            resolve(r);
            return;
          }
          log.warn?.(`[plugins] the default plugins (${ids.join(', ')}) cannot be built: ${text(r)} — rooms open with the original game until a host picks plugins`);
          resolve(null);
        }, (e) => {
          log.warn?.(`[plugins] the default plugins (${ids.join(', ')}) cannot be built: ${text(e)}`);
          resolve(null);
        });
    });
  });
}
