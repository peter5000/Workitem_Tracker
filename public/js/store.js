/**
 * Single source of truth for board state + every workflow rule.
 *
 * All mutations validate first (throwing RuleError with a human message),
 * then mutate inside commit(), which re-renders and persists to the server.
 */
import { api } from './api.js';
import { uid, nowIso, startOfWeek } from './utils.js';

// Keep in sync with LIMITS in server.js
export const LIMITS = Object.freeze({
  backlogWarn: 15,
  backlogMax: 20,
  ready: 5,
  doing: 2,
  adHoc: 1,
  staleDoingDays: 5,
});

export const PALETTE = Object.freeze([
  '#818cf8', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#a78bfa', '#fb7185', '#2dd4bf',
]);

export const MSG = Object.freeze({
  readyFull: `Ready is full (${LIMITS.ready}/${LIMITS.ready}). Start or send back an item first.`,
  doingFull: `Doing is full (${LIMITS.doing}/${LIMITS.doing}). Finish something first — focus is the point.`,
  adHocFull: 'The ad-hoc slot is taken. Resolve the current emergency first.',
});

export class RuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuleError';
  }
}

// ---------------------------------------------------------------------------
// State, subscription, persistence
// ---------------------------------------------------------------------------
let state = { version: 1, projects: [], items: [] };
const listeners = new Set();
let saveStatus = () => {};

export const getState = () => state;
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const onSaveStatus = (fn) => {
  saveStatus = fn;
};
const emit = () => listeners.forEach((fn) => fn(state));

function normalize(data) {
  const s = { version: 1, projects: [], items: [], ...data };
  s.items = s.items.map((i) => ({
    projectId: null,
    isAdHoc: false,
    notes: '',
    definitionOfDone: '',
    timeEstimateHours: null,
    dueDate: null,
    timeLog: [],
    movedToReadyAt: null,
    movedToDoingAt: null,
    completedAt: null,
    archivedAt: null,
    somedayAt: null,
    ...i,
  }));
  return s;
}

export async function load() {
  state = normalize(await api.load());
  emit();
}

let saveChain = Promise.resolve();
function persist() {
  const snapshot = JSON.parse(JSON.stringify(state));
  saveStatus('saving');
  saveChain = saveChain
    .then(() => api.save(snapshot))
    .then(
      () => saveStatus('saved'),
      async (err) => {
        saveStatus('error', err.message);
        // Re-sync with whatever the server actually has.
        try {
          state = normalize(await api.load());
          emit();
        } catch {
          /* server unreachable — keep local state */
        }
      },
    );
}

