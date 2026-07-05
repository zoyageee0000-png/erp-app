'use strict';

(function (root) {

  const ACC = root.AccountingCore;
  if (!ACC) throw new Error('[AccountingStore] AccountingCore missing. Load accounting_constants.js first.');

  const IDB_STORES = ACC.IDB_STORES;

  const AccountingStore = {

    getOne: function (storeName, id) {
      return AccountingStore.loadAll(storeName).then(function (records) {
        return (records || []).find(function (r) { return r && r.id === id; }) || null;
      }).catch(function (e) {
        console.error('[AccountingStore] getOne failed for store:', storeName, 'id:', id, e);
        return null;
      });
    },

    // ARCHITECTURAL REFACTOR: routed through ERP.Persistence.saveRecord() —
    // the single choke point for all IndexedDB writes in the app, including
    // this subsystem's per-record (one journal/loan/ledger-line at a time)
    // data model. Same underlying primitive as everywhere else, just the
    // record-shaped entry point instead of the array-shaped one.
    putOne: function (storeName, record) {
      return root.ERP.Persistence.saveRecord(storeName, record)
        .catch(function (e) {
          console.error('[AccountingStore] putOne failed for store:', storeName, e);
          throw e;
        });
    },

    pruneWal: function (storeName, maxKeep) {
      return AccountingStore.loadAll(storeName).then(function (records) {
        records = records || [];
        var limit = (typeof maxKeep === 'number' && maxKeep >= 0) ? maxKeep : 0;
        if (records.length <= limit) return;
        records.sort(function (a, b) {
          var ta = (a && (a.timestamp || a.createdAt)) || 0;
          var tb = (b && (b.timestamp || b.createdAt)) || 0;
          return ta - tb;
        });
        var toDelete = records.slice(0, records.length - limit);
        return Promise.all(toDelete.map(function (r) {
          return r && r.id ? AccountingStore.deleteOne(storeName, r.id) : Promise.resolve();
        }));
      }).catch(function (e) {
        console.warn('[AccountingStore] pruneWal failed for store:', storeName, e);
      });
    },

    // ARCHITECTURAL REFACTOR: routed through ERP.Persistence.deleteRecord(),
    // which wraps a real db.delete() primitive (previously missing from
    // db.js entirely — this always silently fell through to a manual
    // indexedDB.open()+transaction reimplementation before).
    deleteOne: function (storeName, id) {
      return root.ERP.Persistence.deleteRecord(storeName, id).catch(function (e) {
        console.warn('[AccountingStore] deleteOne failed for store:', storeName, 'id:', id, e);
      });
    },

    // ARCHITECTURAL REFACTOR: routed through ERP.Persistence.load().
    loadAll: function (storeName) {
      return root.ERP.Persistence.load(storeName).catch(function (e) {
        if (typeof e === 'string' && e.indexOf('DB not open') !== -1) {
          return [];
        }
        console.error('[AccountingStore] loadAll failed for store:', storeName, e);
        return [];
      });
    },

    hydrateAll: function () {
      const stores = [
        IDB_STORES.JOURNALS,
        IDB_STORES.LEDGER,
        IDB_STORES.LOANS,
        IDB_STORES.BANK_ACCOUNTS,
        IDB_STORES.BANK_TRANSACTIONS,
        IDB_STORES.AUDIT_LOG,
        IDB_STORES.PERIODS,
        IDB_STORES.COA,
        IDB_STORES.EXPENSES,
      ];

      return Promise.all(stores.map(function (s) {
        return AccountingStore.loadAll(s);
      })).then(function (results) {
        return {
          journals:         results[0],
          ledger:           results[1],
          loans:            results[2],
          bankAccounts:     results[3],
          bankTransactions: results[4],
          auditLog:         results[5],
          periods:          results[6],
          coa:              _arrayToCOAMap(results[7]),
          expenses:         results[8] || [],
        };
      }).catch(function (e) {
        console.error('[AccountingStore] hydrateAll failed:', e);
        return {
          journals: [], ledger: [], loans: [], bankAccounts: [],
          bankTransactions: [], auditLog: [], periods: [], coa: {}, expenses: [],
        };
      });
    },
  };

  function _arrayToCOAMap(coaArr) {
    const map = {};
    (coaArr || []).forEach(function (a) { if (a && a.id) map[a.id] = a; });
    return map;
  }

  ACC.AccountingStore = AccountingStore;

})(typeof window !== 'undefined' && window !== null ? window : globalThis);
