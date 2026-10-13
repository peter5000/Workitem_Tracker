/** Small, dependency-free helpers shared across the UI. */

export const uid = (prefix = 'id') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const nowIso = () => new Date().toISOString();

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape user content before interpolating it into HTML. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 3725000 → "01:02:05" */
export function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

/** 8100000 → "2h 15m" */
export function fmtDuration(ms) {
  const totalMin = Math.round(Math.max(0, ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Estimate hours → "30m" / "2h" / "1.25h" */
export function fmtHours(hours) {
  if (!hours) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${+Number(hours).toFixed(2)}h`;
}

/** ISO → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (local) → ISO, or null if empty/invalid. */
export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Monday 00:00 local time of the week containing `date`. */
export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) =>
  new Date(iso).toLocaleDateString(undefined, opts);

export const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function daysSince(iso, now = Date.now()) {
  return Math.floor((now - Date.parse(iso)) / 86400000);
}

export function relDays(iso) {
  const d = daysSince(iso);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}
