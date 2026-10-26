/** Renders the three pages and handles all in-view interactions via delegation. */
import * as store from './store.js';
import { LIMITS, MSG } from './store.js';
import { esc, fmtClock, fmtDuration, fmtHours, fmtDate, endOfDay, relDays, daysSince, startOfWeek } from './utils.js';
import { projectPicker, openMenu, confirmModal, toast, attempt, lastProject, rememberProject } from './ui.js';
import { openScopeModal, openCompleteModal, openDetailsModal, openEditTimerModal } from './modals.js';

let seen = new Map(); // item id → status at last board render (animate only what moved)
let capturePicker = null;
let currentFilter = null;

const visible = (item) => !currentFilter || item.projectId === currentFilter;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------
function projectBadge(projectId) {
  const p = store.getProject(projectId);
  if (!p) return '';
  return `<span class="badge" style="--c:${esc(p.color)}"><span class="badge__dot"></span>${esc(p.name)}</span>`;
}

function actionBtn(action, id, label, { variant = 'primary', blocked = null } = {}) {
  return `<button type="button" class="btn btn--sm btn--${variant}" data-action="${action}" data-id="${esc(id)}"${
    blocked ? ` aria-disabled="true" title="${esc(blocked)}"` : ''}>${label}</button>`;
}

function pips(used, max, extra = '') {
  return `<span class="pips" aria-hidden="true">${Array.from({ length: max }, (_, k) =>
    `<span class="pip${k < used ? ' pip--on' : ''}${extra ? ` ${extra}` : ''}"></span>`).join('')}</span>`;
}

function deltaHtml(spent, estHours) {
  if (!estHours) return '';
  const diff = spent - estHours * 3600000;
  if (Math.abs(diff) <= estHours * 3600000 * 0.15) return '<span class="delta delta--ok">on target</span>';
  return diff > 0
    ? `<span class="delta delta--over">+${fmtDuration(diff)} over</span>`
    : `<span class="delta delta--under">${fmtDuration(-diff)} under</span>`;
}

function progressOf(item, now = Date.now()) {
  const est = item.timeEstimateHours;
  if (!est) return { pct: 0, cls: '' };
  const ratio = store.spentMs(item, now) / (est * 3600000);
  let cls = '';
  if (ratio > 1) cls = ' progress__bar--over';
  else if (ratio > 0.8) cls = ' progress__bar--warn';
  return { pct: Math.min(100, ratio * 100), cls };
}

const emptyHint = (text) => `<p class="empty-hint">${esc(text)}</p>`;