function commit(mutate) {
  const result = mutate();
  emit();
  persist();
  return result;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------
export const items = (status) => state.items.filter((i) => i.status === status);
export const getItem = (id) => state.items.find((i) => i.id === id) || null;
export const getProject = (id) => (id ? state.projects.find((p) => p.id === id) || null : null);
export const regularDoing = () => state.items.filter((i) => i.status === 'doing' && !i.isAdHoc);
export const adHocDoing = () => state.items.filter((i) => i.status === 'doing' && i.isAdHoc);
export const runningEntry = (item) => item?.timeLog.find((e) => !e.end) || null;
export const runningItem = () => state.items.find((i) => runningEntry(i)) || null;

export const canAddReady = (excludeId) =>
  items('ready').filter((i) => i.id !== excludeId).length < LIMITS.ready;
export const canStartRegular = () => regularDoing().length < LIMITS.doing;
export const canStartAdHoc = () => adHocDoing().length < LIMITS.adHoc;

export function spentMs(item, now = Date.now()) {
  return item.timeLog.reduce((sum, e) => {
    const end = e.end ? Date.parse(e.end) : now;
    return sum + Math.max(0, end - Date.parse(e.start));
  }, 0);
}

/** Time tracked and items completed since Monday 00:00. */
export function weekStats(now = Date.now()) {
  const weekStart = startOfWeek(new Date(now)).getTime();
  let ms = 0;
  let done = 0;
  for (const item of state.items) {
    for (const e of item.timeLog) {
      const start = Math.max(Date.parse(e.start), weekStart);
      const end = e.end ? Date.parse(e.end) : now;
      if (end > start) ms += end - start;
    }
    if (item.completedAt && Date.parse(item.completedAt) >= weekStart &&
        (item.status === 'done' || item.status === 'archived')) done += 1;
  }
  return { ms, done };
}

export function nextColor() {
  const used = new Set(state.projects.map((p) => p.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[state.projects.length % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function need(item, ...statuses) {
  if (!item) throw new RuleError('Item not found — it may have been deleted.');
  if (statuses.length && !statuses.includes(item.status)) {
    throw new RuleError(`That action isn't available for items in ${item.status}.`);
  }
}

function baseItem(fields) {
  return {
    id: uid('item'),
    title: fields.title.trim(),
    projectId: fields.projectId || null,
    status: 'backlog',
    isAdHoc: false,
    notes: (fields.notes || '').trim(),
    definitionOfDone: '',
    timeEstimateHours: null,
    dueDate: fields.dueDate ? String(fields.dueDate).trim() : null,
    timeLog: [],
    createdAt: nowIso(),
    movedToReadyAt: null,
    movedToDoingAt: null,
    completedAt: null,
    archivedAt: null,
    somedayAt: null,
  };
}

function applyEdits(item, f) {
  if (f.title !== undefined) item.title = String(f.title).trim();
  if (f.notes !== undefined) item.notes = String(f.notes).trim();
  if (f.projectId !== undefined) item.projectId = f.projectId || null;
  if (f.dueDate !== undefined) item.dueDate = f.dueDate ? String(f.dueDate).trim() : null;
}

function validateScope({ definitionOfDone, timeEstimateHours, dueDate }, required) {
  const dod = String(definitionOfDone ?? '').trim();
  const raw = timeEstimateHours;
  const est = raw === '' || raw === null || raw === undefined ? null : Number(raw);
  if (required && !dod) {
    throw new RuleError("Write a Definition of Done — what will you have when this is finished?");
  }
  if (est !== null && (!Number.isFinite(est) || est <= 0)) {
    throw new RuleError('The time estimate must be a positive number of hours.');
  }
  if (required && est === null) throw new RuleError('Add a time estimate (in hours).');
  const due = dueDate ? String(dueDate).trim() : null;
  return { definitionOfDone: dod, timeEstimateHours: est, dueDate: due };
}

function requireTitle(title) {
  const t = String(title ?? '').trim();
  if (!t) throw new RuleError('Give it a title.');
  return t;
}

function moveToTopOfBacklog(item) {
  state.items.splice(state.items.indexOf(item), 1);
  state.items.unshift(item);
}

/** Stop the item's running entry; drop accidental sub-5-second entries. */
function stopTimerInternal(item) {
  const entry = runningEntry(item);
  if (!entry) return;
  entry.end = nowIso();
  if (Date.parse(entry.end) - Date.parse(entry.start) < 5000) {
    item.timeLog = item.timeLog.filter((e) => e !== entry);
  }
}

/** Only one timer runs at a time — starting one pauses any other. */
function startTimerInternal(item) {
  for (const other of state.items) if (other !== item) stopTimerInternal(other);
  if (!runningEntry(item)) {
    item.timeLog.push({ id: uid('log'), start: nowIso(), end: null, manual: false });
  }
}

function leaveDoing(item) {
  stopTimerInternal(item);
  item.isAdHoc = false;
}

function validateTimeLog(item, entries) {
  const now = Date.now();
  const out = entries.map((e) => ({
    id: e.id || uid('log'),
    start: e.start,
    end: e.end ?? null,
    manual: !!e.manual,
  }));
  for (const e of out) {
    const s = Date.parse(e.start);
    if (!e.start || Number.isNaN(s)) throw new RuleError('Every time entry needs a valid start.');
    if (e.end === null) {
      if (item.status !== 'doing') throw new RuleError('Only items in Doing can have a running timer.');
      const other = runningItem();
      if (other && other.id !== item.id) throw new RuleError(`Another timer is running on “${other.title}”.`);
      if (s > now) throw new RuleError('A running entry cannot start in the future.');
    } else {
      const en = Date.parse(e.end);
      if (!e.end || Number.isNaN(en)) throw new RuleError('Every finished entry needs a valid end.');
      if (en <= s) throw new RuleError('Each time entry must end after it starts.');
      if (en > now + 60000) throw new RuleError('Time entries cannot end in the future.');
    }
  }
  if (out.filter((e) => e.end === null).length > 1) throw new RuleError('Only one entry can be running.');
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  for (let k = 1; k < out.length; k += 1) {
    const prevEnd = out[k - 1].end ? Date.parse(out[k - 1].end) : now;
    if (Date.parse(out[k].start) < prevEnd) {
      throw new RuleError("Time entries overlap — adjust them so time isn't double-counted.");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function addProject(name, color) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new RuleError('Name the new project.');
  const existing = state.projects.find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  return commit(() => {
    const project = { id: uid('proj'), name: clean, color: color || nextColor() };
    state.projects.push(project);
    return project;
  });
}

export function createBacklogItem({ title, notes = '', projectId = null }) {
  requireTitle(title);
  return commit(() => {
    const item = baseItem({ title, notes, projectId });
    state.items.unshift(item); // freshest ideas on top; drag to prioritize
    return item;
  });
}

/** Backlog → Ready (scoping), or Doing → Ready (sending back). */
export function promoteToReady(id, fields) {
  const item = getItem(id);
  need(item, 'backlog', 'doing');
  if (!canAddReady(id)) throw new RuleError(MSG.readyFull);
  if (fields.title !== undefined) requireTitle(fields.title);
  const scope = validateScope(fields, true);
  return commit(() => {
    if (item.status === 'doing') leaveDoing(item);
    applyEdits(item, fields);
    Object.assign(item, scope, { status: 'ready', movedToReadyAt: nowIso() });
  });
}

/** Ready → Doing (regular slot). Starts the timer. */
export function startWork(id) {
  const item = getItem(id);
  need(item, 'ready');
  if (!canStartRegular()) throw new RuleError(MSG.doingFull);
  return commit(() => {
    Object.assign(item, { status: 'doing', isAdHoc: false, movedToDoingAt: nowIso() });
    startTimerInternal(item);
  });
}

/** New emergency, or Backlog item → the dedicated ad-hoc slot. Starts the timer. */
export function startAdHoc(fields, existingId = null) {
  if (!canStartAdHoc()) throw new RuleError(MSG.adHocFull);
  const existing = existingId ? getItem(existingId) : null;
  if (existingId) need(existing, 'backlog');
  if (!existing || fields.title !== undefined) requireTitle(fields.title);
  const scope = validateScope(fields, false);
  return commit(() => {
    let item = existing;
    if (!item) {
      item = baseItem({ title: fields.title });
      state.items.unshift(item);
    }
    applyEdits(item, fields);
    Object.assign(item, scope, { status: 'doing', isAdHoc: true, movedToDoingAt: nowIso() });
    startTimerInternal(item);
    return item;
  });
}

export function toggleTimer(id) {
  const item = getItem(id);
  need(item, 'doing');
  return commit(() => {
    if (runningEntry(item)) {
      stopTimerInternal(item);
      return false;
    }
    startTimerInternal(item);
    return true;
  });
}

export function completeItem(id) {
  const item = getItem(id);
  need(item, 'doing');
  return commit(() => {
    stopTimerInternal(item);
    Object.assign(item, { status: 'done', completedAt: nowIso() });
  });
}

/** Done → Doing, back into the same kind of slot it came from. */
export function reopenItem(id) {
  const item = getItem(id);
  need(item, 'done');
  if (item.isAdHoc ? !canStartAdHoc() : !canStartRegular()) {
    throw new RuleError(item.isAdHoc ? MSG.adHocFull : MSG.doingFull);
  }
  return commit(() => {
    Object.assign(item, { status: 'doing', completedAt: null, movedToDoingAt: nowIso() });
  });
}

export function sendToBacklog(id) {
  const item = getItem(id);
  need(item, 'ready', 'doing');
  return commit(() => {
    if (item.status === 'doing') leaveDoing(item);
    item.status = 'backlog';
    moveToTopOfBacklog(item);
  });
}

export function sendToSomeday(id) {
  const item = getItem(id);
  need(item, 'backlog', 'ready', 'doing');
  return commit(() => {
    if (item.status === 'doing') leaveDoing(item);
    Object.assign(item, { status: 'someday', somedayAt: nowIso() });
  });
}

export function restoreFromSomeday(id) {
  const item = getItem(id);
  need(item, 'someday');
  return commit(() => {
    Object.assign(item, { status: 'backlog', somedayAt: null });
    moveToTopOfBacklog(item);
  });
}

export function deleteItem(id) {
  need(getItem(id));
  return commit(() => {
    state.items = state.items.filter((i) => i.id !== id);
  });
}

/** Weekly reset: Done → Archive. Returns how many items were archived. */
export function archiveDone() {
  const done = items('done');
  if (!done.length) throw new RuleError('Nothing to archive yet.');
  return commit(() => {
    const at = nowIso();
    done.forEach((i) => Object.assign(i, { status: 'archived', archivedAt: at }));
    return done.length;
  });
}

/** Reorder within Backlog. targetId=null drops after the last backlog item. */
export function reorderBacklog(dragId, targetId, after) {
  if (dragId === targetId) return;
  const from = state.items.findIndex((i) => i.id === dragId);
  if (from < 0) return;
  commit(() => {
    const [moved] = state.items.splice(from, 1);
    let to;
    if (targetId) {
      to = state.items.findIndex((i) => i.id === targetId);
      if (to < 0) to = state.items.length;
      else if (after) to += 1;
    } else {
      to = 0;
      state.items.forEach((i, k) => {
        if (i.status === 'backlog') to = k + 1;
      });
    }
    state.items.splice(to, 0, moved);
  });
}

/** Edit fields (and optionally replace the time log) in one atomic save. */
export function updateItem(id, fields, timeLog) {
  const item = getItem(id);
  need(item);
  if (fields.title !== undefined) requireTitle(fields.title);
  let scope = null;
  if ('definitionOfDone' in fields || 'timeEstimateHours' in fields || 'dueDate' in fields) {
    scope = validateScope(
      {
        definitionOfDone: fields.definitionOfDone ?? item.definitionOfDone,
        timeEstimateHours: fields.timeEstimateHours ?? item.timeEstimateHours,
        dueDate: fields.dueDate ?? item.dueDate,
      },
      item.status === 'ready',
    );
  }
  const log = timeLog !== undefined ? validateTimeLog(item, timeLog) : null;
  return commit(() => {
    applyEdits(item, fields);
    if (scope) Object.assign(item, scope);
    if (log) item.timeLog = log;
  });
}

/**
 * Adjust an item's time entries to match a target duration (in ms)
 * without creating overlaps or timestamps in the future.
 */
export function calculateAdjustedTimeLog(entries, targetMs) {
  const target = Math.max(0, Math.round(Number(targetMs) || 0));
  if (target === 0) return [];

  const now = Date.now();
  const out = entries
    .filter((e) => e.start && e.end)
    .map((e) => ({ ...e, manual: true }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  if (!out.length) {
    const endIso = new Date(now).toISOString();
    const startIso = new Date(now - target).toISOString();
    return [{ id: uid('log'), start: startIso, end: endIso, manual: true }];
  }

  const durationOf = (e) => Math.max(0, Date.parse(e.end) - Date.parse(e.start));
  const currentTotal = out.reduce((sum, e) => sum + durationOf(e), 0);
  const delta = target - currentTotal;

  if (delta === 0) return out;

  if (delta > 0) {
    const last = out[out.length - 1];
    const newLastEnd = Date.parse(last.end) + delta;

    if (newLastEnd <= now) {
      last.end = new Date(newLastEnd).toISOString();
    } else {
      const prevEnd = out.length > 1 ? Date.parse(out[out.length - 2].end) : 0;
      const neededDuration = durationOf(last) + delta;
      const latestEnd = now;
      const earliestStart = latestEnd - neededDuration;
      if (earliestStart > prevEnd) {
        last.start = new Date(earliestStart).toISOString();
        last.end = new Date(latestEnd).toISOString();
      } else {
        last.end = new Date(now).toISOString();
        last.start = new Date(Math.max(prevEnd + 1000, now - neededDuration)).toISOString();
      }
    }
    return out;
  }

  // delta < 0: trim from most recent entry backwards
  let toRemove = -delta;
  for (let i = out.length - 1; i >= 0; i--) {
    const dur = durationOf(out[i]);
    if (dur <= toRemove) {
      toRemove -= dur;
      out.splice(i, 1);
    } else {
      const newDur = dur - toRemove;
      out[i].end = new Date(Date.parse(out[i].start) + newDur).toISOString();
      toRemove = 0;
      break;
    }
  }

  if (!out.length && target > 0) {
    out.push({
      id: uid('log'),
      start: new Date(now - target).toISOString(),
      end: new Date(now).toISOString(),
      manual: true,
    });
  }

  return out;
}

/** Manually set total tracked time when timer is stopped. */
export function setTrackedTime(id, targetMs) {
  const item = getItem(id);
  need(item);
  if (runningEntry(item)) {
    throw new RuleError('Pause the timer before manually editing tracked time.');
  }
  const adjustedLog = calculateAdjustedTimeLog(item.timeLog, targetMs);
  return updateItem(id, {}, adjustedLog);
}

