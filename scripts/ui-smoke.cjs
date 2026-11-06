// Optional DOM interaction smoke test. Pass an installed happy-dom module path,
// or install happy-dom separately. This does not replace a real desktop test.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { Window } = require(process.argv[2] || 'happy-dom');
const intervals = [];
const originalInterval = global.setInterval;
global.setInterval = (...args) => { const timer = originalInterval(...args); intervals.push(timer); return timer; };
const window = new Window({
  url: 'https://pocket.test',
  settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true },
});
global.window = window;
global.document = window.document;
window.document.write(readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8'));
const $ = id => window.document.getElementById(id);
const click = selector => window.document.querySelector(selector).click();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('UI condition timed out');
    await delay(10);
  }
}

(async () => {
  await import(pathToFileURL(path.join(__dirname, '../src/renderer/app.js')));
  await until(() => $('track-link').textContent === 'Soft Focus');
  assert.equal($('demo-badge').hidden, false);
  assert.equal($('play').getAttribute('aria-label'), 'Pause');
  click('#play');
  await until(() => !$('play').disabled && $('play').getAttribute('aria-label') === 'Play');

  $('search').value = 'Soft Focus';
  $('search').dispatchEvent(new window.Event('input'));
  await until(() => $('results').querySelectorAll('.result-row').length === 1);
  assert.equal($('results').querySelector('.result-name').textContent, 'Soft Focus');
  click('#results button[aria-label="Add Soft Focus to queue"]');
  await until(() => !$('play').disabled);
  click('[data-tab="queue"]');
  await until(() => $('results').querySelectorAll('.result-row').length === 12);

  click('#save');
  await until(() => !$('save').disabled && $('save').getAttribute('aria-pressed') === 'false');
  click('[data-tab="library"]');
  await until(() => $('results').querySelectorAll('.result-row').length === 2);
  assert.equal($('results').textContent.includes('Soft Focus'), false);

  click('[data-tab="devices"]');
  await until(() => $('results').querySelectorAll('.result-row').length === 2 && $('results').textContent.includes('Living room'));
  $('results').querySelectorAll('.result-main')[1].click();
  await until(() => $('device-name').textContent === 'Living room' && !$('play').disabled);

  click('#shuffle');
  await until(() => $('shuffle').getAttribute('aria-pressed') === 'true' && !$('shuffle').disabled);
  click('#repeat');
  await until(() => $('repeat').title === 'Repeat context' && !$('repeat').disabled);
  click('#compact');
  await until(() => document.body.classList.contains('compact'));
  assert.equal($('compact').getAttribute('aria-label'), 'Expand player');
  click('#compact');
  await until(() => !document.body.classList.contains('compact'));

  click('#settings-toggle');
  assert.equal($('settings').hidden, false);
  click('#try-demo');
  await until(() => $('demo-badge').hidden);
  assert.equal($('play').disabled, true);
  assert.equal($('settings').hidden, false);
  assert.equal($('connect-form').hidden, false);
  console.log('UI smoke passed: preview, search, playback, queue, library, devices, shuffle/repeat, compact mode, and settings.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  intervals.forEach(clearInterval);
  global.setInterval = originalInterval;
  await window.happyDOM.abort();
});
