import { mkdir, rm, writeFile } from 'node:fs/promises';
import { platform, arch } from 'node:os';
import { createClient, DiagnosticError } from './http.mjs';
import { apiUrl, defaultUrl, discoverQuery, endpoint, locale, saleId, validateFirstPage, validateSaleUrl } from './diagnostic.mjs';

const output = new URL('../artifacts/', import.meta.url);
const startedAt = new Date().toISOString();
const hostedRunner = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
const runUrl = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ?
  `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
const report = {
  schemaVersion: 1, scope: 'tasks-01-02', startedAt, finishedAt: null,
  mode: null, sourceUrl: null, saleId, locale, apiEndpoint: endpoint,
  operationName: 'categoryGridRetrieve', authenticationUsed: false,
  environment: { node: process.version, os: platform(), arch: arch(), githubHostedRunner: hostedRunner, runUrl },
  environmentCheck: 'NOT_RUN', firstPageValidation: 'NOT_RUN', conclusion: 'INCONCLUSIVE',
  complete: false, requests: [], error: null,
};
let exitCode = 0;
await mkdir(output, { recursive: true });
await rm(new URL('first-page-products.json', output), { force: true });
try {
  const args = process.argv.slice(2);
  let mode = 'environment';
  let sourceUrl = process.env.SALE_URL ?? defaultUrl;
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1]) throw new DiagnosticError('INVALID_ARGUMENT', 'input');
    if (args[i] === '--mode') mode = args[i + 1];
    else if (args[i] === '--sale-url') sourceUrl = args[i + 1];
    else throw new DiagnosticError('INVALID_ARGUMENT', 'input');
  }
  if (!['environment', 'first-page'].includes(mode)) throw new DiagnosticError('INVALID_MODE', 'input');
  report.mode = mode;
  validateSaleUrl(sourceUrl);
  report.sourceUrl = sourceUrl;
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 18)) throw new DiagnosticError('UNSUPPORTED_RUNTIME', 'environment');
  report.environmentCheck = 'PASS';
  if (mode === 'first-page') {
    const get = createClient(report.requests);
    const query = await discoverQuery(get, sourceUrl, report);
    report.queryHash = query.sha256Hash;
    report.queryHashMethod = 'current official query + Apollo typename + sorted AST + legacy Store printer';
    const response = await get(apiUrl(query.sha256Hash), 'graphql-first-page', { json: true });
    let payload;
    try { payload = JSON.parse(response.text); }
    catch { throw new DiagnosticError('INVALID_JSON', 'graphql-first-page', response.httpStatus); }
    const firstPage = validateFirstPage(payload);
    report.firstPageValidation = 'PASS';
    const { products, ...counts } = firstPage;
    Object.assign(report, counts);
    report.conclusion = hostedRunner ? 'PASS' : 'INCONCLUSIVE';
    await writeFile(new URL('first-page-products.json', output), JSON.stringify({
      schemaVersion: 1, scope: 'first-page-only', complete: false,
      saleId, locale, fetchedAt: new Date().toISOString(), ...firstPage,
    }, null, 2) + '\n');
  }
} catch (error) {
  const failure = error instanceof DiagnosticError ? error : new DiagnosticError('INTERNAL_ERROR', 'runtime');
  report.error = { code: failure.code, stage: failure.stage, httpStatus: failure.httpStatus };
  if (report.mode === 'first-page') report.firstPageValidation = 'FAIL';
  report.conclusion = ['NETWORK_ERROR', 'TIMEOUT', 'UPSTREAM_ERROR', 'RATE_LIMITED', 'EMPTY_CATEGORY', 'INTERNAL_ERROR'].includes(failure.code) ? 'INCONCLUSIVE' : 'FAIL';
  exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('fetch-report.json', output), JSON.stringify(report, null, 2) + '\n');
  const markdown = `# POC Tasks 01 / 02 diagnostic\n\n` +
    `- Started (UTC): ${report.startedAt}\n- Finished (UTC): ${report.finishedAt}\n` +
    `- Mode: ${report.mode ?? 'invalid'}\n- Source: ${report.sourceUrl ?? 'rejected input'}\n` +
    `- Environment check: ${report.environmentCheck}\n- First page: ${report.firstPageValidation}\n` +
    `- GitHub-hosted runner: ${hostedRunner}\n- Actions run: ${runUrl ?? 'not run in Actions'}\n` +
    `- Authentication used: false\n- API: ${endpoint}\n- Operation: categoryGridRetrieve\n` +
    `- Query hash: ${report.queryHash ?? 'not discovered'}\n` +
    `- Reported total: ${report.pageInfo?.totalCount ?? 'unknown'}\n- Pages validated: ${report.firstPageValidation === 'PASS' ? 1 : 0}\n` +
    `- Raw / unique / duplicate products: ${report.rawProductCount ?? 0} / ${report.uniqueProductCount ?? 0} / ${report.duplicateProductCount ?? 0}\n` +
    `- Error: ${report.error ? `${report.error.code} (${report.error.stage}, HTTP ${report.error.httpStatus ?? 'n/a'})` : 'none'}\n` +
    `- Conclusion: **${report.conclusion}**\n\n` +
    `Only the first page is in scope. complete=false always; totalCount is informational.\n` +
    `Local PASS for parsing does not establish GitHub-hosted access or full pagination.\n`;
  await writeFile(new URL('POC_REPORT.md', output), markdown);
  console.log(`Environment: ${report.environmentCheck}; first page: ${report.firstPageValidation}; conclusion: ${report.conclusion}`);
  if (report.error) console.error(`Failure: ${report.error.code}; stage: ${report.error.stage}; HTTP: ${report.error.httpStatus ?? 'n/a'}`);
  process.exitCode = exitCode;
}
