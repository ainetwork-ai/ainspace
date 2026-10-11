import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshResponseTimeout } from './response-timeout';

test('a partial answer followed by a lost completion releases the input after inactivity', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let loading = true;
    let timer = refreshResponseTimeout(null, () => { loading = false; });
    t.mock.timers.tick(30000);
    timer = refreshResponseTimeout(timer, () => { loading = false; });
    t.mock.timers.tick(59999);
    assert.equal(loading, true);
    t.mock.timers.tick(1);
    assert.equal(loading, false);
});

test('a completed round cancels the watchdog instead of firing a stale timeout', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let expirations = 0;
    let timer = refreshResponseTimeout(null, () => { expirations++; });
    t.mock.timers.tick(1000);
    timer = refreshResponseTimeout(timer, () => { expirations++; });
    clearTimeout(timer);
    t.mock.timers.tick(60000);
    assert.equal(expirations, 0);
});

test('reply activity replaces the prior deadline rather than firing it during conversation', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let expirations = 0;
    let timer = refreshResponseTimeout(null, () => { expirations++; });
    t.mock.timers.tick(59999);
    timer = refreshResponseTimeout(timer, () => { expirations++; });
    t.mock.timers.tick(1);
    assert.equal(expirations, 0);
    t.mock.timers.tick(59999);
    assert.equal(expirations, 1);
});
