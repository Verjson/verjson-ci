export function normalizeCoordinatorOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('coordinator origin is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('coordinator origin must be one credential-free HTTPS origin');
  }
  return url.origin;
}

export async function coordinatorRequest(origin, path, options = {}, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  const base = normalizeCoordinatorOrigin(origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`${base}${path}`, { ...options, redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
