'use strict';
/**
 * Locks in Phase 1 / Step 1 (Week 1 leaf-file pilot): logger.js converted
 * to a real ES module. Proves two things:
 *   1. The file still works for every NOT-yet-converted classic-script
 *      consumer (window.Logger / globalThis.Logger unchanged, zero regressions).
 *   2. The file's real `export` is loadable and functionally correct through
 *      the new ESM-aware sandbox path, and resolves to the SAME instance as
 *      the window-attached one -- proving one real module, not two copies.
 */
const assert = require('assert');
const { createSandbox, loadFiles, loadESMFile } = require('./helpers/sandbox');

describe('logger.js -- ESM conversion pilot (Phase 1, Step 1)', () => {

  it('window.Logger backward-compat surface is fully intact after conversion', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['logger.js']);
    const Logger = sandbox.window.Logger;
    assert.ok(Logger, 'window.Logger must still be set for not-yet-converted files');
    assert.strictEqual(typeof Logger.info, 'function');
    assert.strictEqual(typeof Logger.warn, 'function');
    assert.strictEqual(typeof Logger.error, 'function');
    assert.strictEqual(typeof Logger.debug, 'function');
    assert.strictEqual(typeof Logger.setDebug, 'function');
  });

  it('real export { Logger } resolves to the SAME object as window.Logger', () => {
    const sandbox = createSandbox();
    const exported = loadESMFile(sandbox, 'logger.js');
    assert.ok(exported.Logger, 'ESM export must expose Logger');
    assert.strictEqual(
      exported.Logger,
      sandbox.window.Logger,
      'exported Logger must be identical to window.Logger -- one real module, not a divergent copy'
    );
  });

  it('Logger.error still calls console.error correctly through the ESM export', () => {
    const sandbox = createSandbox();
    const exported = loadESMFile(sandbox, 'logger.js');
    let captured = null;
    const origError = console.error;
    console.error = (...args) => { captured = args; };
    try {
      exported.Logger.error('test-message', 42);
    } finally {
      console.error = origError;
    }
    assert.ok(captured, 'Logger.error must call console.error');
    assert.ok(captured.includes('test-message'));
  });

});
