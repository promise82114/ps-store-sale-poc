import { openPersonalStore } from '../../src/poc04/indexeddb-store.mjs';
import { createMockableDrive } from '../../src/poc04/drive-transport.mjs';
import { prepareSync, uploadPrepared, recoverSync } from '../../src/poc04/sync-session.mjs';
import { exportBackup } from '../../src/poc04/personal-data.mjs';
import { fixture, a, b, otherLocale, id } from '../fixtures/poc04.mjs';
import { deferred, mockBackend, jsonResponse } from '../fixtures/mock-drive.mjs';

const params = new URLSearchParams(location.search), run = params.get('run');
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(run ?? '')) throw Error('test run id required');
const channel = new BroadcastChannel(`poc04-${run}`), results = [];
const screen = document.querySelector('#results'), connections = [];
let counter = 20000, dbCounter = 0;
const uuid = () => id(++counter);
const metadata = () => ({ changeId: uuid(), updatedAt: counter });
const options = () => ({ attemptId: uuid(), revisionId: uuid(), datasetId: uuid(), decisions: { all: 'local' } });
const assert = (value, message = 'assertion failed') => { if (!value) throw Error(message); };
const equal = (a, b) => assert(JSON.stringify(a) === JSON.stringify(b), 'values differ');
async function rejects(fn, code) {
  let error;
  try { await fn(); } catch (caught) { error = caught; }
  assert(error?.code === code, `expected ${code}, got ${error?.code ?? 'success'}`);
}
async function open(name = `poc04-test-${run}-${++dbCounter}`, factory) {
  const store = await openPersonalStore({ name, factory }); connections.push(store);
  return { store, name };
}
const edit = (store, key, status) => store.classify(key, status, metadata());
const protectedData = state => JSON.stringify([state.document, state.base, state.outbox, state.localRevision, state.remote]);
async function boot(factory, name) {
  const opened = await open(name, factory), backend = mockBackend(fixture());
  const drive = createMockableDrive({ request: backend.request, timeoutMs: 1000 });
  await edit(opened.store, a, 'tracked');
  const config = options();
  await prepareSync(opened.store, drive, config);
  await uploadPrepared(opened.store, drive, config.attemptId);
  backend.calls.length = 0;
  return { ...opened, backend, drive };
}
// Fault injection wraps the native factory; it does not emulate IDB semantics.
// Abort after the native put succeeds, before the transaction commits.
function abortingFactory(flag) {
  return { open(...args) {
    const request = indexedDB.open(...args);
    return new Proxy(request, { get(target, key) {
      if (key === 'result') return wrapDatabase(target.result);
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    }, set(target, key, value) { return Reflect.set(target, key, value, target); } });
  } };
  function wrapDatabase(db) {
    return new Proxy(db, { get(target, key) {
      if (key === 'transaction') return (...args) => {
        const tx = target.transaction(...args), original = tx.objectStore.bind(tx);
        tx.objectStore = name => {
          const store = original(name), put = store.put.bind(store);
          store.put = (...values) => {
            if (flag.throwPut) { flag.throwPut = false; throw new DOMException('synthetic quota', 'QuotaExceededError'); }
            const request = put(...values);
            if (flag.abort) { flag.abort = false; request.addEventListener('success', () => tx.abort(), { once: true }); }
            return request;
          };
          return store;
        };
        return tx;
      };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    }, set(target, key, value) { return Reflect.set(target, key, value, target); } });
  }
}
async function test(name, action) {
  const started = performance.now();
  try { await action(); results.push({ name, result: 'PASS', durationMs: +(performance.now() - started).toFixed(3) }); }
  catch (error) { results.push({ name, result: 'FAIL', error: error.code ?? error.message }); }
  screen.textContent = JSON.stringify({ phase: 'running', results }, null, 2);
}
async function publish(phase) {
  const output = { phase, run, userAgent: navigator.userAgent, origin: location.origin,
    realIndexedDB: true, realDrive: false, results,
    conclusion: results.every(r => r.result === 'PASS') ? 'PASS' : 'FAIL' };
  screen.textContent = JSON.stringify(output, null, 2);
  await fetch('/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(output) });
}
if (params.get('mode') === 'peer') {
  channel.onmessage = async ({ data }) => {
    if (!data.requestId) return;
    let store;
    try {
      store = (await open(data.name)).store;
      const state = data.action === 'edit' ? await store.classify(data.key, data.status, data.metadata)
        : data.action === 'begin' ? await store.begin(data.attemptId) : await store.read();
      channel.postMessage({ replyTo: data.requestId, state });
    } catch (error) { channel.postMessage({ replyTo: data.requestId, error: error.code ?? 'PEER_ERROR' }); }
    finally { store?.close(); }
  };
  screen.textContent = `POC04 peer ready: ${run}`;
} else {
  let requestId = 0;
  const pending = new Map();
  channel.onmessage = ({ data }) => { if (data.replyTo) pending.get(data.replyTo)?.(data); };
  function peer(data) {
    return new Promise((resolve, reject) => {
      const key = ++requestId, timer = setTimeout(() => { pending.delete(key); reject(Error('peer timeout')); }, 8000);
      pending.set(key, response => { clearTimeout(timer); pending.delete(key);
        if (response.error) { const e = Error(response.error); e.code = response.error; reject(e); } else resolve(response.state); });
      channel.postMessage({ requestId: key, ...data });
    });
  }
  const reloadName = `poc04-test-${run}-reload`, probe = await open(reloadName);
  const saved = await probe.store.read();
  probe.store.close();
  if (saved.attempt?.stage === 'prepared' && saved.lastConfirmed) {
    await test('P04-03 actual page reload preserves document, Tombstone, Base, outbox and prepared journal', async () => {
      const previous = await (await fetch('/previous')).json();
      const reopened = await open(reloadName);
      equal(await reopened.store.read(), previous.reloadExpected);
      assert(saved.base.data.marks[a].status === 'tracked');
      assert(saved.document.data.marks[a].status === 'ignored');
      assert(saved.document.data.tombstones[b]);
      assert(Object.keys(saved.outbox).length === 2);
    });
    await publish('reload');
  } else {
    await test('P04-03 marks, Tombstone, revision and outbox persist across connection reopen', async () => {
      const { store, name } = await open();
      await edit(store, a, 'tracked'); await edit(store, b, 'ignored'); await edit(store, b, 'unclassified');
      const before = await store.read(); store.close();
      const reopened = await open(name);
      equal(await reopened.store.read(), before);
      assert(before.localRevision === 3 && before.outbox[b].localRevision === 3);
      assert(before.document.data.tombstones[b] && before.base === null);
    });
    await test('P04-03 native transaction abort after put success rolls back all fields', async () => {
      const flag = {}, { store, name } = await open(undefined, abortingFactory(flag));
      await edit(store, a, 'tracked'); const before = await store.read();
      flag.abort = true;
      await rejects(() => edit(store, a, 'ignored'), 'STORAGE_TRANSACTION_FAILED');
      equal(await store.read(), before); store.close();
      equal(await (await open(name)).store.read(), before);
    });
    await test('P04-03 quota-style put failure preserves previously committed data', async () => {
      const flag = {}, { store } = await open(undefined, abortingFactory(flag));
      await edit(store, a, 'tracked'); const before = await store.read(); flag.throwPut = true;
      await rejects(() => edit(store, b, 'ignored'), 'STORAGE_TRANSACTION_FAILED');
      equal(await store.read(), before);
    });
    await test('P04-03 separate native connections serialize concurrent edits without cached overwrites', async () => {
      const { store, name } = await open(), second = (await open(name)).store;
      await Promise.all([edit(store, a, 'tracked'), edit(second, b, 'ignored')]);
      const state = await store.read(); assert(state.localRevision === 2);
      assert(state.document.data.marks[a] && state.document.data.marks[b]);
    });
    await test('P04-03 actual second tab concurrent different-product edits both persist', async () => {
      const { store, name } = await open();
      await Promise.all([edit(store, a, 'tracked'), peer({ action: 'edit', name, key: b, status: 'ignored', metadata: metadata() })]);
      const state = await store.read(); assert(state.localRevision === 2);
      assert(state.document.data.marks[a] && state.document.data.marks[b]);
      equal(await peer({ action: 'read', name }), state);
    });
    await test('P04-03 actual second tab same-product edits serialize to two revisions', async () => {
      const { store, name } = await open();
      const m1 = metadata(), m2 = metadata();
      await Promise.all([store.classify(a, 'tracked', m1), peer({ action: 'edit', name, key: a, status: 'ignored', metadata: m2 })]);
      const state = await store.read(); assert(state.localRevision === 2);
      assert(state.outbox[a].localRevision === 2);
      assert([m1.changeId, m2.changeId].includes(state.document.data.marks[a].changeId));
    });
    await test('P04-03 sync snapshot is atomic against an actual second-tab edit', async () => {
      const { store, name } = await open(); await edit(store, a, 'tracked');
      const attemptId = uuid();
      const [started] = await Promise.all([store.begin(attemptId),
        peer({ action: 'edit', name, key: a, status: 'ignored', metadata: metadata() })]);
      const snapshot = started.attempt.snapshot;
      assert([1, 2].includes(snapshot.localRevision));
      assert(snapshot.local.data.marks[a].changeId === snapshot.outbox[a].changeId);
      assert(snapshot.outbox[a].localRevision === snapshot.localRevision);
    });
    await test('P04-03 upload acknowledgement rebases later edits and clears only unchanged captured operations', async () => {
      const { store, name, backend, drive } = await boot();
      await edit(store, a, 'ignored'); await edit(store, b, 'tracked');
      const c = 'en-us:PRODUCT_C'; await edit(store, c, 'tracked');
      const config = options(), prepared = await prepareSync(store, drive, config);
      const entered = deferred(), release = deferred();
      backend.before = async (url, opts) => { if (opts.method === 'PUT') { entered.resolve(); await release.promise; } };
      const uploading = uploadPrepared(store, drive, config.attemptId); await entered.promise;
      await peer({ action: 'edit', name, key: a, status: 'tracked', metadata: metadata() });
      await edit(store, b, 'unclassified'); await edit(store, otherLocale, 'ignored');
      const during = await store.read(); release.resolve(); const completed = await uploading;
      equal(completed.base, prepared.attempt.candidate);
      assert(completed.document.data.marks[a].status === 'tracked');
      assert(completed.document.data.tombstones[b]);
      assert(completed.document.data.marks[otherLocale].status === 'ignored');
      assert(!completed.base.data.marks[otherLocale] && completed.base.data.marks[b].status === 'tracked');
      equal(Object.keys(completed.outbox).sort(), [a, b, otherLocale].sort());
      assert(!completed.outbox[c] && completed.outbox[a].changeId === during.outbox[a].changeId);
    });
    await test('P04-03 same displayed state with a newer changeId stays pending after acknowledgement', async () => {
      const { store, backend, drive } = await boot(); await edit(store, a, 'ignored');
      const config = options(); await prepareSync(store, drive, config);
      const entered = deferred(), release = deferred();
      backend.before = async (url, opts) => { if (opts.method === 'PUT') { entered.resolve(); await release.promise; } };
      const uploading = uploadPrepared(store, drive, config.attemptId); await entered.promise;
      await edit(store, a, 'tracked'); await edit(store, a, 'ignored');
      const latest = await store.read(); release.resolve(); const completed = await uploading;
      assert(completed.outbox[a].changeId === latest.outbox[a].changeId);
      assert(completed.base.data.marks[a].changeId !== completed.document.data.marks[a].changeId);
    });
    await test('P04-03 changes before dispatch invalidate the prepared snapshot without sending', async () => {
      const { store, backend, drive } = await boot(); const config = options();
      await prepareSync(store, drive, config); await edit(store, a, 'ignored');
      const before = await store.read();
      await rejects(() => uploadPrepared(store, drive, config.attemptId), 'STALE_SNAPSHOT');
      assert(backend.writes().length === 0);
      assert(protectedData(await store.read()) === protectedData(before));
      await store.cancelPrepared(config.attemptId);
      assert(protectedData(await store.read()) === protectedData(before));
    });
    await test('P04-03 edits while Remote is being read invalidate conflict choices before staging', async () => {
      const { store, backend, drive } = await boot(); const entered = deferred(), release = deferred();
      backend.before = async url => { if (url.includes('alt=media')) { entered.resolve(); await release.promise; } };
      const config = options(), preparing = prepareSync(store, drive, config);
      await entered.promise; await edit(store, a, 'ignored'); release.resolve();
      await rejects(() => preparing, 'STALE_SNAPSHOT'); assert(backend.writes().length === 0);
      assert((await store.read()).outbox[a]);
    });
    await test('P04-03 one durable sync attempt blocks a second tab upload but allows classification', async () => {
      const { store, name } = await open(); const attemptId = uuid(); await store.begin(attemptId);
      await rejects(() => peer({ action: 'begin', name, attemptId: uuid() }), 'SYNC_IN_PROGRESS');
      await peer({ action: 'edit', name, key: a, status: 'tracked', metadata: metadata() });
      assert((await store.read()).document.data.marks[a]);
    });
    await test('P04-04 cloud success plus local commit abort recovers after reopen without reupload', async () => {
      const flag = {}, { store, backend, drive, name } = await boot(abortingFactory(flag));
      await edit(store, a, 'ignored'); const config = options(); await prepareSync(store, drive, config);
      const before = await store.read(); backend.afterWrite = () => { flag.abort = true; };
      await rejects(() => uploadPrepared(store, drive, config.attemptId), 'CLOUD_CONFIRMED_LOCAL_COMMIT_FAILED');
      const failed = await store.read(); assert(protectedData(failed) === protectedData(before));
      assert(failed.attempt.stage === 'sending'); backend.afterWrite = null;
      await edit(store, a, 'tracked'); store.close(); const reopened = (await open(name)).store;
      const writes = backend.writes().length, completed = await recoverSync(reopened, drive);
      assert(backend.writes().length === writes);
      assert(completed.base.data.marks[a].status === 'ignored' && completed.document.data.marks[a].status === 'tracked');
      assert(completed.outbox[a] && completed.attempt === null);
      equal(await reopened.acknowledge(config.attemptId, {}), completed);
    });
    await test('P04-04 committed write with lost response is confirmed by readback only', async () => {
      const { store, backend, drive } = await boot(); await edit(store, a, 'ignored');
      const config = options(); await prepareSync(store, drive, config); const before = await store.read();
      backend.afterWrite = () => { throw Error('synthetic lost response'); };
      await rejects(() => uploadPrepared(store, drive, config.attemptId), 'NETWORK_ERROR');
      assert(protectedData(await store.read()) === protectedData(before)); backend.afterWrite = null;
      const writes = backend.writes().length; const result = await recoverSync(store, drive);
      assert(backend.writes().length === writes && result.attempt === null);
      assert(Object.keys(result.outbox).length === 0);
    });
    await test('P04-04 uncertain late write: non-match stays blocked; later exact readback recovers', async () => {
      const { store, backend } = await boot(); const drive = createMockableDrive({ request: backend.request, timeoutMs: 20 });
      await edit(store, a, 'ignored'); const config = options(); await prepareSync(store, drive, config);
      const release = deferred(), committed = deferred();
      backend.before = async (url, opts) => { if (opts.method === 'PUT') await release.promise; };
      backend.afterWrite = () => committed.resolve();
      await rejects(() => uploadPrepared(store, drive, config.attemptId), 'TIMEOUT');
      const uncertain = await store.read();
      await rejects(() => recoverSync(store, drive), 'RECOVERY_REQUIRED');
      equal(await store.read(), uncertain);
      await rejects(() => store.begin(uuid()), 'SYNC_IN_PROGRESS');
      await rejects(() => store.cancelPrepared(config.attemptId), 'INVALID_SYNC_STAGE');
      release.resolve(); await committed.promise;
      const completed = await recoverSync(store, drive);
      assert(completed.attempt === null && backend.writes().length === 1);
    });
    for (const status of [401, 403, 429, 500, 503]) await test(`P04-04 HTTP ${status} preserves native persisted marks, Tombstone, Base and outbox`, async () => {
      const { store, backend, drive } = await boot(); await edit(store, a, 'unclassified');
      const config = options(); await prepareSync(store, drive, config); const before = await store.read();
      backend.before = (url, opts) => opts.method === 'PUT' ? jsonResponse({}, status) : null;
      await rejects(() => uploadPrepared(store, drive, config.attemptId), `HTTP_${status}`);
      assert(protectedData(await store.read()) === protectedData(before)); assert(backend.writes().length === 1);
    });
    await test('P04-04 HTTP 412 preserves local state and competitor content without retry', async () => {
      const { store, backend, drive } = await boot(); await edit(store, a, 'ignored');
      const config = options(); await prepareSync(store, drive, config); const before = await store.read();
      backend.before = (url, opts) => { if (opts.method === 'PUT') backend.files[0].etag = '"competitor"'; };
      await rejects(() => uploadPrepared(store, drive, config.attemptId), 'HTTP_412');
      assert(protectedData(await store.read()) === protectedData(before));
      await rejects(() => recoverSync(store, drive), 'RECOVERY_REQUIRED'); assert(backend.writes().length === 1);
    });
    await test('P04-04 missing ETag stops preparation and preserves all persisted personal data', async () => {
      const { store, backend, drive } = await boot(); await edit(store, a, 'ignored');
      const before = await store.read(); backend.files[0].etag = null;
      await rejects(() => prepareSync(store, drive, options()), 'INVALID_ETAG');
      assert(protectedData(await store.read()) === protectedData(before)); assert(backend.writes().length === 0);
    });
    await test('P04-04 competing first create retains both files and recoverable local journal', async () => {
      const { store } = await open(), backend = mockBackend(), drive = createMockableDrive({ request: backend.request });
      await edit(store, a, 'tracked'); const config = options(); await prepareSync(store, drive, config);
      const before = await store.read(); backend.afterWrite = () => { backend.add(fixture(), 'competitor'); };
      await rejects(() => uploadPrepared(store, drive, config.attemptId), 'DUPLICATE_FILES');
      assert(protectedData(await store.read()) === protectedData(before));
      await rejects(() => recoverSync(store, drive), 'DUPLICATE_FILES');
      assert(backend.files.length === 2 && backend.writes().length === 1);
    });
    await test('P04-04 daily remote deletion cannot be treated as first sync', async () => {
      const { store, backend, drive } = await boot(); backend.files.length = 0;
      const before = await store.read();
      await rejects(() => prepareSync(store, drive, options()), 'REMOTE_MISSING');
      assert(protectedData(await store.read()) === protectedData(before)); assert(backend.writes().length === 0);
    });
    await test('P04-03 prepare durable state for actual browser reload', async () => {
      const { store, drive } = await boot(undefined, reloadName);
      await edit(store, a, 'ignored'); await edit(store, b, 'tracked'); await edit(store, b, 'unclassified');
      await prepareSync(store, drive, options());
      const expected = await store.read();
      await fetch('/reload-expected', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reloadExpected: expected }) });
    });
    await publish('initial');
  }
  connections.forEach(store => store.close());
}
addEventListener('pagehide', () => connections.forEach(store => store.close()));
