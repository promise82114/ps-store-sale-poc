import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockableDrive, strongETag } from '../src/poc04/drive-transport.mjs';
import { fixture, a, id, mark } from './fixtures/poc04.mjs';
import { mockBackend, jsonResponse, deferred } from './fixtures/mock-drive.mjs';

const rejected = (promise, code) => assert.rejects(promise, error => error.code === code);
const candidate = () => { const doc = fixture({ [a]: mark('tracked', 1) }); doc.data.revisionId = id(902); return doc; };
const driveFor = backend => createMockableDrive({ request: backend.request, timeoutMs: 100 });

test('P04-04 transport requires injection and cannot fall back to real fetch', () => {
  assert.throws(() => createMockableDrive(), e => e.code === 'TRANSPORT_REQUIRED');
});
for (const etag of [null, undefined, '', '*', '""', 'W/"x"', 'unquoted', '"bad tag"', '"bad\nvalue"'])
  test(`P04-04 invalid ETag ${String(etag)} prevents all write requests`, async () => {
    const backend = mockBackend(fixture()), drive = driveFor(backend);
    const expected = await drive.read(); expected.file.etag = etag;
    assert.equal(strongETag(etag), false);
    await rejected(drive.write(candidate(), expected), 'INVALID_ETAG');
    assert.equal(backend.writes().length, 0);
  });
