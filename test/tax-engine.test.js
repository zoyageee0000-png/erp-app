'use strict';
const { describe, it, assert } = require('./helpers/runner');
const { createSandbox, loadFiles } = require('./helpers/sandbox');

// This is the exact fallback formula that lives inline in sales_controller.js
// (the "if TaxEngine unavailable" branch). It must stay byte-identical to
// ERP.TaxEngine.calculateLineItem()'s paisa-rounding order, or a load-order
// fluke would silently shift real invoice totals. This test is the guard
// CHANGES_THIS_PASS.md describes running by hand (23,680 combinations) —
// now it's a permanent regression lock instead of a one-off check.
function inlineFallback(qty, price, discPct, taxPct) {
  const baseP = Math.round(qty * price * 100);
  const dAmtP = Math.round(baseP * discPct / 100);
  const discountedBaseP = baseP - dAmtP;
  const tAmtP = Math.round(discountedBaseP * taxPct / 100);
  return { basePaisa: baseP, discountPaisa: dAmtP, netBasePaisa: discountedBaseP, taxPaisa: tAmtP };
}

describe('ERP.TaxEngine.calculateLineItem() (erp.tax.engine.js, real file) — rounding equivalence', () => {
  it('matches sales_controller.js\'s own inline formula across a wide combination space (0 mismatches required)', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['accounting_constants.js', 'erp.tax.engine.js']);
    const TaxEngine = sandbox.window.ERP.TaxEngine;
    assert.ok(TaxEngine && typeof TaxEngine.calculateLineItem === 'function');

    const qtys = [1, 2, 3, 5, 7, 10];
    const prices = [0, 9.99, 49.5, 99, 100, 250.75, 999.99, 1500];
    const discounts = [0, 5, 10, 12.5, 15, 20, 33.33, 50];
    const taxRates = [0, 5, 8, 12, 17, 18, 28];

    let tested = 0, mismatches = [];
    for (const qty of qtys) {
      for (const price of prices) {
        for (const disc of discounts) {
          for (const tax of taxRates) {
            tested++;
            const expected = inlineFallback(qty, price, disc, tax);
            const actual = TaxEngine.calculateLineItem({ qty, price, discountPct: disc, taxRate: tax });
            if (actual.basePaisa !== expected.basePaisa ||
                actual.discountPaisa !== expected.discountPaisa ||
                actual.netBasePaisa !== expected.netBasePaisa ||
                actual.taxPaisa !== expected.taxPaisa) {
              mismatches.push({ qty, price, disc, tax, expected, actual });
            }
          }
        }
      }
    }

    assert.ok(tested >= 2000, `expected a large combination space, only tested ${tested}`);
    assert.strictEqual(mismatches.length, 0,
      `${mismatches.length}/${tested} mismatches found — first: ${JSON.stringify(mismatches[0])}`);
  });

  it('sales_controller.js actually calls ERP.TaxEngine.calculateLineItem (not just defines a matching fallback)', () => {
    const { readSource } = require('./helpers/sandbox');
    const src = readSource('sales_controller.js');
    assert.ok(/ERP\.TaxEngine\s*&&\s*typeof\s*ERP\.TaxEngine\.calculateLineItem\s*===\s*['"]function['"]/.test(src),
      'sales_controller.js must prefer ERP.TaxEngine.calculateLineItem before falling back');
  });
});
