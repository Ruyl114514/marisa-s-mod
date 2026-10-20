// C1 registration preflight (DESIGN §32.10); no author imports in the lobby.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../../shared/plugins/identity.js';
import { nodeSha256 } from './identity.js';
import { sandboxProcessOptions } from '../match/host/childHost.js';

// [ASSUMED] C1 stays a child process per plugin version and settings: one uncached probe — the child's start (the engine,
// and SES for a sandboxed script) and the plugin's setup — may take SCRIPT_PROBE_TIMEOUT_MS before SIGKILL; completed
// reports (script errors too) are kept, 256 per registry, so a build pauses once per plugin version and settings. 1 s
// killed honest sandboxed plugins under load (the child alone needed more), so the default is 5 s; SP_SCRIPT_PROBE_MS
// (500–60000) sets it for a slow or a busy server — the bundled Marisa MOD needs more than the default on some machines.
//
// Two spellings of the same check. preflightScripts spawns the child asynchronously (spawn, not spawnSync): a probe takes
// seconds, and spawnSync stops the whole process — every room's heartbeat, every other player's message — until it
// returns. The server awaits that one; buildContentSet is asynchronous so a first build still takes the same time but the
// server keeps serving while it runs. preflightScriptsSync is for callers that have no event loop to protect — the
// command-line and the test suites — and shares the cache, so neither spelling ever probes the same configuration twice.
const probeEnv = Number.parseInt(process.env.SP_SCRIPT_PROBE_MS ?? '', 10);
export const SCRIPT_PROBE_TIMEOUT_MS = Number.isInteger(probeEnv) && probeEnv >= 500 && probeEnv <= 60000 ? probeEnv : 5000;
const caches = new WeakMap();
/** Probes running now, by cache key: two rooms building the same set wait on one child, not two. */
const running = new WeakMap();
const failure = message => ({code:'PLUGIN_SCRIPT_CHECK',message});
const PROBE_SCRIPT = fileURLToPath(new URL('./scriptProbe.js', import.meta.url));

/** Shared cache/limit for both spellings. */
function cacheOf(registry) {
  let cache = caches.get(registry);
  if (!cache) { cache = new Map(); caches.set(registry, cache); }
  return cache;
}

/** Keep a completed report; a watchdog/process failure says nothing about compatibility, so it is never kept. */
function remember(cache, key, report, reported) {
  if (reported) {
    cache.set(key, report);
    if (cache.size > 256) cache.delete(cache.keys().next().value);
  }
  return report;
}

/** Parse the child's fd-3 report once it has exited, mapping each way it can fail to its own message. */
function readReport(out, { timedOut, reason, childError }) {
  let parsed;
  let reported = false;
  try { parsed = JSON.parse(out); reported = !!parsed && typeof parsed === 'object'; } catch { parsed = failure('script setup failed'); }
  const report = timedOut ? failure(`script setup exceeded ${SCRIPT_PROBE_TIMEOUT_MS} ms; child terminated (SIGKILL)`)
    : reason === 'error' ? failure('script setup process failed: ' + (childError || 'spawn failed'))
      : reason !== 'exit0' && !parsed?.code ? failure('script setup failed')
        : parsed;
  return { report, reported: reported && !timedOut && reason !== 'error' };
}

/**
 * Run one probe child and read its report. Never rejects: a failure of the child is a report of its own.
 * @param {string} input the JSON payload on the child's stdin
 * @param {{execArgv: string[], [k: string]: any}} processOptions
 * @returns {Promise<{report: any, reported: boolean}>}
 */