export function dueChip(item, now = Date.now()) {
  if (!item.dueDate) return '';
  const due = endOfDay(item.dueDate);
  const isOverdue = !['done', 'archived'].includes(item.status) && due && due.getTime() < now;
  const formatted = fmtDate(item.dueDate);
  if (isOverdue) return `<span class="chip chip--overdue" title="Overdue!">📅 Overdue (${formatted})</span>`;
  return `<span class="chip">📅 ${formatted}</span>`;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
function cardHtml(item, idx = 0) {
  const s = item.status;
  const id = esc(item.id);
  const running = !!store.runningEntry(item);
  const cls = ['card', `card--${s}`];
  if (s === 'backlog') cls.push('card--draggable');
  if (item.isAdHoc) cls.push('card--adhoc');
  if (running) cls.push('card--running');
  if (seen.get(item.id) !== s) cls.push('card--enter');

  const top = `
    <div class="card__top">
      ${s === 'backlog' ? '<span class="card__grip" title="Drag to reprioritize" aria-hidden="true">⠿</span>' : ''}
      ${projectBadge(item.projectId)}
      ${item.isAdHoc ? '<span class="badge badge--fire">🔥 Ad-hoc</span>' : ''}
      <button type="button" class="icon-btn card__menu" data-action="menu" data-id="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(item.title)}">⋯</button>
    </div>
    <h3 class="card__heading"><button type="button" class="card__title" data-action="details" data-id="${id}">${esc(item.title)}</button></h3>`;

  const dod = item.definitionOfDone
    ? `<div class="card__dod${s === 'done' ? ' card__dod--met' : ''}"><span class="card__label">${s === 'done' ? '✓ Achieved' : '🎯 Done when'}</span><p>${esc(item.definitionOfDone)}</p></div>`
    : '';
  const est = item.timeEstimateHours ? `<span class="chip">⏱ ${fmtHours(item.timeEstimateHours)} est</span>` : '';
  const due = dueChip(item);

  let body = '';
  let actions = '';
  if (s === 'backlog') {
    body = (due ? `<div class="card__meta">${due}</div>` : '') + (item.notes ? `<p class="card__notes">${esc(item.notes)}</p>` : '');
    actions = actionBtn('scope', item.id, 'Scope → Ready', { blocked: store.canAddReady(item.id) ? null : MSG.readyFull });
  } else if (s === 'ready') {
    const spent = store.spentMs(item);
    const meta = est + due + (spent ? `<span class="chip">${fmtDuration(spent)} logged</span>` : '');
    body = dod + (meta ? `<div class="card__meta">${meta}</div>` : '');
    actions = actionBtn('start', item.id, '▶ Start', { blocked: store.canStartRegular() ? null : MSG.doingFull });
  } else if (s === 'doing') {
    const p = progressOf(item);
    const stale = item.movedToDoingAt && daysSince(item.movedToDoingAt) > LIMITS.staleDoingDays;
    body = dod + `
      <div class="timer${running ? ' timer--live' : ' timer--stopped'}">
        ${running ? `
          <span class="timer__clock" data-timer="${id}">${fmtClock(store.spentMs(item))}</span>
        ` : `
          <button type="button" class="timer__clock timer__clock--editable" data-action="edit-timer" data-id="${id}" title="Timer is stopped — click to edit time" aria-label="Edit tracked time for ${esc(item.title)}">
            <span data-timer="${id}">${fmtClock(store.spentMs(item))}</span>
            <span class="timer__edit-badge" aria-hidden="true">✎</span>
          </button>
        `}
        ${item.timeEstimateHours ? `<span class="timer__est">of ${fmtHours(item.timeEstimateHours)} est</span>` : ''}
      </div>
      ${item.timeEstimateHours ? `<div class="progress" aria-hidden="true"><div class="progress__bar${p.cls}" data-progress="${id}" style="width:${p.pct}%"></div></div>` : ''}
      ${due ? `<div class="card__meta">${due}</div>` : ''}
      ${stale ? `<p class="nudge nudge--inline">⚠ In Doing for ${daysSince(item.movedToDoingAt)} days — slice it, kill scope, or send it back.</p>` : ''}`;
    actions = actionBtn('timer', item.id, running ? '⏸ Pause' : '▶ Resume', { variant: 'ghost' })
      + actionBtn('complete', item.id, '✔ Done', { variant: 'success' });
  } else if (s === 'done') {
    const spent = store.spentMs(item);
    body = dod + `<div class="card__meta"><span class="chip chip--success">⏱ ${fmtDuration(spent)}</span>${est}${due}${deltaHtml(spent, item.timeEstimateHours)}</div>`;
    actions = item.completedAt ? `<span class="card__stamp">Completed ${esc(fmtDate(item.completedAt))}</span>` : '';
  }

  return `<article class="${cls.join(' ')}" data-id="${id}"${s === 'backlog' ? ' draggable="true"' : ''} style="--i:${idx}">
    ${top}${body}${actions ? `<div class="card__actions">${actions}</div>` : ''}
  </article>`;
}

function menuFor(item) {
  const id = item.id;
  const s = item.status;
  const entries = [];
  const toReady = () => (item.definitionOfDone && item.timeEstimateHours
    ? attempt(() => store.promoteToReady(id, { definitionOfDone: item.definitionOfDone, timeEstimateHours: item.timeEstimateHours }))
    : openScopeModal(item, { mode: 'ready' }));

  if (s === 'backlog') {
    entries.push({ label: '🔥 Handle as ad-hoc', disabled: !store.canStartAdHoc(), reason: MSG.adHocFull, run: () => openScopeModal(item, { mode: 'adhoc' }) });
  }
  if (s === 'ready') {
    entries.push({ label: '← Back to Backlog', run: () => attempt(() => store.sendToBacklog(id)) });
  }
  if (s === 'doing') {
    if (!running) {
      entries.push({ label: '⏱ Adjust tracked time', run: () => openEditTimerModal(item) });
    }
    entries.push({ label: '← Back to Ready', disabled: !store.canAddReady(id), reason: MSG.readyFull, run: toReady });
    entries.push({ label: '← Back to Backlog', run: () => attempt(() => store.sendToBacklog(id)) });
  }
  if (s === 'done') {
    const blocked = item.isAdHoc ? !store.canStartAdHoc() : !store.canStartRegular();
    entries.push({ label: '↺ Reopen in Doing', disabled: blocked, reason: item.isAdHoc ? MSG.adHocFull : MSG.doingFull, run: () => attempt(() => store.reopenItem(id)) });
  }
  if (['backlog', 'ready', 'doing'].includes(s)) {
    entries.push({ label: '💤 Send to Someday', run: () => attempt(() => { store.sendToSomeday(id); toast('Shelved in Someday', 'info'); }) });
  }
  entries.push({ sep: true });
  entries.push({ label: s === 'doing' || s === 'done' ? '✎ Edit & time log' : '✎ Edit details', run: () => openDetailsModal(item) });
  entries.push({ label: '🗑 Delete', danger: true, run: () => confirmDelete(item) });
  return entries;
}

async function confirmDelete(item) {
  const ok = await confirmModal({
    title: 'Delete this item?',
    message: `“${item.title}” and its time log will be permanently removed. Consider Someday if you might want it later.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (ok) attempt(() => store.deleteItem(item.id));
}

async function archiveDone() {
  const n = store.items('done').length;
  const ok = await confirmModal({
    title: 'Archive completed items?',
    message: `Move ${plural(n, 'completed item')} to the Archive. You can review them and your time stats anytime on the Archive page.`,
    confirmLabel: 'Archive',
  });
  if (ok) {
    attempt(() => {
      const count = store.archiveDone();
      toast(`Archived ${plural(count, 'item')} — clean board, fresh week ✨`, 'success');
    });
  }
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
function columnHeader(key, title, hint, meta) {
  return `
    <header class="column__header">
      <div class="column__titles">
        <h2 class="column__title" id="col-${key}-title">${title}</h2>
        <span class="column__hint">${hint}</span>
      </div>
      <div class="column__meta">${meta}</div>
    </header>`;
}

export function renderBoard(root, filter) {
  currentFilter = filter;

  // Preserve an in-progress quick capture across re-renders.
  const prevInput = root.querySelector('#capture-title');
  const draft = prevInput?.value ?? '';
  const hadFocus = prevInput && document.activeElement === prevInput;

  const backlog = store.items('backlog');
  const ready = store.items('ready');
  const regular = store.regularDoing();
  const adhoc = store.adHocDoing()[0] || null;
  const done = store.items('done').sort((a, b) => Date.parse(b.completedAt || 0) - Date.parse(a.completedAt || 0));

  // Backlog — soft limit
  const bl = backlog.length;
  let blCls = '';
  if (bl >= LIMITS.backlogMax) blCls = 'count--danger';
  else if (bl >= LIMITS.backlogWarn) blCls = 'count--warn';
  const backlogVisible = backlog.filter(visible);
  const backlogCol = `
    <section class="column column--backlog" aria-labelledby="col-backlog-title">
      ${columnHeader('backlog', 'Backlog', 'Capture freely',
        `<span class="count ${blCls}" title="Soft limit — amber at ${LIMITS.backlogWarn}, red at ${LIMITS.backlogMax}">${bl}</span>`)}
      <form class="capture" id="capture-form" autocomplete="off">
        <input class="input capture__input" id="capture-title" maxlength="200" placeholder="Capture an idea…" aria-label="New backlog item title">
        <div class="capture__row">
          <div class="capture__project" data-slot="capture-project"></div>
          <button type="submit" class="btn btn--sm btn--primary" id="capture-submit">Add</button>
        </div>
      </form>
      ${bl >= LIMITS.backlogWarn ? `<p class="nudge${bl >= LIMITS.backlogMax ? ' nudge--danger' : ''}">Backlog is getting heavy (${bl}). Triage in your weekly review — shelve stale ideas in Someday.</p>` : ''}
      <div class="column__body" id="col-backlog" data-drop="backlog">
        ${backlogVisible.length ? backlogVisible.map(cardHtml).join('')
          : emptyHint(filter && bl ? 'No backlog items in this project.' : 'Nothing here yet. Dump every idea — sorting comes later.')}
      </div>
    </section>`;

  // Ready — hard limit
  const readyVisible = ready.filter(visible);
  const readyHidden = ready.length - readyVisible.length;
  const readyOpen = LIMITS.ready - ready.length;
  const readyCol = `
    <section class="column column--ready" aria-labelledby="col-ready-title">
      ${columnHeader('ready', 'Ready', 'Committed next',
        `${pips(ready.length, LIMITS.ready)}<span class="count${readyOpen <= 0 ? ' count--full' : ''}">${ready.length}/${LIMITS.ready}</span>`)}
      <div class="column__body" id="col-ready">
        ${readyVisible.map(cardHtml).join('')}
        ${readyHidden ? `<div class="slot slot--locked">🔒 ${plural(readyHidden, 'slot')} used by other projects</div>` : ''}
        ${readyOpen > 0
          ? `<div class="slot">${plural(readyOpen, 'open slot')} — scope something from Backlog</div>`
          : '<div class="slot slot--full">Ready is full. Start something or send an item back.</div>'}
      </div>
    </section>`;

  // Doing — 2 regular slots + 1 ad-hoc slot, hard limits
  const regVisible = regular.filter(visible);
  const regHidden = regular.length - regVisible.length;
  const regOpen = LIMITS.doing - regular.length;
  let adhocSlot;
  if (!adhoc) {
    adhocSlot = `<button type="button" class="slot slot--adhoc" id="btn-adhoc-new" data-action="adhoc-new">
        <span class="slot__main">＋ Handle a breaking change</span><span class="slot__sub">Bypasses Ready · max 1</span></button>`;
  } else {
    adhocSlot = visible(adhoc) ? cardHtml(adhoc) : '<div class="slot slot--locked">🔒 Ad-hoc slot in use by another project</div>';
  }
  const doingCol = `
    <section class="column column--doing" aria-labelledby="col-doing-title">
      ${columnHeader('doing', 'Doing', 'Focus',
        `${pips(regular.length, LIMITS.doing)}${pips(adhoc ? 1 : 0, LIMITS.adHoc, 'pip--fire')}<span class="count${regOpen <= 0 ? ' count--full' : ''}">${regular.length}/${LIMITS.doing}</span>`)}
      <div class="column__body" id="col-doing">
        ${regVisible.map(cardHtml).join('')}
        ${'<div class="slot slot--locked">🔒 Focus slot in use by another project</div>'.repeat(regHidden)}
        ${'<div class="slot">Open focus slot — pull from Ready</div>'.repeat(Math.max(0, regOpen))}
        <div class="divider divider--fire">🔥 Ad-hoc slot</div>
        ${adhocSlot}
      </div>
    </section>`;

  // Done — manual archive during weekly review
  const doneVisible = done.filter(visible);
  const doneCol = `
    <section class="column column--done" aria-labelledby="col-done-title">
      ${columnHeader('done', 'Done', 'This week\'s wins',
        `<span class="count">${done.length}</span>
         <button type="button" class="btn btn--sm btn--ghost" id="btn-archive-done" data-action="archive-done"${done.length ? '' : ' aria-disabled="true" title="Nothing to archive yet"'}>Archive</button>`)}
      <div class="column__body" id="col-done">
        ${doneVisible.length ? doneVisible.map(cardHtml).join('')
          : emptyHint('Finished items land here. Archive them during your weekly review.')}
      </div>
    </section>`;

  root.innerHTML = `<div class="board">${backlogCol}${readyCol}${doingCol}${doneCol}</div>`;

  capturePicker = projectPicker(filter || lastProject(), { compact: true });
  root.querySelector('[data-slot="capture-project"]').append(capturePicker.el);
  const input = root.querySelector('#capture-title');
  input.value = draft;
  if (hadFocus) input.focus();

  seen = new Map(store.getState().items.map((i) => [i.id, i.status]));
}

// ---------------------------------------------------------------------------
// Someday
// ---------------------------------------------------------------------------
export function renderSomeday(root, filter) {
  currentFilter = filter;
  const list = store.items('someday').filter(visible)
    .sort((a, b) => Date.parse(b.somedayAt || b.createdAt) - Date.parse(a.somedayAt || a.createdAt));

  const row = (item) => `
    <li class="list-row">
      <div class="list-row__main">
        <div class="list-row__badges">${projectBadge(item.projectId)}</div>
        <button type="button" class="list-row__title" data-action="details" data-id="${esc(item.id)}">${esc(item.title)}</button>
        ${item.notes ? `<p class="list-row__sub">${esc(item.notes)}</p>` : ''}
      </div>
      <span class="list-row__meta">Shelved ${esc(relDays(item.somedayAt || item.createdAt))}</span>
      <div class="list-row__actions">
        ${actionBtn('restore', item.id, '↩ Restore to Backlog', { variant: 'ghost' })}
        <button type="button" class="icon-btn icon-btn--danger" data-action="delete" data-id="${esc(item.id)}" aria-label="Delete ${esc(item.title)}">🗑</button>
      </div>
    </li>`;

  root.innerHTML = `
    <section class="page">
      <header class="page__header">
        <h2 class="page__title">💤 Someday</h2>
        <p class="page__lede">Cold storage for ideas that haven't earned a spot on the board. Review weekly — restore what matters, delete what doesn't.</p>
      </header>
      ${list.length ? `<ul class="list">${list.map(row).join('')}</ul>`
        : `<div class="empty-state"><span class="empty-state__icon">🌙</span><p>Nothing shelved${filter ? ' for this project' : ''}. Send stale ideas here from any card's ⋯ menu.</p></div>`}
    </section>`;
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------
export function renderArchive(root, filter) {
  currentFilter = filter;
  const list = store.items('archived').filter(visible);
  const when = (i) => Date.parse(i.completedAt || i.archivedAt);

  const totalMs = list.reduce((sum, i) => sum + store.spentMs(i), 0);
  const withEst = list.filter((i) => i.timeEstimateHours);
  const estMs = withEst.reduce((sum, i) => sum + i.timeEstimateHours * 3600000, 0);
  const actMs = withEst.reduce((sum, i) => sum + store.spentMs(i), 0);
  const accuracy = estMs ? Math.round((actMs / estMs) * 100) : null;
  let accuracyHint = 'Estimate more items to calibrate';
  if (accuracy !== null) {
    if (accuracy > 115) accuracyHint = 'You tend to underestimate';
    else if (accuracy < 85) accuracyHint = 'You tend to overestimate';
    else accuracyHint = 'Well calibrated 👌';
  }

  const groups = new Map();
  list.slice().sort((a, b) => when(b) - when(a)).forEach((i) => {
    const key = startOfWeek(new Date(when(i))).toISOString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });

  const stat = (value, label, hint = '') => `
    <div class="statcard">
      <span class="statcard__value">${esc(value)}</span>
      <span class="statcard__label">${esc(label)}</span>
      ${hint ? `<span class="statcard__hint">${esc(hint)}</span>` : ''}
    </div>`;

  const row = (item) => {
    const spent = store.spentMs(item);
    return `
      <li class="list-row list-row--archive">
        <div class="list-row__main">
          <div class="list-row__badges">${projectBadge(item.projectId)}${item.isAdHoc ? '<span class="badge badge--fire">🔥 Ad-hoc</span>' : ''}</div>
          <button type="button" class="list-row__title" data-action="details" data-id="${esc(item.id)}">${esc(item.title)}</button>
          ${item.definitionOfDone ? `<p class="list-row__sub">🎯 ${esc(item.definitionOfDone)}</p>` : ''}
        </div>
        <div class="list-row__nums">
          <span class="mono">${fmtDuration(spent)}</span>
          ${item.timeEstimateHours ? `<span class="dim">/ ${fmtHours(item.timeEstimateHours)} est</span>` : ''}
          ${deltaHtml(spent, item.timeEstimateHours)}
        </div>
        <span class="list-row__meta">${esc(fmtDate(item.completedAt || item.archivedAt))}</span>
      </li>`;
  };

  const week = ([key, items]) => `
    <section class="week">
      <header class="week__header">
        <h3 class="week__title">Week of ${esc(fmtDate(key, { month: 'short', day: 'numeric', year: 'numeric' }))}</h3>
        <span class="week__meta">${plural(items.length, 'item')} · ${fmtDuration(items.reduce((s, i) => s + store.spentMs(i), 0))}</span>
      </header>
      <ul class="list">${items.map(row).join('')}</ul>
    </section>`;

  root.innerHTML = `
    <section class="page">
      <header class="page__header">
        <h2 class="page__title">🗄 Archive</h2>
        <p class="page__lede">Everything you've shipped. Use it to calibrate estimates and see how much you actually get done.</p>
      </header>
      <div class="statgrid">
        ${stat(String(list.length), 'items shipped')}
        ${stat(fmtDuration(totalMs), 'time tracked')}
        ${stat(accuracy === null ? '—' : `${accuracy}%`, 'actual vs. estimate', accuracyHint)}
        ${stat(String(list.filter((i) => i.isAdHoc).length), 'ad-hoc interruptions')}
      </div>
      ${groups.size ? [...groups].map(week).join('')
        : '<div class="empty-state"><span class="empty-state__icon">🏁</span><p>No archived items yet. Finish work, then hit “Archive” on the Done column during your weekly review.</p></div>'}
    </section>`;
}

// ---------------------------------------------------------------------------
// Live timers (called every second — touches text only, never re-renders)
// ---------------------------------------------------------------------------
export function updateTimers() {
  const now = Date.now();
  document.querySelectorAll('[data-timer]').forEach((el) => {
    const item = store.getItem(el.dataset.timer);
    if (item) el.textContent = fmtClock(store.spentMs(item, now));
  });
  document.querySelectorAll('[data-progress]').forEach((el) => {
    const item = store.getItem(el.dataset.progress);
    if (!item) return;
    const p = progressOf(item, now);
    el.style.width = `${p.pct}%`;
    el.className = `progress__bar${p.cls}`;
  });
}

// ---------------------------------------------------------------------------
// Events (bound once on the persistent view root)
// ---------------------------------------------------------------------------
function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !e.currentTarget.contains(el)) return;
  if (el.getAttribute('aria-disabled') === 'true') {
    if (el.title) toast(el.title, 'warn');
    return;
  }
  const { action, id } = el.dataset;
  const item = id ? store.getItem(id) : null;
  if (id && !item) return;

  switch (action) {
    case 'menu': openMenu(el, menuFor(item)); break;
    case 'details': openDetailsModal(item); break;
    case 'scope': openScopeModal(item, { mode: 'ready' }); break;
    case 'start': attempt(() => { store.startWork(id); toast('Focus on — timer started ▶', 'info'); }); break;
    case 'timer': attempt(() => store.toggleTimer(id)); break;
    case 'edit-timer': openEditTimerModal(item); break;
    case 'complete': openCompleteModal(item); break;
    case 'adhoc-new': openScopeModal(null, { mode: 'adhoc' }); break;
    case 'archive-done': archiveDone(); break;
    case 'restore': attempt(() => { store.restoreFromSomeday(id); toast('Restored to Backlog', 'success'); }); break;
    case 'delete': confirmDelete(item); break;
    default: break;
  }
}

function onSubmit(e) {
  if (e.target.id !== 'capture-form') return;
  e.preventDefault();
  const title = e.target.querySelector('#capture-title').value;
  if (!title.trim()) return;
  attempt(() => {
    const projectId = capturePicker?.resolve() ?? null;
    rememberProject(projectId);
    store.createBacklogItem({ title, projectId });
    const input = document.getElementById('capture-title');
    if (input) {
      input.value = '';
      input.focus();
    }
  });
}

function bindBacklogDnD(root) {
  let dragId = null;
  const clearMarks = () => root.querySelectorAll('.drop-before, .drop-after, .drop-end')
    .forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-end'));
  const placement = (card, y) => {
    const r = card.getBoundingClientRect();
    return y > r.top + r.height / 2;
  };

  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.card--draggable');
    if (!card) return;
    dragId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => card.classList.add('card--dragging'));
  });
  root.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const list = e.target.closest('[data-drop="backlog"]');
    if (!list) return;
    e.preventDefault();
    clearMarks();
    const card = e.target.closest('.card--draggable');
    if (card && card.dataset.id !== dragId) card.classList.add(placement(card, e.clientY) ? 'drop-after' : 'drop-before');
    else if (!card) list.classList.add('drop-end');
  });
  root.addEventListener('drop', (e) => {
    if (!dragId) return;
    const list = e.target.closest('[data-drop="backlog"]');
    if (!list) return;
    e.preventDefault();
    const id = dragId;
    dragId = null;
    clearMarks();
    const card = e.target.closest('.card--draggable');
    if (card && card.dataset.id !== id) attempt(() => store.reorderBacklog(id, card.dataset.id, placement(card, e.clientY)));
    else if (!card) attempt(() => store.reorderBacklog(id, null, true));
  });
  root.addEventListener('dragend', () => {
    dragId = null;
    clearMarks();
    root.querySelectorAll('.card--dragging').forEach((c) => c.classList.remove('card--dragging'));
  });
}

function onDblClick(e) {
  const card = e.target.closest('.card, .list-row');
  if (!card) return;
  if (e.target.closest('button, input, select, textarea, a, .card__menu')) return;
  const id = card.dataset.id;
  const item = id ? store.getItem(id) : null;
  if (item) openDetailsModal(item);
}

export function bindViewEvents(root) {
  root.addEventListener('click', onClick);
  root.addEventListener('dblclick', onDblClick);
  root.addEventListener('submit', onSubmit);
  bindBacklogDnD(root);
}
