'use strict';
const { describe, it, assert } = require('./helpers/runner');
const { createSandbox, loadFiles } = require('./helpers/sandbox');

function loginAs(sandbox, role) {
  sandbox.window.ERP.setState(function (s) {
    s.session = { loggedIn: true, user: { name: 'Test User', role: role } };
  });
}

describe('RBAC — ERP.permissions.canDo() (core.js + init.js, real files)', () => {
  const ROLES = ['Admin', 'Manager', 'Cashier', 'Receptionist', 'Mechanic', 'Sales', 'Viewer'];
  const ACTIONS = ['deleteJob', 'voidPayment', 'issueCreditReturn', 'deleteVehicle', 'deleteAppointment'];

  it('only Admin can perform all 5 destructive actions; every other real role is denied', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js', 'init.js']);
    const ERP = sandbox.window.ERP;
    const rbac = ERP.RBAC || {};
    const realRoles = Object.keys(rbac); // don't assume the role list, read it

    for (const role of realRoles) {
      loginAs(sandbox, role);
      for (const action of ACTIONS) {
        const allowed = ERP.permissions.canDo(action);
        if (role === 'Admin') {
          assert.strictEqual(allowed, true, `Admin should be allowed to ${action}`);
        } else {
          assert.strictEqual(allowed, false, `${role} should NOT be allowed to ${action}`);
        }
      }
    }
  });

  it('canDo() fails closed when nobody is logged in', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js', 'init.js']);
    const ERP = sandbox.window.ERP;
    for (const action of ACTIONS) {
      assert.strictEqual(ERP.permissions.canDo(action), false,
        `canDo('${action}') must be false with no session`);
    }
  });

  it('deleteVehicle / deleteAppointment / voidPayment / issueCreditReturn are registered as Admin-only actions in core.js', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js']);
    const RBAC = sandbox.window.ERP.RBAC;
    for (const action of ['deleteVehicle', 'deleteAppointment', 'voidPayment', 'issueCreditReturn']) {
      assert.ok(RBAC.Admin.actions[action], `RBAC.Admin.actions.${action} must be truthy`);
    }
  });
});

describe('RBAC regression lock — service-layer gating survives even if the UI bypasses the window.* wrapper', () => {
  // This is the exact bug found this session: vehicle_ui.js / appointment_ui.js
  // call VehicleService.deleteVehicle()/AppointmentService.deleteAppointment()
  // DIRECTLY, never going through window.deleteVehicle's _requireAuth wrapper
  // in module_init.js. So the only thing that can actually protect these two
  // functions is a check *inside the service itself*. This test calls the
  // service function directly — the same way the real UI does — and proves
  // the fix holds at that exact entry point, not just at the wrapper.

  // vehicle_service.js / appointment_service.js's _authBlocked() checks
  // window.ERP.Auth.isAuthenticated() (a real module, not RBAC itself — that's
  // auth.js's job, tested separately). We stub Auth here, wired to the exact
  // same ERP.getState().session that ERP.permissions.canDo() already reads,
  // so this test exercises the real RBAC decision (canDo) end to end while
  // not depending on auth.js's PBKDF2/lockout machinery, which is out of
  // scope for an authorization test.
  function installAuthStub(sandbox) {
    sandbox.window.ERP.Auth = {
      isAuthenticated: function () {
        const s = sandbox.window.ERP.getState().session;
        return !!(s && s.loggedIn && s.user);
      }
    };
  }

  function buildSandboxForVehicle() {
    const sandbox = createSandbox();
    // Minimal EventBus double: enough surface for VehicleService.init to run.
    sandbox.window.EventBus = {
      EVENTS: {},
      on: () => {}, off: () => {}, emit: () => {}
    };
    sandbox.window.VehicleState = {
      init: () => {},
      getVehicles: () => [{ plate: 'ABC-123', make: 'Test' }],
      deleteVehicle: () => true,
      updateVehicle: () => {}
    };
    loadFiles(sandbox, ['core.js', 'init.js']);
    installAuthStub(sandbox);
    loadFiles(sandbox, ['vehicle_service.js']);
    sandbox.window.confirm = () => true; // auto-confirm the delete dialog
    sandbox.window.VehicleService.init(
      sandbox.window.VehicleState, { schedule: () => {} }, sandbox.window.EventBus, {}
    );
    return sandbox;
  }

  function buildSandboxForAppointment() {
    const sandbox = createSandbox();
    sandbox.window.EventBus = {
      EVENTS: {},
      on: () => {}, off: () => {}, emit: () => {}
    };
    sandbox.window.AppointmentState = {
      init: () => {},
      getAppointments: () => [{ id: 'appt-1' }],
      deleteAppt: () => true,
      findAppt: () => ({ id: 'appt-1' })
    };
    loadFiles(sandbox, ['core.js', 'init.js']);
    installAuthStub(sandbox);
    loadFiles(sandbox, ['appointment_service.js']);
    sandbox.window.confirm = () => true;
    sandbox.window.AppointmentService.init(
      sandbox.window.AppointmentState, { schedule: () => {} }, sandbox.window.EventBus, {}
    );
    return sandbox;
  }

  it('VehicleService.deleteVehicle() blocks an unauthenticated caller at the service layer itself', () => {
    const sandbox = buildSandboxForVehicle();
    const VehicleService = sandbox.window.VehicleService;
    assert.ok(VehicleService && typeof VehicleService.deleteVehicle === 'function',
      'VehicleService.deleteVehicle must exist');
    // No login performed — session.loggedIn stays false.
    let threwOrBlocked = false;
    let deleted = false;
    const origRemove = sandbox.window.VehicleState.deleteVehicle;
    sandbox.window.VehicleState.deleteVehicle = () => { deleted = true; };
    try {
      VehicleService.deleteVehicle('ABC-123');
    } catch (e) {
      threwOrBlocked = true;
    }
    sandbox.window.VehicleState.deleteVehicle = origRemove;
    assert.strictEqual(deleted, false,
      'deleteVehicle() must NOT delete when caller is unauthenticated (this was the live bug)');
  });

  it('AppointmentService.deleteAppointment() blocks an unauthenticated caller at the service layer itself', () => {
    const sandbox = buildSandboxForAppointment();
    const AppointmentService = sandbox.window.AppointmentService;
    assert.ok(AppointmentService && typeof AppointmentService.deleteAppointment === 'function',
      'AppointmentService.deleteAppointment must exist');
    let deleted = false;
    sandbox.window.AppointmentState.deleteAppt = () => { deleted = true; };
    AppointmentService.deleteAppointment('appt-1');
    assert.strictEqual(deleted, false,
      'deleteAppointment() must NOT delete when caller is unauthenticated (this was the live bug)');
  });

  it('VehicleService.deleteVehicle() allows a logged-in Admin', () => {
    const sandbox = buildSandboxForVehicle();
    loginAs(sandbox, 'Admin');
    let deleted = false;
    sandbox.window.VehicleState.deleteVehicle = () => { deleted = true; };
    sandbox.window.VehicleService.deleteVehicle('ABC-123');
    assert.strictEqual(deleted, true, 'Admin should be able to delete a vehicle');
  });

  it('VehicleService.deleteVehicle() blocks a logged-in non-Admin role (e.g. Mechanic)', () => {
    const sandbox = buildSandboxForVehicle();
    loginAs(sandbox, 'Mechanic');
    let deleted = false;
    sandbox.window.VehicleState.deleteVehicle = () => { deleted = true; };
    sandbox.window.VehicleService.deleteVehicle('ABC-123');
    assert.strictEqual(deleted, false, 'Non-Admin roles must not be able to delete a vehicle');
  });
});
