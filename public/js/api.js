/** Thin client for the local JSON API. */

async function request(method, body) {
  const res = await fetch('/api/data', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) throw new Error(payload?.error || `Request failed (${res.status})`);
  return payload;
}

export const api = {
  load: () => request('GET'),
  save: (data) => request('PUT', data),
};
