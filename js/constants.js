
const MH_CONSTANTS = Object.freeze({

  JOB_STATUS: Object.freeze({
    PENDING:       'pending',
    IN_PROGRESS:   'in-progress',
    WAITING_PARTS: 'waiting-parts',
    COMPLETED:     'completed',
    DELIVERED:     'delivered',
    CANCELLED:     'cancelled'
  }),

  INVOICE_STATUS: Object.freeze({
    DRAFT:    'draft',
    UNPAID:   'unpaid',
    PARTIAL:  'partial',
    PAID:     'paid',
    RETURNED: 'returned',
    VOIDED:   'voided'
  }),

  PURCHASE_STATUS: Object.freeze({
    DRAFT:      'draft',
    PENDING:    'pending',
    RECEIVED:   'received',
    PARTIAL:    'partial',
    PAID:       'paid',
    CANCELLED:  'cancelled'
  }),

  MOVEMENT_TYPE: Object.freeze({
    SALE:       'sale',
    PURCHASE:   'purchase',
    RETURN:     'return',
    ADJUSTMENT: 'adjustment',
    TRANSFER:   'transfer'
  }),

  JOB_STATUSES: Object.freeze([
    'pending',
    'in-progress',
    'waiting-parts',
    'completed',
    'delivered',
    'cancelled',
  ]),

  JOB_STATUS_CONF: Object.freeze({
    'pending':        { l: 'Pending',        cls: 'b-blue',   icon: 'ic-calendar' },
    'in-progress':    { l: 'In Progress',    cls: 'b-orange', icon: 'ic-tool' },
    'waiting-parts':  { l: 'Awaiting Parts', cls: 'b-purple', icon: 'ic-box' },
    'completed':      { l: 'Completed',      cls: 'b-green',  icon: 'ic-check' },
    'delivered':      { l: 'Delivered',      cls: 'b-gray',   icon: 'ic-car' },
    'cancelled':      { l: 'Cancelled',      cls: 'b-red',    icon: 'ic-x' },
  }),

  JOB_STATUS_TRANSITIONS: Object.freeze({
    'pending':       [],
    'in-progress':   [],
    'waiting-parts': [],
    'completed':     ['delivered'],
    'delivered':     [],
    'cancelled':     [],
  }),

  APPT_STATUSES: Object.freeze([
    'pending', 'in-progress', 'completed', 'cancelled',
  ]),

  APPT_STATUS_CONF: Object.freeze({
    'pending':     { l: 'Pending',     cls: 'b-blue',   icon: '🕐' },
    'in-progress': { l: 'In Progress', cls: 'b-orange', icon: '🔧' },
    'completed':   { l: 'Completed',   cls: 'b-green',  icon: '✅' },
    'cancelled':   { l: 'Cancelled',   cls: 'b-red',    icon: '✕'  },
  }),

  JOB_STAGES: Object.freeze([
    { key: 'received',    label: 'Received',      icon: '📥', color: 'var(--muted,#64748b)' },
    { key: 'diagnosed',   label: 'Diagnosed',     icon: '🔍', color: 'var(--info,#3b82f6)' },
    { key: 'parts-order', label: 'Parts Ordered', icon: '📦', color: 'var(--secondary,#f59e0b)' },
    { key: 'in-progress', label: 'In Progress',   icon: '🔧', color: '#8b5cf6' },
    { key: 'testing',     label: 'Testing',       icon: '🧪', color: '#06b6d4' },
    { key: 'ready',       label: 'Ready',         icon: '✅', color: 'var(--success,#22c55e)' },
    { key: 'delivered',   label: 'Delivered',     icon: '🚗', color: 'var(--primary,#1e3a5f)' },
  ]),

  PAYMENT_METHODS: Object.freeze([
    'Cash', 'Bank Transfer', 'JazzCash', 'EasyPaisa', 'Card',
  ]),

  STORAGE_KEYS: Object.freeze({
    MAIN:        'mh_erp_data',
    MINI:        'mh_erp_data_mini',
    VERSION:     'mh_dataVersion',
    TAB_ID:      'mh_dataTabId',
    AUDIT:       'mh_audit_log',
    CORRUPT_BCK: 'mh_erp_data_corrupt_backup',
  }),

  IDB_DB_NAME:   'MHAutosDB',
  IDB_VERSION:   9,

  MAX_PHOTO_SIZE:    800,
  MAX_CAPTION_LEN:   200,
  MAX_PROB_LEN:      500,
  DEBOUNCE_SAVE_MS:  400,
  IDB_SYNC_DELAY_MS: 5000,
  BC_THROTTLE_MS:    500,
});

(function _registerConstants() {
  var root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {});
  root.ERP = root.ERP || {};
  if (!root.ERP.CONSTANTS) {
    Object.defineProperty(root.ERP, 'CONSTANTS', {
      value:        MH_CONSTANTS,
      writable:     false,
      configurable: false,
      enumerable:   true,
    });
  }
}());
