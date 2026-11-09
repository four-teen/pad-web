import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function gateway(width = 1280, height = 900) {
  const elements = new Map();
  const events = {};
  const viewportEvents = {};
  let focused;
  let opened = 0;
  function byId(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const attributes = new Map();
      elements.set(id, { style: { setProperty(name, value) { this[name] = value; } },
        classList: { contains: name => classes.has(name), toggle(name, on) { on ? classes.add(name) : classes.delete(name); } },
        setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name),
        addEventListener(name, handler) { this[name] = handler; }, focus() { focused = id; }
      });
    }
    return elements.get(id);
  }
  const window = { innerWidth: width, innerHeight: height, addEventListener(name, handler) { events[name] = handler; },
    visualViewport: { height, scale: 1, addEventListener(name, handler) { viewportEvents[name] = handler; } } };
  const context = vm.createContext({ window });
  vm.runInContext(readFileSync(new URL('../src/login-gateway.js', import.meta.url), 'utf8').replace('export function', 'function'), context);
  const api = context.createLoginGateway({ byId, onOpen() { opened++; } });
  return { byId, api, window, events, viewportEvents, focused: () => focused, opened: () => opened };
}

test('the seal opens accessible sign-in and Escape or Cancel restores focus', () => {
  const app = gateway();
  const seal = app.byId('auth-seal-button');
  const access = app.byId('auth-access');
  assert.equal(access.inert, true);
  assert.equal(seal.getAttribute('aria-expanded'), 'false');
  seal.click();
  assert.equal(access.inert, false);
  assert.equal(seal.getAttribute('aria-expanded'), 'true');
  assert.equal(app.focused(), 'auth-access');
  assert.equal(app.opened(), 1);
  let prevented = false;
  app.byId('auth-gateway').keydown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(access.inert, true);
  assert.equal(app.focused(), 'auth-seal-button');
  seal.click();
  app.byId('auth-cancel').click();
  assert.equal(access.inert, true);
  assert.equal(app.focused(), 'auth-seal-button');
});

test('verification blocks duplicate access actions and cancellation until it finishes', () => {
  const app = gateway();
  app.api.setOpen(true);
  app.api.setBusy(true);
  app.byId('auth-cancel').click();
  app.byId('auth-seal-button').click();
  app.byId('auth-gateway').keydown({ key: 'Escape', preventDefault() { assert.fail('Busy Escape must do nothing'); } });
  assert.equal(app.byId('auth-access').inert, false);
  assert.equal(app.byId('google-signin').inert, true);
  assert.equal(app.byId('auth-cancel').disabled, true);
  assert.equal(app.byId('auth-access').getAttribute('aria-busy'), 'true');
  app.api.setBusy(false);
  app.byId('auth-cancel').click();
  assert.equal(app.byId('auth-access').inert, true);
  assert.equal(app.byId('google-signin').inert, false);
});

test('mobile resizing keeps the hidden seal out of keyboard navigation and follows the visual viewport', () => {
  const app = gateway(390, 844);
  app.api.setOpen(true);
  assert.equal(app.byId('auth-seal-button').tabIndex, -1);
  app.window.innerWidth = 1024;
  app.events.resize();
  assert.equal(app.byId('auth-seal-button').tabIndex, 0);
  app.window.visualViewport.height = 420;
  app.viewportEvents.resize();
  assert.equal(app.byId('auth-gateway').classList.contains('is-compact'), true);
  assert.equal(app.byId('auth-gateway').style['--auth-height'], '420px');
  app.window.visualViewport.scale = 2;
  app.window.visualViewport.height = 210;
  app.viewportEvents.resize();
  assert.equal(app.byId('auth-gateway').style['--auth-height'], '420px');
});
