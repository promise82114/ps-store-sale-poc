import { DiagnosticError, responseProblem } from './http.mjs';
import { buildQuery, publicDefinitions } from './query.mjs';

export const saleId = '10f8c20b-f1b4-4814-ad6a-acb122e4ab04';
export const locale = 'zh-hant-tw';
export const defaultUrl = `https://store.playstation.com/${locale}/category/${saleId}/1`;
export const endpoint = 'https://web.np.playstation.com/api/graphql/v1/op';
export const pageSize = 24;

export function validateSaleUrl(value) {
  // Explicit allowlist: one campaign, locale and first page; no URL normalization.
  if (value !== defaultUrl) throw new DiagnosticError('INVALID_SALE_URL', 'input');
  return value;
}

export function scriptUrls(html) {
  const paths = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(match => match[1]);
  const app = paths.filter(path => /^\/_next\/static\/chunks\/pages\/_app-[a-z0-9]+\.js$/.test(path));
  const chunks = paths.filter(path => /^\/_next\/static\/chunks\/(?:\d+|[a-f0-9]{8})-[a-z0-9]+\.js$/.test(path)).reverse();
  // Skip framework, telemetry, consent and anti-bot scripts entirely.
  return [...new Set([...app, ...chunks])].slice(0, 12).map(path => 'https://store.playstation.com' + path);
}

export async function discoverQuery(get, sourceUrl, report) {
  const page = await get(sourceUrl, 'store-page');
  const urls = scriptUrls(page.text);
  if (!urls.length) throw new DiagnosticError('QUERY_UNAVAILABLE', 'query-discovery');
  const definitions = [];
  report.querySources = [];
  for (const url of urls) {
    const asset = await get(url, 'public-script');
    const found = publicDefinitions(asset.text);
    if (found.length) report.querySources.push(url);
    definitions.push(...found);
    const names = new Set(definitions.map(item => item.name?.value));
    if (['categoryGridRetrieve', 'priceFragment', 'personalizedMetaFragment'].every(value => names.has(value))) {
      try { return buildQuery(definitions); }
      catch { throw new DiagnosticError('QUERY_UNAVAILABLE', 'query-discovery'); }
    }
  }
  throw new DiagnosticError('QUERY_UNAVAILABLE', 'query-discovery');
}

export function apiUrl(sha256Hash) {
  const variables = { id: saleId, pageArgs: { size: pageSize, offset: 0 },
    sortBy: null, filterBy: [], facetOptions: [], maxResults: null };
  const query = new URLSearchParams({ operationName: 'categoryGridRetrieve',
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash } }) });
  return `${endpoint}?${query}`;
}

export function validateFirstPage(payload) {
  const fail = code => { throw new DiagnosticError(code, 'first-page-validation'); };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('SCHEMA_MISMATCH');
  if (payload.errors !== undefined) {
    if (!Array.isArray(payload.errors)) fail('SCHEMA_MISMATCH');
    if (payload.errors.length) fail(responseProblem(200, JSON.stringify(payload.errors)) ?? 'GRAPHQL_ERROR');
  }
  const grid = payload.data?.categoryGridRetrieve;
  if (!grid || grid.id !== saleId || !Array.isArray(grid.products)) fail('SCHEMA_MISMATCH');
  const info = grid.pageInfo;
  if (!info || !['totalCount', 'size', 'offset'].every(key => Number.isSafeInteger(info[key]) && info[key] >= 0) ||
      info.offset !== 0 || info.size !== pageSize ||
      (info.isLast !== undefined && typeof info.isLast !== 'boolean')) fail('INVALID_PAGE_INFO');
  if (info.totalCount === 0 && grid.products.length === 0) fail('EMPTY_CATEGORY');
  if (grid.products.length !== Math.min(info.totalCount, info.size)) fail('INCONSISTENT_FIRST_PAGE');
  if (info.isLast !== undefined && info.isLast !== (grid.products.length === info.totalCount)) fail('INCONSISTENT_FIRST_PAGE');
  const products = grid.products.map(product => {
    if (!product || typeof product.id !== 'string' || !product.id.trim() ||
        typeof product.name !== 'string' || !product.name.trim()) fail('INVALID_PRODUCT');
    return {
      key: `${locale}:${product.id}`, id: product.id, name: product.name,
      url: typeof product.url === 'string' && /^https:\/\//.test(product.url) ? product.url : null,
      platforms: Array.isArray(product.platforms) ? product.platforms : null,
      price: product.price && typeof product.price === 'object' ? {
        basePrice: product.price.basePrice ?? null,
        discountedPrice: product.price.discountedPrice ?? null,
        discountText: product.price.discountText ?? null,
      } : null,
      media: Array.isArray(product.media) ? product.media.map(item => ({
        type: item?.type ?? null, role: item?.role ?? null, url: item?.url ?? null,
      })) : null,
    };
  });
  const uniqueProductCount = new Set(products.map(product => product.key)).size;
  return { pageInfo: info, rawProductCount: products.length, uniqueProductCount,
    duplicateProductCount: products.length - uniqueProductCount, products };
}
