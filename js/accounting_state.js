'use strict';

(function(root) {

  const ACC = root.AccountingCore;
  if (!ACC) throw new Error('[AccountingState] AccountingCore namespace missing. Load accounting.constants.js first.');

  const { SCHEMA_VERSION, DEFAULT_COA, PERIOD_STATUS } = ACC;

  let _state = _createInitialState();
  let _sourceIndex = new Set();

  function _createInitialState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      initialized:   false,

      coa: {},

      journals: [],

      ledger: [],

      expenses: [],

      bankAccounts: [],

      bankTransactions: [],

      loans: [],

      periods: [],

      auditLog: [],

      reversalEntries: [],

      meta: {},
    };
  }

  const MUTATIONS = Object.freeze({
    INITIALIZE:              'INITIALIZE',
    ADD_COA_ACCOUNT:         'ADD_COA_ACCOUNT',
    DEACTIVATE_COA_ACCOUNT:  'DEACTIVATE_COA_ACCOUNT',
    APPEND_JOURNAL:          'APPEND_JOURNAL',
    UPDATE_JOURNAL_STATUS:   'UPDATE_JOURNAL_STATUS',
    APPEND_LEDGER_ENTRIES:   'APPEND_LEDGER_ENTRIES',
    REPLACE_LEDGER:          'REPLACE_LEDGER',
    ADD_EXPENSE:             'ADD_EXPENSE',
    UPDATE_EXPENSE_STATUS:   'UPDATE_EXPENSE_STATUS',
    ADD_BANK_ACCOUNT:        'ADD_BANK_ACCOUNT',
    ADD_BANK_TRANSACTION:    'ADD_BANK_TRANSACTION',
    RECONCILE_BANK_TX:       'RECONCILE_BANK_TX',
    MARK_BANK_TX_REVERSED:   'MARK_BANK_TX_REVERSED',
    ADD_LOAN:                'ADD_LOAN',
    ADD_LOAN_PAYMENT:        'ADD_LOAN_PAYMENT',
    CLOSE_LOAN:              'CLOSE_LOAN',
    ADD_PERIOD:              'ADD_PERIOD',
    UPDATE_PERIOD_STATUS:    'UPDATE_PERIOD_STATUS',
    APPEND_AUDIT_EVENT:      'APPEND_AUDIT_EVENT',
    APPEND_REVERSAL_ENTRY:   'APPEND_REVERSAL_ENTRY',
    UPDATE_JOURNAL:          'UPDATE_JOURNAL',
    RESTORE_STATE:           'RESTORE_STATE',
    SET_META_FIELD:          'SET_META_FIELD',
  });


  function _applyMutation(type, payload) {
    switch (type) {

      case MUTATIONS.INITIALIZE: {
        _state = Object.assign({}, _state, {
          initialized: true,
          coa:     _seedCOA(payload.coaOverride),
          periods: payload.periods || [],
        });
        _sourceIndex.clear();
        break;
      }

      case MUTATIONS.ADD_COA_ACCOUNT: {
        const { account } = payload;
        _state = Object.assign({}, _state, {
          coa: Object.assign({}, _state.coa, {
            [account.id]: Object.assign({}, account, { isActive: true, createdAt: account.createdAt || Date.now() })
          })
        });
        break;
      }

      case MUTATIONS.DEACTIVATE_COA_ACCOUNT: {
        const { accountId } = payload;
        const existing = _state.coa[accountId];
        if (!existing) break;
        _state = Object.assign({}, _state, {
          coa: Object.assign({}, _state.coa, {
            [accountId]: Object.assign({}, existing, { isActive: false })
          })
        });
        break;
      }

      case MUTATIONS.APPEND_JOURNAL: {
        const { journal } = payload;
        const frozenJournal = Object.freeze(Object.assign({}, journal, {
          entries: Object.freeze((journal.entries || []).map(function(e) { return Object.freeze(Object.assign({}, e)); }))
        }));
        _state = Object.assign({}, _state, {
          journals: _state.journals.concat([frozenJournal])
        });
        if (journal.sourceId && journal.status !== 'reversed') {
          _sourceIndex.add(journal.sourceId);
        }
        break;
      }

      case MUTATIONS.UPDATE_JOURNAL_STATUS: {
        const { journalId, status, reversedBy } = payload;
        _state = Object.assign({}, _state, {
          journals: _state.journals.map(j => {
            if (j.id !== journalId) return j;
            const updated = Object.assign({}, j, { status });
            if (reversedBy) updated.reversedBy = reversedBy;
            if (status === 'reversed' && j.sourceId) {
              _sourceIndex.delete(j.sourceId);
            }
            return Object.freeze(updated);
          })
        });
        break;
      }

      case MUTATIONS.APPEND_LEDGER_ENTRIES: {
        const { entries } = payload;
        _state = Object.assign({}, _state, {
          ledger: _state.ledger.concat(entries.map(e => Object.freeze(e)))
        });
        break;
      }

      case MUTATIONS.REPLACE_LEDGER: {
        const { entries } = payload;
        _state = Object.assign({}, _state, {
          ledger: entries.map(e => Object.freeze(e))
        });
        break;
      }

      case MUTATIONS.ADD_EXPENSE: {
        const { expense } = payload;
        _state = Object.assign({}, _state, {
          expenses: [Object.freeze(expense)].concat(_state.expenses)
        });
        break;
      }

      case MUTATIONS.UPDATE_EXPENSE_STATUS: {
        const { expenseId, status, journalId } = payload;
        _state = Object.assign({}, _state, {
          expenses: _state.expenses.map(e => {
            if (e.id !== expenseId) return e;
            const updated = Object.assign({}, e, { status });
            if (journalId) updated.journalId = journalId;
            return Object.freeze(updated);
          })
        });
        break;
      }

      case MUTATIONS.ADD_BANK_ACCOUNT: {
        const { bankAccount } = payload;
        _state = Object.assign({}, _state, {
          bankAccounts: _state.bankAccounts.concat([Object.freeze(bankAccount)])
        });
        break;
      }

      case MUTATIONS.ADD_BANK_TRANSACTION: {
        const { transaction } = payload;
        _state = Object.assign({}, _state, {
          bankTransactions: [Object.freeze(transaction)].concat(_state.bankTransactions)
        });
        break;
      }

      case MUTATIONS.RECONCILE_BANK_TX: {
        const { txId, reconciledAt } = payload;
        _state = Object.assign({}, _state, {
          bankTransactions: _state.bankTransactions.map(t => {
            if (t.id !== txId) return t;
            return Object.freeze(Object.assign({}, t, { reconciled: true, reconciledAt }));
          })
        });
        break;
      }

      case MUTATIONS.MARK_BANK_TX_REVERSED: {
        const { txId, reversalJournalId } = payload;
        _state = Object.assign({}, _state, {
          bankTransactions: _state.bankTransactions.map(t => {
            if (t.id !== txId) return t;
            return Object.freeze(Object.assign({}, t, { status: 'reversed', reversalJournalId }));
          })
        });
        break;
      }

      case MUTATIONS.ADD_LOAN: {
        const { loan } = payload;
        _state = Object.assign({}, _state, {
          loans: _state.loans.concat([Object.freeze(loan)])
        });
        break;
      }

      case MUTATIONS.ADD_LOAN_PAYMENT: {
        const { loanId, payment } = payload;
        _state = Object.assign({}, _state, {
          loans: _state.loans.map(l => {
            if (l.id !== loanId) return l;
            return Object.freeze(Object.assign({}, l, {
              payments: (l.payments || []).concat([Object.freeze(payment)])
            }));
          })
        });
        break;
      }

      case MUTATIONS.CLOSE_LOAN: {
        const { loanId, closedAt } = payload;
        _state = Object.assign({}, _state, {
          loans: _state.loans.map(l => {
            if (l.id !== loanId) return l;
            return Object.freeze(Object.assign({}, l, { status: 'closed', closedAt }));
          })
        });
        break;
      }

      case MUTATIONS.ADD_PERIOD: {
        const { period } = payload;
        _state = Object.assign({}, _state, {
          periods: _state.periods.concat([Object.freeze(period)])
        });
        break;
      }

      case MUTATIONS.UPDATE_PERIOD_STATUS: {
        const { periodId, status, closedAt, closedBy } = payload;
        _state = Object.assign({}, _state, {
          periods: _state.periods.map(p => {
            if (p.id !== periodId) return p;
            return Object.freeze(Object.assign({}, p, { status, closedAt, closedBy }));
          })
        });
        break;
      }

      case MUTATIONS.APPEND_AUDIT_EVENT: {
        const { event } = payload;
        _state = Object.assign({}, _state, {
          auditLog: _state.auditLog.concat([Object.freeze(event)])
        });
        break;
      }

      case MUTATIONS.RESTORE_STATE: {
        const { restoredState } = payload;
        const base = Object.assign({}, _createInitialState(), restoredState, { initialized: true });

        base.journals  = (base.journals  || []).map(function(j) {
          return Object.freeze(Object.assign({}, j, {
            entries: Object.freeze((j.entries || []).map(function(e) { return Object.freeze(Object.assign({}, e)); }))
          }));
        });
        base.ledger    = (base.ledger    || []).map(function(e) { return Object.freeze(e); });
        base.expenses  = (base.expenses  || []).map(function(e) { return Object.freeze(e); });
        base.bankTransactions = (base.bankTransactions || []).map(function(t) { return Object.freeze(t); });
        base.loans     = (base.loans     || []).map(function(l) { return Object.freeze(l); });
        base.periods   = (base.periods   || []).map(function(p) { return Object.freeze(p); });
        base.auditLog  = (base.auditLog  || []).map(function(a) { return Object.freeze(a); });
        base.reversalEntries = (base.reversalEntries || []).map(function(r) { return Object.freeze(r); });
        base.meta = Object.freeze(Object.assign({}, base.meta || {}));

        if (base.coa && typeof base.coa === 'object') {
          const frozenCoa = {};
          Object.keys(base.coa).forEach(function(k) { frozenCoa[k] = Object.freeze(base.coa[k]); });
          base.coa = frozenCoa;
        }

        if (DEFAULT_COA && Array.isArray(DEFAULT_COA)) {
          const mergedCoa = Object.assign({}, base.coa);
          let changed = false;
          DEFAULT_COA.forEach(function(acct) {
            if (acct.isSystem && !mergedCoa[acct.id]) {
              mergedCoa[acct.id] = Object.freeze(Object.assign({}, acct, { isActive: true, createdAt: Date.now() }));
              changed = true;
            }
          });
          if (changed) base.coa = mergedCoa;
        }

        _state = base;
        _sourceIndex = new Set();
        const _reversedJournalIds = new Set(
          (_state.reversalEntries || []).map(function(r) { return r.originalJournalId; })
        );
        (_state.journals || []).forEach(function(j) {
          if (j.sourceId && j.status !== 'reversed' && !_reversedJournalIds.has(j.id)) _sourceIndex.add(j.sourceId);
        });
        break;
      }

      case MUTATIONS.APPEND_REVERSAL_ENTRY: {
        const { entry } = payload;
        if (!entry) break;
        _state = Object.assign({}, _state, {
          reversalEntries: (_state.reversalEntries || []).concat([Object.freeze(entry)])
        });
        if (entry.originalJournalId) {
          const originalJournal = _state.journals.find(function (j) { return j.id === entry.originalJournalId; });
          if (originalJournal && originalJournal.sourceId) {
            _sourceIndex.delete(originalJournal.sourceId);
          }
        }
        break;
      }

      case MUTATIONS.UPDATE_JOURNAL: {
        const { updatedJournal } = payload;
        if (!updatedJournal || !updatedJournal.id) break;
        const frozen = Object.freeze(Object.assign({}, updatedJournal, {
          entries: Object.freeze((updatedJournal.entries || []).map(function(e) { return Object.freeze(Object.assign({}, e)); }))
        }));
        const oldJournal = _state.journals.find(function(j) { return j.id === updatedJournal.id; });
        _state = Object.assign({}, _state, {
          journals: _state.journals.map(function(j) {
            return j.id === updatedJournal.id ? frozen : j;
          })
        });
        if (oldJournal && oldJournal.sourceId) _sourceIndex.delete(oldJournal.sourceId);
        if (frozen.sourceId && frozen.status !== 'reversed') _sourceIndex.add(frozen.sourceId);
        break;
      }

      case MUTATIONS.SET_META_FIELD: {
        const { key, value } = payload;
        _state = Object.assign({}, _state, {
          meta: Object.assign({}, _state.meta, { [key]: value })
        });
        break;
      }

      default:
        throw new Error(`[AccountingState] Unknown mutation type: ${type}`);
    }

    return _state;
  }

  function _seedCOA(coaOverride) {
    const seed = coaOverride || DEFAULT_COA;
    const coa = {};
    if (!seed || !Array.isArray(seed)) return coa;
    seed.forEach(function(account) {
      coa[account.id] = Object.freeze(Object.assign({}, account, {
        isActive:  true,
        createdAt: Date.now(),
      }));
    });
    return coa;
  }

  function generateId(prefix) {
    const ts  = Date.now().toString(36).toUpperCase();
    let rnd   = '';
    if (typeof root !== 'undefined' && root.crypto && root.crypto.getRandomValues) {
      var arr = new Uint32Array(2);
      root.crypto.getRandomValues(arr);
      rnd = arr[0].toString(36).slice(0, 4) + arr[1].toString(36).slice(0, 2);
    } else {
      rnd = Math.random().toString(36).slice(2, 6);
    }
    return prefix + '-' + ts + '-' + rnd.toUpperCase();
  }


  function _journalInPeriod(journal, periodId) {
    if (!periodId) return true;
    const period = _state.periods.find(function(p) { return p.id === periodId; });
    if (!period) return false;
    if (period.startDate && journal.date < period.startDate) return false;
    if (period.endDate   && journal.date > period.endDate)   return false;
    return true;
  }

  function _flattenLedger() {
    const rows = [];
    _state.journals.forEach(function(journal) {
      (journal.entries || []).forEach(function(entry, idx) {
        rows.push({
          id:          journal.id + '-' + idx,
          journalId:   journal.id,
          date:        journal.date,
          accountId:   entry.accountId,
          debit:       entry.debit  || 0,
          credit:      entry.credit || 0,
          description: entry.description || '',
          periodId:    journal.periodId || null,
          postedAt:    journal.timestamp || journal.createdAt || null,
        });
      });
    });
    return rows;
  }

  function getAccountBalance(accountId, periodId) {
    const account = _state.coa[accountId];
    if (!account) return 0;

    const type = account.type;
    const isDebitNormal = (type === 'asset' || type === 'expense' || type === 'contra-revenue');

    var debitSum  = 0;
    var creditSum = 0;
    _state.journals.forEach(function(journal) {
      if (!_journalInPeriod(journal, periodId)) return;
      (journal.entries || []).forEach(function(entry) {
        if (entry.accountId !== accountId) return;
        debitSum  += entry.debit  || 0;
        creditSum += entry.credit || 0;
      });
    });

    return isDebitNormal ? (debitSum - creditSum) : (creditSum - debitSum);
  }

  function getTrialBalance(periodId) {
    const accountTotals = {};

    _state.journals.forEach(function(journal) {
      if (!_journalInPeriod(journal, periodId)) return;
      (journal.entries || []).forEach(function(entry) {
        if (!accountTotals[entry.accountId]) {
          accountTotals[entry.accountId] = { totalDebit: 0, totalCredit: 0 };
        }
        accountTotals[entry.accountId].totalDebit  += entry.debit  || 0;
        accountTotals[entry.accountId].totalCredit += entry.credit || 0;
      });
    });

    return Object.keys(accountTotals).map(function(accountId) {
      const account = _state.coa[accountId] || { code: '????', name: accountId, type: 'unknown' };
      const totals  = accountTotals[accountId];
      const isDebitNormal = account.type === 'asset' || account.type === 'expense' || account.type === 'contra-revenue';
      return {
        accountId,
        code:        account.code,
        name:        account.name,
        type:        account.type,
        totalDebit:  totals.totalDebit,
        totalCredit: totals.totalCredit,
        balance:     isDebitNormal
                       ? (totals.totalDebit - totals.totalCredit)
                       : (totals.totalCredit - totals.totalDebit)
      };
    }).sort(function(a, b) {
      return a.code < b.code ? -1 : 1;
    });
  }

  function isLedgerBalanced(periodId) {
    const tb         = getTrialBalance(periodId);
    const totalDebit = tb.reduce(function(s, r) { return s + r.totalDebit;  }, 0);
    const totalCredit= tb.reduce(function(s, r) { return s + r.totalCredit; }, 0);
    return {
      balanced:    totalDebit === totalCredit,
      difference:  Math.abs(totalDebit - totalCredit),
      totalDebit,
      totalCredit
    };
  }

  function getPartyLedger(partyName) {
    if (!partyName || typeof partyName !== 'string') return [];
    const normalized = partyName.toLowerCase().trim();
    const partyJournals = _state.journals
      .filter(function(j) {
        if (!j || typeof j !== 'object') return false;
        var party = ((j.party || j.counterparty || j.customer || '')).toLowerCase().trim();
        return party === normalized;
      })
      .sort(function(a, b) { return a.date < b.date ? -1 : 1; });

    let runningBalance = 0;
    return partyJournals.map(function(j) {
      const arEntries = (j.entries || []).filter(function(e) {
        return e.accountId === ACC.SYSTEM_ACCOUNTS.AR;
      });
      const arDelta = arEntries.reduce(function(s, e) {
        return s + (e.debit || 0) - (e.credit || 0);
      }, 0);
      runningBalance += arDelta;
      return Object.assign({}, j, { runningBalance });
    });
  }

  function getCurrentPeriod() {
    return _state.periods.find(function(p) {
      return p.status === PERIOD_STATUS.OPEN;
    }) || null;
  }

  function getLoanOutstandingBalance(loanId) {
    const loan = _state.loans.find(function(l) { return l.id === loanId; });
    if (!loan) return 0;
    const totalPrincipalPaid = (loan.payments || []).reduce(function(s, p) {
      return s + (p.principalPaisa || 0);
    }, 0);
    return (loan.principalPaisa || 0) - totalPrincipalPaid;
  }

  const AccountingState = {

    initialize(coaOverride) {
      if (_state.initialized) {
        console.warn('[AccountingState] Already initialized.');
        return;
      }
      _applyMutation(MUTATIONS.INITIALIZE, { coaOverride });
    },

    restoreFromPersistence(restoredState) {
      _applyMutation(MUTATIONS.RESTORE_STATE, { restoredState });
    },

    reset() {
      _state = _createInitialState();
      _sourceIndex.clear();
    },

    addCOAAccount(account) {
      if (!account || typeof account !== 'object') throw new Error('[AccountingState] account must be an object');
      if (!account.id || !account.code) throw new Error('[AccountingState] account.id and account.code are required');
      if (_state.coa[account.id]) throw new Error('[AccountingState] COA account ' + account.id + ' already exists');
      _applyMutation(MUTATIONS.ADD_COA_ACCOUNT, { account });
    },

    deactivateCOAAccount(accountId) {
      _applyMutation(MUTATIONS.DEACTIVATE_COA_ACCOUNT, { accountId });
    },

    getCOAAccount(accountId) {
      return _state.coa[accountId] || null;
    },

    getCoaMap() {
      return _state.coa;
    },

    getCOAByCode(code) {
      if (!code) return null;
      const accounts = Object.values(_state.coa);
      for (var i = 0; i < accounts.length; i++) {
        if (accounts[i].code === code) return accounts[i];
      }
      return null;
    },

    getAllCOAAccounts() {
      return Object.values(_state.coa).filter(function(a) { return a.isActive !== false; });
    },

    appendJournal(journal) {
      _applyMutation(MUTATIONS.APPEND_JOURNAL, { journal });
    },

    updateJournalStatus(journalId, status, reversedBy) {
      _applyMutation(MUTATIONS.UPDATE_JOURNAL_STATUS, { journalId, status, reversedBy });
    },

    getJournalById(journalId) {
      return _state.journals.find(function(j) { return j.id === journalId; }) || null;
    },

    journalExistsForSource(sourceId) {
      return _sourceIndex.has(sourceId);
    },

    journalExistsForDocument(documentId) {
      if (!documentId) return false;
      return _state.journals.some(function(j) {
        return j && (j.documentId === documentId || j.sourceId === documentId || j.reference === documentId);
      });
    },

    appendReversalEntry(entry) {
      if (!entry) return;
      _applyMutation(MUTATIONS.APPEND_REVERSAL_ENTRY, { entry });
    },

    isJournalReversed(journalId) {
      if (!journalId) return false;
      if (!_state.reversalEntries) return false;
      return _state.reversalEntries.some(function(r) { return r.originalJournalId === journalId; });
    },

    getAllReversalEntries() {
      return (_state.reversalEntries || []).slice();
    },

    updateJournal(updatedJournal) {
      if (!updatedJournal || !updatedJournal.id) return;
      _applyMutation(MUTATIONS.UPDATE_JOURNAL, { updatedJournal });
    },

    getJournalsBySource(sourceModule, sourceId) {
      return _state.journals.filter(function(j) {
        return j.sourceModule === sourceModule && j.sourceId === sourceId;
      });
    },

    getJournalsByDocument(documentId) {
      if (!documentId) return [];
      return _state.journals.filter(function(j) { return j.documentId === documentId; });
    },

    getAllJournals() {
      return _state.journals.slice();
    },

    appendLedgerEntries(entries) {
      _applyMutation(MUTATIONS.APPEND_LEDGER_ENTRIES, { entries });
    },

    replaceLedger(entries) {
      _applyMutation(MUTATIONS.REPLACE_LEDGER, { entries });
    },

    getAllLedgerEntries() {
      return _state.ledger.length ? _state.ledger.slice() : _flattenLedger();
    },

    getLedger() {
      return _state.ledger.length ? _state.ledger.slice() : _flattenLedger();
    },

    addExpense(expense) {
      _applyMutation(MUTATIONS.ADD_EXPENSE, { expense });
    },

    updateExpenseStatus(expenseId, status, journalId) {
      _applyMutation(MUTATIONS.UPDATE_EXPENSE_STATUS, { expenseId, status, journalId });
    },

    getExpenseById(expenseId) {
      return _state.expenses.find(function(e) { return e.id === expenseId; }) || null;
    },

    getAllExpenses() {
      return _state.expenses.slice();
    },

    addBankAccount(bankAccount) {
      _applyMutation(MUTATIONS.ADD_BANK_ACCOUNT, { bankAccount });
    },

    addBankTransaction(transaction) {
      _applyMutation(MUTATIONS.ADD_BANK_TRANSACTION, { transaction });
    },

    reconcileBankTransaction(txId, reconciledAt) {
      _applyMutation(MUTATIONS.RECONCILE_BANK_TX, { txId, reconciledAt });
    },

    markBankTransactionReversed(txId, reversalJournalId) {
      _applyMutation(MUTATIONS.MARK_BANK_TX_REVERSED, { txId, reversalJournalId });
    },

    getBankAccountById(bankAccountId) {
      return _state.bankAccounts.find(function(a) { return a.id === bankAccountId; }) || null;
    },

    getAllBankAccounts() {
      return _state.bankAccounts.filter(function(a) { return a.isActive !== false; });
    },

    getAllBankTransactions() {
      return _state.bankTransactions.slice();
    },

    addLoan(loan) {
      _applyMutation(MUTATIONS.ADD_LOAN, { loan });
    },

    addLoanPayment(loanId, payment) {
      _applyMutation(MUTATIONS.ADD_LOAN_PAYMENT, { loanId, payment });
    },

    closeLoan(loanId, closedAt) {
      _applyMutation(MUTATIONS.CLOSE_LOAN, { loanId, closedAt });
    },

    getLoanById(loanId) {
      return _state.loans.find(function(l) { return l.id === loanId; }) || null;
    },

    getAllLoans() {
      return _state.loans.slice();
    },

    addPeriod(period) {
      _applyMutation(MUTATIONS.ADD_PERIOD, { period });
    },

    updatePeriodStatus(periodId, status, closedAt, closedBy) {
      _applyMutation(MUTATIONS.UPDATE_PERIOD_STATUS, { periodId, status, closedAt, closedBy });
    },

    getPeriodById(periodId) {
      return _state.periods.find(function(p) { return p.id === periodId; }) || null;
    },

    getAllPeriods() {
      return _state.periods.slice();
    },

    appendAuditEvent(event) {
      _applyMutation(MUTATIONS.APPEND_AUDIT_EVENT, { event });
    },

    getAuditLog() {
      return _state.auditLog.slice();
    },

    getAccountBalance,
    getTrialBalance,
    isLedgerBalanced,
    getPartyLedger,
    getCurrentPeriod,
    getLoanOutstandingBalance,

    captureSnapshot() {
      try {
        const snap = JSON.parse(JSON.stringify(_state));
        snap._sourceIndexArray = Array.from(_sourceIndex);
        return snap;
      } catch (e) {
        console.error('[AccountingState] captureSnapshot failed:', e);
        return null;
      }
    },

    restoreFromSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('[AccountingState] restoreFromSnapshot requires a valid snapshot object');
      }
      try {
        const { _sourceIndexArray } = snapshot;
        const cleanSnap = JSON.parse(JSON.stringify(snapshot));
        delete cleanSnap._sourceIndexArray;
        _state = cleanSnap;
        _sourceIndex = new Set(_sourceIndexArray || []);
      } catch (e) {
        console.error('[AccountingState] restoreFromSnapshot failed:', e);
        throw e;
      }
    },

    getMeta() {
      return _state.meta || {};
    },

    setMetaField(key, value) {
      if (!key || typeof key !== 'string') throw new Error('[AccountingState] meta key must be a non-empty string');
      _applyMutation(MUTATIONS.SET_META_FIELD, { key, value });
    },

    isInitialized() { return _state.initialized; },

    getSchemaVersion() { return _state.schemaVersion; },

    generateId,

    MUTATIONS,
  };

  ACC.AccountingState = AccountingState;

})(typeof window !== 'undefined' && window !== null ? window : globalThis);
