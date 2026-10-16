import test from 'node:test';
import assert from 'node:assert/strict';
import permissions from '../desktop/permissions.cjs';

const { createPermissionPolicy, describePermission } = permissions;

function setup(options = {}) {
  const asked = [];
  const known = { getURL: () => 'https://site.example/page' };
  const policy = createPermissionPolicy({
    isKnownContents: (contents) => contents === known,
    ask: (request) => asked.push(request),
    ...options
  });
  return { policy, asked, known };
}

function request(policy, contents, permission, details = {}) {
  return new Promise((resolve) => {
    policy.onRequest(contents, permission, resolve, details);
    if (['fullscreen', 'unknown-thing', 'midi'].includes(permission) || contents !== undefined) {
      setImmediate(() => resolve('pending'));
    }
  });
}

test('safe features are allowed without asking', async () => {
  const { policy, asked, known } = setup();
  for (const permission of ['fullscreen', 'clipboard-sanitized-write', 'pointerLock']) {
    assert.equal(await request(policy, known, permission), true, permission);
  }
  assert.equal(asked.length, 0);
});

test('risky or unknown features are denied without asking', async () => {
  const { policy, asked, known } = setup();
  for (const permission of [
    'midi',
    'openExternal',
    'clipboard-read',
    'display-capture',
    'unknown-thing'
  ]) {
    assert.equal(await request(policy, known, permission), false, permission);
  }
  assert.equal(asked.length, 0);
});

test('requests from unknown pages are denied', async () => {
  const { policy, asked } = setup();
  const stranger = { getURL: () => 'https://evil.example/' };
  assert.equal(
    await request(policy, stranger, 'geolocation', { requestingUrl: 'https://evil.example/' }),
    false
  );
  assert.equal(asked.length, 0);
});

test('location, notifications and camera ask the user and wait for the answer', async () => {
  const { policy, asked, known } = setup();
  const answers = [];
  policy.onRequest(known, 'geolocation', (value) => answers.push(value), {
    requestingUrl: 'https://site.example/page'
  });
  assert.equal(answers.length, 0);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].host, 'site.example');
  assert.equal(asked[0].action, 'know your location');
  assert.equal(policy.pendingCount(), 1);
  assert.equal(policy.respond(asked[0].id, true), true);
  assert.deepEqual(answers, [true]);
  assert.equal(policy.respond(asked[0].id, true), false);
});

test('an answer is remembered for that site and feature', async () => {
  const { policy, asked, known } = setup();
  const answers = [];
  const details = { requestingUrl: 'https://site.example/a' };
  policy.onRequest(known, 'notifications', (v) => answers.push(v), details);
  policy.respond(asked[0].id, false);
  policy.onRequest(known, 'notifications', (v) => answers.push(v), details);
  assert.deepEqual(answers, [false, false]);
  assert.equal(asked.length, 1);
  assert.equal(policy.onCheck(known, 'notifications', 'https://site.example'), false);
  policy.onRequest(known, 'geolocation', (v) => answers.push(v), details);
  assert.equal(asked.length, 2);
  policy.respond(asked[1].id, true);
  assert.equal(policy.onCheck(known, 'geolocation', 'https://site.example'), true);
  assert.equal(policy.onCheck(known, 'geolocation', 'https://other.example'), false);
});

test('only an explicit true counts as allow', () => {
  const { policy, asked, known } = setup();
  const answers = [];
  policy.onRequest(known, 'geolocation', (v) => answers.push(v), {
    requestingUrl: 'https://site.example/'
  });
  policy.respond(asked[0].id, 'yes');
  assert.deepEqual(answers, [false]);
});

test('a question nobody answers is denied after the timeout', async () => {
  const keepAlive = setTimeout(() => {}, 5000);
  const { policy, asked, known } = setup({ timeoutMs: 10 });
  const answer = await new Promise((resolve) =>
    policy.onRequest(known, 'media', resolve, {
      requestingUrl: 'https://site.example/',
      mediaTypes: ['video']
    })
  );
  clearTimeout(keepAlive);
  assert.equal(answer, false);
  assert.equal(asked[0].action, 'use your camera');
  assert.equal(policy.pendingCount(), 0);
});

test('denyAll answers every open question with no', () => {
  const { policy, known } = setup();
  const answers = [];
  policy.onRequest(known, 'geolocation', (v) => answers.push(v), {
    requestingUrl: 'https://a.example/'
  });
  policy.onRequest(known, 'notifications', (v) => answers.push(v), {
    requestingUrl: 'https://b.example/'
  });
  policy.denyAll();
  assert.deepEqual(answers, [false, false]);
});

test('requests without a web address are denied', async () => {
  const { policy, known } = setup();
  const noUrl = { getURL: () => 'about:blank' };
  const strict = createPermissionPolicy({ isKnownContents: () => true, ask: () => {} });
  const answers = [];
  strict.onRequest(noUrl, 'geolocation', (v) => answers.push(v), {});
  assert.deepEqual(answers, [false]);
  assert.ok(known);
  assert.ok(policy);
});

test('permission descriptions are friendly', () => {
  assert.equal(
    describePermission('media', { mediaTypes: ['audio', 'video'] }),
    'use your camera and microphone'
  );
  assert.equal(describePermission('media', { mediaTypes: ['audio'] }), 'use your microphone');
  assert.equal(describePermission('notifications'), 'send you notifications');
});
