'use strict';
/**
 * Loads real, unmodified production files from js/ into a Node `vm` context
 * that mimics the browser globals they expect (window, document stub,
 * localStorage stub, console). Every test in this suite runs against the
 * actual committed source — never a copy, never a re-implementation — so a
 * passing test means the shipped file itself behaves correctly.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');

const JS_DIR = path.join(__dirname, '..', '..', 'js');

// Files converted to real ES modules — shared with scripts/build.js so the
// test harness and the production bundle can never silently drift apart.
const { ESM_CONVERTED_FILES: _esmList } = require('../../scripts/esm-converted-files');
const ESM_CONVERTED_FILES = new Set(_esmList);

/**
 * For files in ESM_CONVERTED_FILES: transforms the real committed source
 * (export statements and all) into CommonJS via esbuild — a mechanical,
 * lossless, deterministic transform, not a re-implementation — then
 * evaluates that inside the sandbox and returns whatever it exported.
 * This keeps the test's promise ("loads real, unmodified production files")
 * intact: the source read is still the exact file shipped to the browser;
 * only its module wrapper is adapted so Node's vm can execute it.
 */
function loadESMFile(sandbox, filename) {
  const src = readSource(filename);
  const { code } = esbuild.transformSync(src, { loader: 'js', format: 'cjs' });
  const moduleObj = { exports: {} };
  const wrapped = new vm.Script(
    '(function(module, exports, require) {' + code + '\n})',
    { filename }
  );
  const fn = wrapped.runInContext(sandbox);
  fn(moduleObj, moduleObj.exports, () => { throw new Error('require() not supported in sandbox'); });
  return moduleObj.exports;
}

function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] || null,
    get length() { return store.size; }
  };
}

function makeDocumentStub() {
  return {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {}, contains: () => false },
      setAttribute() {}, appendChild() {}, addEventListener() {}
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { classList: { add() {}, remove() {} }, appendChild() {} }
  };
}

/**
 * Creates a fresh sandbox context. Each call is fully isolated (new window
 * object, new localStorage) so tests can't leak state into one another.
 */
function createSandbox(extraGlobals) {
  const localStorage = makeLocalStorage();
  const windowObj = {
    DEBUG_MODE: false,
    localStorage,
    location: { href: 'http://localhost/', hostname: 'localhost' },
    navigator: { userAgent: 'node-test-sandbox' },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    crypto: (typeof globalThis.crypto !== 'undefined') ? globalThis.crypto : undefined,
    BroadcastChannel: function BroadcastChannel() {
      this.postMessage = () => {};
      this.close = () => {};
      this.onmessage = null;
    },
    console
  };

  const sandbox = {
    window: windowObj,
    document: makeDocumentStub(),
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Error,
    TypeError,
    RangeError,
    navigator: windowObj.navigator,
    crypto: windowObj.crypto,
    indexedDB: undefined // deliberately absent: exercises the same
    // IndexedDB-unavailable / localStorage-fallback path real users hit
    // when the browser blocks IDB (private mode, quota, etc.)
  };

  Object.assign(sandbox, extraGlobals || {});
  vm.createContext(sandbox);
  return sandbox;
}

/** Reads a js/ file's real source, unmodified. */
function readSource(filename) {
  const p = path.join(JS_DIR, filename);
  return fs.readFileSync(p, 'utf8');
}

/** Runs one or more real js/ files, in order, inside the given sandbox. */
function loadFiles(sandbox, filenames) {
  for (const filename of filenames) {
    if (ESM_CONVERTED_FILES.has(filename)) {
      const exported = loadESMFile(sandbox, filename);
      // Converted files still self-assign to window/globalThis for backward
      // compatibility (see logger.js) — nothing further needed here. The
      // export capture exists so a future test can assert on it directly,
      // e.g. `const { Logger } = loadESMFile(sandbox, 'logger.js')`.
      continue;
    }
    const src = readSource(filename);
    const script = new vm.Script(src, { filename });
    script.runInContext(sandbox);
  }
  return sandbox;
}

module.exports = { createSandbox, loadFiles, loadESMFile, readSource, JS_DIR };
