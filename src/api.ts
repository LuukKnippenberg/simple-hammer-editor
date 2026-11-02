/**
 * Header the dev server requires on every write. Another web page can only add a custom header through a CORS
 * preflight, so a cross-site "simple" POST (a form or `mode: 'no-cors'`) is refused (see `server/plugin.ts`).
 */
export const API_HEADER = 'X-SHE';

/** POSTs to a dev-server route with the write header. */
export function apiPost(url: string, body?: BodyInit): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { [API_HEADER]: '1' }, body });
}