function runProbe(input, processOptions) {
  return new Promise((resolve) => {
    const { execArgv = [], ...options } = processOptions;
    let out = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(process.execPath, [...execArgv, PROBE_SCRIPT], {
      ...options, stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, SCRIPT_PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.stdio[3]?.on('data', (d) => { if (out.length < 8 * 1024 * 1024) out += d.toString('utf8'); });
    child.stderr?.on('data', () => {});
    child.stdio[3]?.on('error', () => {});
    const finish = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(readReport(out, { timedOut, reason, childError: child.spawnerror?.message }));
    };
    child.on('error', (e) => { child.spawnerror = e; finish('error'); });
    child.on('close', (code) => finish(code === 0 ? 'exit0' : 'exit'));
    // a closed stdin is the child's own report of a failed read: it exits non-zero and says why on fd 3
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

/**
 * The same probe, run inline. Only for callers with no event loop to keep serving (command line, test suites): it blocks
 * this thread for as long as the child takes.
 * @param {string} input @param {{execArgv: string[], [k: string]: any}} processOptions
 * @returns {{report: any, reported: boolean}}
 */
function runProbeSync(input, processOptions) {
  const { execArgv = [], ...options } = processOptions;
  const r = spawnSync(process.execPath, [...execArgv, PROBE_SCRIPT], {
    ...options, input, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe', 'pipe'], timeout: SCRIPT_PROBE_TIMEOUT_MS, killSignal: 'SIGKILL',
  });
  // fd 3 is outside stdio[3] for spawnSync: it is only reachable through `output` when out-fd is requested.
  const out = r.output?.[3] ?? '';
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL';
  return readReport(typeof out === 'string' ? out : out.toString('utf8'), {
    timedOut, reason: r.error ? 'error' : r.status === 0 ? 'exit0' : 'exit', childError: r.error?.message,
  });
}

/** The probe payload for one script. */
function probeInput(script, part, settings) {
  return JSON.stringify({scripts:[script],hashInput:{plugins:[part],settings:{[script.id]:settings}}});
}

/** Lock identity plus the actual descriptor protects CLI tests with an absent/stale lock too.
 *  Settings can change computed registration ids, so they must never share a probe result. */
const probeKey = (script, part, settings) =>
  canonicalJson([script.id,script.hash,part.files['@script'],nodeSha256(canonicalJson(settings))]);

/** Collect the first registration failure across every script. */
function registrationFailure(scripts, reports) {
  const owners = new Map();
  for (let i = 0; i < scripts.length; i++) {
    const report = reports[i];
    if (report.code) return report;
    if (!Array.isArray(report.registrations) || report.registrations.some(r =>
      typeof r?.key !== 'string' || r.pluginId !== scripts[i].id)) return failure('invalid script registration report');
    for (const {key,pluginId} of report.registrations) {
      if (owners.has(key)) return {code:'PLUGIN_SCRIPT_CONFLICT',message:`${key}: ${owners.get(key)} and ${pluginId} both register this id`};
      owners.set(key,pluginId);
    }
  }
  return null;
}

/** Each script's (cache key, part, settings). */
const probeParts = (scripts, hashInput) => scripts.map(script => {
  const part = hashInput.plugins.find(p => p.id === script.id);
  const settings = hashInput.settings[script.id];
  return { script, part, settings, key: probeKey(script, part, settings) };
});

/**
 * Check that every script's setup registers nothing twice (DESIGN §32.10). Asynchronous: the child runs off this thread.
 * @param {any} registry @param {any[]} scripts @param {any} hashInput
 * @param {{probe?: (input: string, options: any) => Promise<{report: any, reported: boolean}>}} [opts]
 * @returns {Promise<{code: string, message: string} | null>} the first failure, or null
 */
export async function preflightScripts(registry, scripts, hashInput, { probe = runProbe } = {}) {
  const cache = cacheOf(registry);
  const busy = running.get(registry) ?? new Map();
  running.set(registry, busy);
  const reports = [];
  for (const { script, part, settings, key } of probeParts(scripts, hashInput)) {
    let report = cache.get(key);
    if (!report) {
      const { execArgv = [], ...processOptions } = script.execution === 'sandbox' ? sandboxProcessOptions(128) : {};
      // one child per key, however many builds ask at once
      let pending = busy.get(key);
      if (!pending) {
        pending = probe(probeInput(script, part, settings), { ...processOptions, execArgv })
          .then(({ report: r, reported }) => remember(cache, key, r, reported))
          .finally(() => busy.delete(key));
        busy.set(key, pending);
      }
      report = await pending;
    }
    reports.push(report);
  }
  return registrationFailure(scripts, reports);
}

/**
 * The same check, inline. Only for callers with no event loop to keep serving (command line, test suites): it blocks this
 * thread for as long as the child takes, and shares the cache with the asynchronous form.
 * @param {any} registry @param {any[]} scripts @param {any} hashInput
 * @param {{probe?: (input: string, options: any) => {report: any, reported: boolean}}} [opts]
 * @returns {{code: string, message: string} | null} the first failure, or null
 */
export function preflightScriptsSync(registry, scripts, hashInput, { probe = runProbeSync } = {}) {
  const cache = cacheOf(registry);
  const reports = probeParts(scripts, hashInput).map(({ script, part, settings, key }) => {
    const cached = cache.get(key);
    if (cached) return cached;
    const { execArgv = [], ...processOptions } = script.execution === 'sandbox' ? sandboxProcessOptions(128) : {};
    const { report, reported } = probe(probeInput(script, part, settings), { ...processOptions, execArgv });
    return remember(cache, key, report, reported);
  });
  return registrationFailure(scripts, reports);
}
