import { exportBackup, requireData } from './personal-data.mjs';
import { validateFile } from './drive-transport.mjs';

export async function prepareSync(store, drive, { attemptId, ...options }) {
  await store.begin(attemptId);
  // Errors retain the snapshot journal, original Base and outbox. A never-sent
  // attempt may be explicitly cancelled via cancelPrepared, never an uncertain one.
  const expected = await drive.read();
  if (expected) validateFile(expected.file, true);
  return store.stage(attemptId, expected, options);
}
export async function uploadPrepared(store, drive, attemptId) {
  const sending = await store.sending(attemptId);
  const attempt = sending.attempt;
  let receipt;
  try { receipt = await drive.write(attempt.candidate, attempt.expected); }
  catch (error) {
    try { await store.failed(attemptId, error.code ?? 'TRANSPORT_FAILED'); } catch { /* durable sending journal remains */ }
    throw error;
  }
  try { return await store.acknowledge(attemptId, receipt); }
  catch {
    const error = new Error('CLOUD_CONFIRMED_LOCAL_COMMIT_FAILED');
    error.code = 'CLOUD_CONFIRMED_LOCAL_COMMIT_FAILED';
    throw error; // Candidate + S0 remain persisted for read-only recovery.
  }
}
export async function recoverSync(store, drive) {
  const current = await store.read(), attempt = current.attempt;
  requireData(attempt && ['sending', 'uncertain'].includes(attempt.stage), 'NO_UNCERTAIN_ATTEMPT');
  const receipt = await drive.read(); // Never writes/retries, even after a non-match.
  requireData(receipt && (!attempt.expected || receipt.file.id === attempt.expected.file.id)
    && exportBackup(receipt.document) === exportBackup(attempt.candidate), 'RECOVERY_REQUIRED');
  validateFile(receipt.file, true);
  return store.acknowledge(attempt.id, receipt);
}
