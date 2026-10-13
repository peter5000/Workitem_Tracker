/** App shell: routing, header (running timer + weekly stats), project filter, 1s tick. */
import * as store from './store.js';
import { renderBoard, renderSomeday, renderArchive, updateTimers, bindViewEvents } from './views.js';
import { toast, attempt } from './ui.js';
import { esc, fmtClock, fmtDuration } from './utils.js';

const BASE_TITLE = 'Workitem Tracker — Focused Personal Kanban';
const VIEWS = ['board', 'someday', 'archive'];
const FILTER_KEY = 'wt:filter';

const viewEl = document.getElementById('view');
const filterBar = document.getElementById('filter-bar');
const weekEl = document.getElementById('week-stats');
const runningEl = document.getElementById('running-indicator');
const saveEl = document.getElementById('save-status');

let filter = localStorage.getItem(FILTER_KEY) || null;
let runningId = null;

const currentView = () => {
  const v = location.hash.replace(/^#\/?/, '');
  return VIEWS.includes(v) ? v : 'board';
};

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------
function renderFilterBar() {
  const { projects, items } = store.getState();
  if (!projects.length) {
    filterBar.hidden = true;
    return;
  }
  filterBar.hidden = false;
  const active = items.filter((i) => ['backlog', 'ready', 'doing', 'done'].includes(i.status));
  const chip = (id, name, color, n) => `
    <button type="button" class="fchip${filter === id ? ' fchip--on' : ''}" data-filter="${esc(id ?? '')}"
      aria-pressed="${filter === id}" style="--c:${esc(color || 'var(--accent)')}">
      ${color ? '<span class="badge__dot"></span>' : ''}${esc(name)}<span class="fchip__n">${n}</span>
    </button>`;
  filterBar.innerHTML = `
    <span class="filterbar__label">Projects</span>
    ${chip(null, 'All', null, active.length)}
    ${projects.map((p) => chip(p.id, p.name, p.color, active.filter((i) => i.projectId === p.id).length)).join('')}
    ${filter ? '<span class="filterbar__note">Filtered view — WIP limits still count every project.</span>' : ''}`;
}

function renderRunning(force = false) {
  const item = store.runningItem();
  if (!item) {
    if (runningId !== null || force) {
      runningEl.hidden = true;
      runningEl.innerHTML = '';
      runningId = null;
    }
    document.title = BASE_TITLE;
    return;
  }
  const clock = fmtClock(store.spentMs(item));
  if (force || runningId !== item.id) {
    runningId = item.id;
    runningEl.hidden = false;
    runningEl.innerHTML = `
      <span class="running__dot" aria-hidden="true"></span>
      <span class="running__title" title="${esc(item.title)}">${esc(item.title)}</span>
      <span class="running__clock" data-timer="${esc(item.id)}">${clock}</span>
      <button type="button" class="icon-btn running__pause" id="running-pause" aria-label="Pause timer">⏸</button>`;
    runningEl.querySelector('#running-pause')
      .addEventListener('click', () => attempt(() => store.toggleTimer(item.id)));
  }
  document.title = `⏱ ${clock} · ${item.title}`;
}

function renderWeek() {
  const { ms, done } = store.weekStats();
  weekEl.innerHTML = `
    <span title="Time tracked since Monday">⏱ <strong>${fmtDuration(ms)}</strong> this week</span>
    <span class="dotsep" aria-hidden="true">·</span>
    <span title="Items completed since Monday">✔ <strong>${done}</strong> done</span>`;
}

function tick() {
  updateTimers();
  renderRunning();
  renderWeek();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render() {
  if (filter && !store.getProject(filter)) filter = null;
  const v = currentView();
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.view === v) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  const somedayCount = store.items('someday').length;
  document.getElementById('someday-count').textContent = somedayCount || '';

  renderFilterBar();
  if (v === 'board') renderBoard(viewEl, filter);
  else if (v === 'someday') renderSomeday(viewEl, filter);
  else renderArchive(viewEl, filter);
  viewEl.dataset.view = v;

  renderRunning(true);
  renderWeek();
  updateTimers();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter || null;
  if (filter) localStorage.setItem(FILTER_KEY, filter);
  else localStorage.removeItem(FILTER_KEY);
  render();
});

store.onSaveStatus((status, message) => {
  saveEl.dataset.state = status;
  saveEl.textContent = { saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[status] || '';
  if (status === 'error') toast(`Couldn't save: ${message}`, 'error', 5000);
});

// "N" → jump to quick capture
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  if (currentView() !== 'board') location.hash = '#/board';
  requestAnimationFrame(() => document.getElementById('capture-title')?.focus());
});

async function init() {
  bindViewEvents(viewEl);
  store.subscribe(render);
  window.addEventListener('hashchange', render);
  try {
    await store.load();
  } catch (err) {
    viewEl.innerHTML = `
      <div class="empty-state empty-state--fatal">
        <span class="empty-state__icon">⚠️</span>
        <p><strong>Couldn't load your board.</strong><br>${esc(err.message)}</p>
        <p class="dim">Is the server running? Start it with <code>npm start</code>.</p>
      </div>`;
    return;
  }
  setInterval(tick, 1000);
}

init();