test('P04-04 uses v2 resource ETag and v2 PUT with If-Match; verifies exact content', async () => {
  const backend = mockBackend(fixture()), drive = driveFor(backend);
  const expected = await drive.read(), result = await drive.write(candidate(), expected);
  assert.deepEqual(result.document, candidate());
  assert.equal(result.file.etag, '"etag-2"');
  assert.equal(backend.writes().length, 1);
  assert.match(backend.writes()[0].url, /upload\/drive\/v2\/files\/file_1\?uploadType=media$/);
  assert.equal(backend.writes()[0].headers['If-Match'], '"etag-1"');
  assert.equal(backend.calls.some(c => c.headers.Authorization), false);
});
test('P04-04 missing resource ETag permits comparison but never overwrite', async () => {
  const backend = mockBackend(fixture()); backend.files[0].etag = null;
  const drive = driveFor(backend), expected = await drive.read();
  assert.equal(expected.file.etag, null);
  await rejected(drive.write(candidate(), expected), 'INVALID_ETAG');
  assert.equal(backend.writes().length, 0);
});
test('P04-04 a race after preflight reaches 412 and never retries without If-Match', async () => {
  const backend = mockBackend(fixture()), drive = driveFor(backend), expected = await drive.read();
  backend.before = (url, options) => {
    if (options.method === 'PUT') {
      backend.files[0].etag = '"competitor"';
      backend.files[0].document = fixture({ [a]: mark('ignored', 8) });
    }
  };
  await rejected(drive.write(candidate(), expected), 'HTTP_412');
  assert.equal(backend.files[0].document.data.marks[a].status, 'ignored');
  assert.equal(backend.writes().length, 1);
});
test('P04-04 changed version or replaced file rejects before writing', async () => {
  for (const change of [f => { f.version++; }, f => { f.id = 'replacement'; }]) {
    const backend = mockBackend(fixture()), drive = driveFor(backend), expected = await drive.read();
    change(backend.files[0]);
    await rejected(drive.write(candidate(), expected), 'REMOTE_CHANGED');
    assert.equal(backend.writes().length, 0);
  }
});
for (const status of [401, 403, 429, 500, 503]) test(`P04-04 HTTP ${status} stops after one attempted write`, async () => {
  const backend = mockBackend(fixture()), drive = driveFor(backend), expected = await drive.read();
  backend.before = (url, options) => options.method === 'PUT' ? jsonResponse({}, status) : null;
  await rejected(drive.write(candidate(), expected), `HTTP_${status}`);
  assert.equal(backend.writes().length, 1);
  assert.deepEqual(backend.files[0].document, fixture());
});
test('P04-04 disconnected write does not retry', async () => {
  const backend = mockBackend(fixture()), drive = driveFor(backend), expected = await drive.read();
  backend.before = (url, options) => { if (options.method === 'PUT') throw Error('synthetic disconnect'); };
  await rejected(drive.write(candidate(), expected), 'NETWORK_ERROR');
  assert.equal(backend.writes().length, 1);
});
test('P04-04 timeout bounds a hung request even if injected transport ignores abort', async () => {
  const backend = mockBackend(fixture()), drive = createMockableDrive({ request: backend.request, timeoutMs: 10 });
  const expected = await drive.read();
  backend.before = (url, options) => options.method === 'PUT' ? new Promise(() => {}) : null;
  await rejected(drive.write(candidate(), expected), 'TIMEOUT');
  assert.equal(backend.writes().length, 1);
});
test('P04-04 body download is also covered by timeout', async () => {
  const drive = createMockableDrive({ timeoutMs: 10,
    request: async () => ({ ok: true, text: () => new Promise(() => {}) }) });
  await rejected(drive.read(), 'TIMEOUT');
});
test('P04-04 initial create uses appDataFolder and verifies uniqueness afterwards', async () => {
  const backend = mockBackend(), drive = driveFor(backend);
  const result = await drive.write(candidate(), null);
  assert.equal(result.file.id, 'file_1');
  assert.equal(backend.writes()[0].method, 'POST');
  assert.equal(backend.writes().length, 1);
});
test('P04-04 a file appearing before create blocks POST', async () => {
  const backend = mockBackend(), drive = driveFor(backend);
  assert.equal(await drive.read(), null);
  backend.add(fixture());
  await rejected(drive.write(candidate(), null), 'REMOTE_CHANGED');
  assert.equal(backend.writes().length, 0);
});
test('P04-04 competing initial creation is detected after POST; both files survive', async () => {
  const backend = mockBackend(), drive = driveFor(backend);
  backend.afterWrite = () => { backend.add(fixture(), 'competitor'); };
  await rejected(drive.write(candidate(), null), 'DUPLICATE_FILES');
  assert.equal(backend.files.length, 2);
  assert.equal(backend.writes().length, 1);
  assert.equal(backend.calls.some(c => c.method === 'DELETE'), false);
});
test('P04-04 two simultaneous creators both pass empty preflight then detect duplicates', async () => {
  const backend = mockBackend(), gate = deferred(), committed = deferred();
  let entering = 0, written = 0;
  backend.before = async (url, options) => {
    if (options.method === 'POST') { if (++entering === 2) gate.resolve(); await gate.promise; }
  };
  backend.afterWrite = async () => { if (++written === 2) committed.resolve(); await committed.promise; };
  const first = candidate(), second = candidate(); second.data.revisionId = id(903);
  const outcomes = await Promise.allSettled([driveFor(backend).write(first, null), driveFor(backend).write(second, null)]);
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason.code === 'DUPLICATE_FILES'));
  assert.equal(backend.files.length, 2);
  assert.equal(backend.writes().length, 2);
});
test('P04-04 preexisting duplicate files stop reads and writes', async () => {
  const backend = mockBackend(fixture()); backend.add(fixture());
  const drive = driveFor(backend);
  await rejected(drive.read(), 'DUPLICATE_FILES');
  await rejected(drive.write(candidate(), null), 'DUPLICATE_FILES');
  assert.equal(backend.writes().length, 0);
});
test('P04-04 duplicate detection covers paginated lists', async () => {
  const backend = mockBackend(fixture()), drive = driveFor(backend);
  backend.before = url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/drive/v3/files') return jsonResponse({ files: [{ id: parsed.searchParams.has('pageToken') ? 'f2' : 'f1',
      name: 'ps-store-sale-filter.json', version: '1', size: '2' }],
    ...(parsed.searchParams.has('pageToken') ? {} : { nextPageToken: 'next' }) });
  };
  await rejected(drive.read(), 'DUPLICATE_FILES');
});
test('P04-04 malformed JSON, future schema and oversized metadata are rejected', async () => {
  for (const code of ['INVALID_JSON', 'UNSUPPORTED_SCHEMA', 'INVALID_REMOTE_METADATA']) {
    const backend = mockBackend(fixture()), drive = driveFor(backend);
    if (code === 'UNSUPPORTED_SCHEMA') backend.files[0].document.schemaVersion = 2;
    else backend.before = url => {
      if (code === 'INVALID_JSON' && url.includes('alt=media')) return { ok: true, text: async () => '{' };
      if (code === 'INVALID_REMOTE_METADATA' && new URL(url).pathname === '/drive/v3/files')
        return jsonResponse({ files: [{ id: 'f1', name: 'ps-store-sale-filter.json', version: '1', size: String(17 * 1024 * 1024) }] });
    };
    await rejected(drive.read(), code);
    assert.equal(backend.writes().length, 0);
  }
});
