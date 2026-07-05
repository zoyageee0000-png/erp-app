
'use strict';

(function(root) {
  'use strict';

  const ACC = root.AccountingCore;
  if (!ACC) throw new Error('[LoanService] AccountingCore namespace missing.');

  const {
    AccountingState,
    AccountingStore,
    AccountingEvents,
    JournalService,
    Money,
    ACCOUNTING_EVENTS,
    SOURCE_MODULE,
    SYSTEM_ACCOUNTS,
    IDB_STORES,
  } = ACC;
  
  function calculateEMIPaisa(principalPaisa, annualRatePercent, tenureMonths) {
    Money._assertPaisa(principalPaisa);
    if (principalPaisa <= 0) throw new Error('[LoanService] Principal must be positive.');
    if (typeof annualRatePercent !== 'number' || Number.isNaN(annualRatePercent) || annualRatePercent < 0) {
      throw new Error('[LoanService] Interest rate must be a non-negative number.');
    }
    if (tenureMonths <= 0 || !Number.isInteger(tenureMonths)) throw new Error('[LoanService] Tenure must be a positive integer.');

    if (annualRatePercent === 0) {
      return Math.round(principalPaisa / tenureMonths);
    }

    const monthlyRate = annualRatePercent / 12 / 100;
    const compFactor  = Math.pow(1 + monthlyRate, tenureMonths);
    const emiFloat    = principalPaisa * monthlyRate * compFactor / (compFactor - 1);
    return Math.round(emiFloat);
  }
  
  function generateAmortizationSchedule(principalPaisa, annualRatePercent, tenureMonths, startDate, repaymentType) {
    Money._assertPaisa(principalPaisa);
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error('[LoanService] Valid startDate (YYYY-MM-DD) is required to generate an amortization schedule.');
    }
    if (typeof annualRatePercent !== 'number' || Number.isNaN(annualRatePercent) || annualRatePercent < 0) {
      throw new Error('[LoanService] Interest rate must be a non-negative number.');
    }
    if (tenureMonths <= 0 || !Number.isInteger(tenureMonths)) {
      throw new Error('[LoanService] Tenure must be a positive integer.');
    }

    const type = repaymentType === 'flat' ? 'flat' : 'emi';
    const schedule = [];
    const startMoment = new Date(startDate + 'T00:00:00Z');

    function pushEntry(month, openingBalance, interestPmt, principalPmt, closingBalance) {
      const dueDate = new Date(startMoment);
      dueDate.setUTCMonth(dueDate.getUTCMonth() + month);
      schedule.push({
        month:               month,
        dueDate:             dueDate.toISOString().split('T')[0],
        openingBalancePaisa: openingBalance,
        emiPaisa:            interestPmt + principalPmt,
        interestPaisa:       interestPmt,
        principalPaisa:      principalPmt,
        closingBalancePaisa: closingBalance,
      });
    }

    if (type === 'flat') {
      const totalInterestPaisa = Math.round(principalPaisa * (annualRatePercent / 100) * (tenureMonths / 12));
      const principalPerMonth  = Math.round(principalPaisa / tenureMonths);
      const interestPerMonth   = Math.round(totalInterestPaisa / tenureMonths);

      let balance      = principalPaisa;
      let interestPaid = 0;

      for (let month = 1; month <= tenureMonths; month++) {
        const isLast       = month === tenureMonths;
        const principalPmt = isLast ? balance : Math.min(principalPerMonth, balance);
        const interestPmt  = isLast ? Math.max(0, totalInterestPaisa - interestPaid) : interestPerMonth;
        const closingBalance = Math.max(0, balance - principalPmt);

        pushEntry(month, balance, interestPmt, principalPmt, closingBalance);

        interestPaid += interestPmt;
        balance = closingBalance;
        if (balance <= 0) break;
      }

      return schedule;
    }

    const emiPaisa    = calculateEMIPaisa(principalPaisa, annualRatePercent, tenureMonths);
    const monthlyRate = annualRatePercent / 12 / 100;

    let balance = principalPaisa;

    for (let month = 1; month <= tenureMonths; month++) {
      const isLast      = month === tenureMonths;
      const interestPmt = annualRatePercent > 0 ? Math.round(balance * monthlyRate) : 0;
      let principalPmt  = isLast ? balance : (emiPaisa - interestPmt);
      if (principalPmt > balance) principalPmt = balance;
      if (principalPmt < 0) principalPmt = 0;
      const closingBalance = Math.max(0, balance - principalPmt);

      pushEntry(month, balance, interestPmt, principalPmt, closingBalance);

      balance = closingBalance;
      if (balance <= 0) break;
    }

    return schedule;
  }

  function _generateLoanId() {
    // FIX (root cause, audit #61-62): was an independent Date.now()+Math.random()
    // scheme; route through the one canonical, collision-safe generator.
    return 'LOAN-' + ERP.uid();
  }

  function _generatePaymentId() {
    return 'LPAY-' + ERP.uid(); // FIX (root cause, audit #61-62): route through the one canonical generator.
  }

  function _generateAuditId() {
    return 'EVT-' + ERP.uid(); // FIX (root cause, audit #61-62): route through the one canonical generator.
  }

  function _validateLoanData(data) {
    if (typeof data.lenderName !== 'string' || !data.lenderName.trim()) {
      throw new Error('[LoanService] Lender name is required.');
    }
    if (!Number.isInteger(data.principalPaisa) || data.principalPaisa <= 0) {
      throw new Error(`[LoanService] principalPaisa must be a positive integer paisa. Got: ${data.principalPaisa}.`);
    }
    if (typeof data.annualRatePercent !== 'number' || Number.isNaN(data.annualRatePercent) || data.annualRatePercent < 0) {
      throw new Error('[LoanService] annualRatePercent must be a non-negative number.');
    }
    if (!Number.isInteger(data.tenureMonths) || data.tenureMonths <= 0) {
      throw new Error('[LoanService] tenureMonths must be a positive integer.');
    }
    if (!data.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) {
      throw new Error('[LoanService] Valid startDate (YYYY-MM-DD) is required.');
    }
    if (data.repaymentType && data.repaymentType !== 'emi' && data.repaymentType !== 'flat') {
      throw new Error('[LoanService] repaymentType must be "emi" or "flat".');
    }
    if (data.emiPaisa !== undefined && data.emiPaisa !== null) {
      if (!Number.isInteger(data.emiPaisa) || data.emiPaisa <= 0) {
        throw new Error(`[LoanService] emiPaisa must be a positive integer paisa. Got: ${data.emiPaisa}.`);
      }
    }
  }
  
  async function createLoan(data, actor) {
    actor = actor || 'system';

    _validateLoanData(data);

    const loanId    = _generateLoanId();
    const now       = Date.now();
    const repaymentType = data.repaymentType === 'flat' ? 'flat' : 'emi';
    const schedule = generateAmortizationSchedule(
      data.principalPaisa, data.annualRatePercent, data.tenureMonths, data.startDate, repaymentType
    );
    const emiPaisa  = data.emiPaisa || (schedule.length ? schedule[0].emiPaisa : calculateEMIPaisa(data.principalPaisa, data.annualRatePercent, data.tenureMonths));
    const disbAccId = data.disbursementAccountId || SYSTEM_ACCOUNTS.BANK;

    if (!AccountingState.getCOAAccount(disbAccId)) {
      throw new Error(`[LoanService] Disbursement account "${disbAccId}" not found.`);
    }
    if (!AccountingState.getCOAAccount(SYSTEM_ACCOUNTS.BANK_LOANS)) {
      throw new Error('[LoanService] Bank Loans account not found in COA. Ensure COA is initialized.');
    }

    const loan = Object.freeze({
      id:                  loanId,
      lenderName:          data.lenderName.trim(),
      principalPaisa:      data.principalPaisa,
      annualRatePercent:   data.annualRatePercent,
      tenureMonths:        data.tenureMonths,
      repaymentType:       repaymentType,
      emiPaisa:            emiPaisa,
      startDate:           data.startDate,
      disbursementAccountId: disbAccId,
      status:              'active',
      notes:               data.notes || '',
      schedule,
      payments:            [],
      journalId:           null,
      createdAt:           now,
      createdBy:           actor,
    });

    const journal = await JournalService.post({
      date:         data.startDate,
      reference:    loanId,
      sourceModule: SOURCE_MODULE.LOANS,
      sourceId:     `DISBURSE-${loanId}`,
      memo:         `Loan from ${data.lenderName.trim()} — ${Money.toDisplay(data.principalPaisa)}`,
      entries: [
        {
          accountId:   disbAccId,
          debit:       data.principalPaisa,
          credit:      0,
          description: `Loan disbursement from ${data.lenderName.trim()}`,
        },
        {
          accountId:   SYSTEM_ACCOUNTS.BANK_LOANS,
          debit:       0,
          credit:      data.principalPaisa,
          description: `Loan payable — ${data.lenderName.trim()}`,
        },
      ],
    }, actor);

    const finalLoan = Object.freeze(Object.assign({}, loan, { journalId: journal.id }));

    await AccountingStore.putOne(IDB_STORES.LOANS, finalLoan);
    AccountingState.addLoan(finalLoan);

    const auditEvent = {
      id:            _generateAuditId(),
      eventType:     ACCOUNTING_EVENTS.LOAN_CREATED,
      entityType:    'loan',
      entityId:      loanId,
      timestamp:     now,
      actor,
      correlationId: loanId,
      payload:       { lenderName: data.lenderName, principalPaisa: data.principalPaisa, journalId: journal.id },
    };
    await AccountingStore.putOne(IDB_STORES.AUDIT_LOG, auditEvent);
    AccountingState.appendAuditEvent(auditEvent);

    AccountingEvents.emitAsync(ACCOUNTING_EVENTS.LOAN_CREATED, {
      loanId,
      journalId:      journal.id,
      principalPaisa: data.principalPaisa,
      lenderName:     data.lenderName,
    });

    return finalLoan;
  }
  
  async function recordPayment(data, actor) {
    actor = actor || 'system';

    const loan = AccountingState.getLoanById(data.loanId);
    if (!loan) throw new Error(`[LoanService] Loan not found: ${data.loanId}`);
    if (loan.status === 'closed') throw new Error(`[LoanService] Loan ${data.loanId} is already closed.`);

    if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw new Error('[LoanService] Valid payment date (YYYY-MM-DD) is required.');
    }
    if (!Number.isInteger(data.totalPaisa) || data.totalPaisa <= 0) {
      throw new Error(`[LoanService] totalPaisa must be a positive integer paisa. Got: ${data.totalPaisa}.`);
    }
    if (data.principalPaisa !== undefined && (!Number.isInteger(data.principalPaisa) || data.principalPaisa < 0)) {
      throw new Error(`[LoanService] principalPaisa override must be a non-negative integer paisa. Got: ${data.principalPaisa}.`);
    }
    if (data.interestPaisa !== undefined && (!Number.isInteger(data.interestPaisa) || data.interestPaisa < 0)) {
      throw new Error(`[LoanService] interestPaisa override must be a non-negative integer paisa. Got: ${data.interestPaisa}.`);
    }

    const outstandingBalance = AccountingState.getLoanOutstandingBalance(data.loanId);
    let defaultInterestPaisa;
    if (loan.repaymentType === 'flat') {
      const nextScheduleEntry = (loan.schedule || [])[loan.payments ? loan.payments.length : 0];
      defaultInterestPaisa = nextScheduleEntry ? nextScheduleEntry.interestPaisa : 0;
    } else {
      const monthlyRate = loan.annualRatePercent / 12 / 100;
      defaultInterestPaisa = loan.annualRatePercent > 0 ? Math.round(outstandingBalance * monthlyRate) : 0;
    }
    const interestPaisa      = data.interestPaisa !== undefined
      ? data.interestPaisa
      : defaultInterestPaisa;
    const principalPaisa     = data.principalPaisa !== undefined
      ? data.principalPaisa
      : (data.totalPaisa - interestPaisa);

    if (principalPaisa < 0) {
      throw new Error('[LoanService] Principal portion cannot be negative. Check interest calculation.');
    }
    if (principalPaisa + interestPaisa !== data.totalPaisa) {
      throw new Error(
        `[LoanService] principal (${principalPaisa}) + interest (${interestPaisa}) must equal total (${data.totalPaisa}).`
      );
    }

    const paymentId   = _generatePaymentId();
    const now         = Date.now();
    const paymentAccId = (typeof data.paymentMethod === 'string' && data.paymentMethod.toLowerCase().includes('bank'))
      ? SYSTEM_ACCOUNTS.BANK
      : SYSTEM_ACCOUNTS.CASH;

    const journalEntries = [];

    if (principalPaisa > 0) {
      journalEntries.push({
        accountId:   SYSTEM_ACCOUNTS.BANK_LOANS,
        debit:       principalPaisa,
        credit:      0,
        description: `Loan principal repayment — ${loan.lenderName}`,
      });
    }

    if (interestPaisa > 0) {
      journalEntries.push({
        accountId:   SYSTEM_ACCOUNTS.LOAN_INT,
        debit:       interestPaisa,
        credit:      0,
        description: `Loan interest expense — ${loan.lenderName}`,
      });
    }

    journalEntries.push({
      accountId:   paymentAccId,
      debit:       0,
      credit:      data.totalPaisa,
      description: `Loan EMI payment — ${loan.lenderName}`,
    });

    const journal = await JournalService.post({
      date:         data.date,
      reference:    paymentId,
      sourceModule: SOURCE_MODULE.LOANS,
      sourceId:     paymentId,
      memo:         `EMI payment — ${loan.lenderName} | ${Money.toDisplay(data.totalPaisa)}`,
      entries:      journalEntries,
    }, actor);

    const payment = Object.freeze({
      id:              paymentId,
      date:            data.date,
      totalPaisa:      data.totalPaisa,
      principalPaisa:  principalPaisa,
      interestPaisa:   interestPaisa,
      paymentMethod:   data.paymentMethod || 'Cash',
      notes:           data.notes || '',
      journalId:       journal.id,
      createdAt:       now,
    });

    await AccountingStore.putOne(
      IDB_STORES.LOANS,
      Object.assign({}, loan, {
        payments: (loan.payments || []).concat([payment])
      })
    );

    AccountingState.addLoanPayment(data.loanId, payment);

    const newOutstanding = AccountingState.getLoanOutstandingBalance(data.loanId);
    if (newOutstanding <= 0) {
      const closedAt = Date.now();
      AccountingState.closeLoan(data.loanId, closedAt);

      const closedLoan = AccountingState.getLoanById(data.loanId);
      if (closedLoan) {
        await AccountingStore.putOne(IDB_STORES.LOANS,
          Object.assign({}, closedLoan, { status: 'closed', closedAt })
        );
      }

      AccountingEvents.emitAsync(ACCOUNTING_EVENTS.LOAN_CLOSED, { loanId: data.loanId });
    }

    const auditEvent = {
      id:            _generateAuditId(),
      eventType:     ACCOUNTING_EVENTS.LOAN_PAYMENT_POSTED,
      entityType:    'loan',
      entityId:      data.loanId,
      timestamp:     now,
      actor,
      correlationId: data.loanId,
      payload:       { paymentId, totalPaisa: data.totalPaisa, principalPaisa, interestPaisa, journalId: journal.id },
    };
    await AccountingStore.putOne(IDB_STORES.AUDIT_LOG, auditEvent);
    AccountingState.appendAuditEvent(auditEvent);

    AccountingEvents.emitAsync(ACCOUNTING_EVENTS.LOAN_PAYMENT_POSTED, {
      loanId:        data.loanId,
      paymentId,
      journalId:     journal.id,
      totalPaisa:    data.totalPaisa,
      principalPaisa,
      interestPaisa,
    });

    return { payment, journal };
  }

  function getAllLoans() { return AccountingState.getAllLoans(); }

  function getActiveLoans() {
    return AccountingState.getAllLoans().filter(function(l) { return l.status === 'active'; });
  }

  function getTotalLiabilityPaisa() {
    return AccountingState.getAllLoans()
      .filter(function(l) { return l.status === 'active'; })
      .reduce(function(sum, l) {
        return sum + AccountingState.getLoanOutstandingBalance(l.id);
      }, 0);
  }

  function getLoanStatement(loanId) {
    const loan = AccountingState.getLoanById(loanId);
    if (!loan) return null;
    const outstanding = AccountingState.getLoanOutstandingBalance(loanId);
    return Object.assign({}, loan, {
      outstandingPaisa:   outstanding,
      outstandingDisplay: Money.toDisplay(outstanding),
    });
  }

  const LoanService = {
    calculateEMIPaisa,
    generateAmortizationSchedule,
    createLoan,
    recordPayment,
    getAllLoans,
    getActiveLoans,
    getTotalLiabilityPaisa,
    getLoanStatement,
  };

  ACC.LoanService = LoanService;

})(typeof window !== 'undefined' ? window : globalThis);
