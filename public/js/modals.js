/** Item-specific dialogs: scoping (→ Ready / ad-hoc), completing, and editing + time log. */
import * as store from './store.js';
import { esc, uid, fmtClock, fmtDuration, fmtHours, fmtDate, toLocalInput, fromLocalInput } from './utils.js';
import { openModal, projectPicker, toast, lastProject, rememberProject } from './ui.js';

const val = (form, name) => form.querySelector(`[name="${name}"]`)?.value ?? '';

const STATUS_LABEL = {
  backlog: 'Backlog', ready: 'Ready', doing: 'Doing', done: 'Done', someday: 'Someday', archived: 'Archived',
};

function estimateField(value, optional) {
  return `
    <div class="field">
      <span class="field__label">⏱ Time estimate (hours)${optional ? ' <span class="opt">optional</span>' : ''}</span>
      <div class="estimate">
        <input class="input input--num" type="number" name="est" min="0.25" step="0.25" inputmode="decimal" placeholder="2" value="${esc(value ?? '')}">
        <div class="chips">${[0.5, 1, 2, 3, 4].map((h) => `<button type="button" class="chip chip--btn" data-est="${h}">${fmtHours(h)}</button>`).join('')}</div>
      </div>
      <span class="field__hint" data-est-hint></span>
    </div>`;
}

/** Wire the quick-pick chips and the "over 4h = epic" granularity nudge. */
function wireEstimate(root) {
  const input = root.querySelector('[name="est"]');
  const hint = root.querySelector('[data-est-hint]');
  if (!input) return;
  const update = () => {
    const over = Number(input.value) > 4;
    hint.textContent = over ? 'Over 4 hours? Consider slicing it — big items are epics in disguise.' : '';
    hint.classList.toggle('field__hint--warn', over);
  };
  input.addEventListener('input', update);
  root.querySelectorAll('[data-est]').forEach((b) => b.addEventListener('click', () => {
    input.value = b.dataset.est;
    update();
  }));
  update();
}

function dodField(value, optional, autofocus) {
  return `
    <label class="field">
      <span class="field__label">🎯 Definition of Done${optional ? ' <span class="opt">optional</span>' : ''}</span>
      <textarea class="input" name="dod" rows="3" maxlength="1000" ${autofocus ? 'autofocus' : ''}
        placeholder="e.g. I can capture an idea in under 3 seconds and it survives a server restart.">${esc(value || '')}</textarea>
      <span class="field__hint">What should be done — and what you'll <em>have</em> once it is.</span>
    </label>`;
}

function dueDateField(value) {
  return `
    <label class="field">
      <span class="field__label">📅 Due date <span class="opt">optional</span></span>
      <input class="input" type="date" name="dueDate" value="${esc(value || '')}">
    </label>`;
}

// ---------------------------------------------------------------------------
// Scope → Ready  /  🔥 Ad-hoc
// ---------------------------------------------------------------------------
export function openScopeModal(item, { mode = 'ready' } = {}) {
  const adhoc = mode === 'adhoc';
  const isNew = !item;
  const body = document.createElement('div');
  body.className = 'form-stack';
  body.innerHTML = `
    ${adhoc
      ? '<p class="callout callout--fire">🔥 Ad-hoc is reserved for breaking changes and true emergencies. It uses the dedicated 3rd slot, bypasses Ready, and the timer starts immediately.</p>'
      : '<p class="callout">Scoping turns an idea into a plan. Describe the outcome — what you\'ll <em>have</em> when it\'s finished — so future-you knows exactly when to stop.</p>'}
    <label class="field">
      <span class="field__label">Title</span>
      <input class="input" name="title" maxlength="200" value="${esc(item?.title || '')}" ${isNew ? 'autofocus' : ''}>
    </label>
    <div class="field"><span class="field__label">Project</span><div data-slot="project"></div></div>
    ${dodField(item?.definitionOfDone, adhoc, !isNew)}
    ${estimateField(item?.timeEstimateHours, adhoc)}
    ${dueDateField(item?.dueDate)}
    <label class="field">
      <span class="field__label">Notes <span class="opt">optional</span></span>
      <textarea class="input" name="notes" rows="2" maxlength="4000">${esc(item?.notes || '')}</textarea>
    </label>`;

  const picker = projectPicker(item ? item.projectId : lastProject());
  body.querySelector('[data-slot="project"]').append(picker.el);
  wireEstimate(body);

  let title = 'Scope → Ready';
  if (adhoc) title = isNew ? '🔥 New ad-hoc item' : '🔥 Handle as ad-hoc';
  else if (item.status === 'doing') title = 'Send back to Ready';

  openModal({
    title,
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: adhoc ? '▶ Start now' : 'Move to Ready',
        primary: true,
        variant: adhoc ? 'fire' : 'primary',
        onClick: ({ form }) => {
          const fields = {
            title: val(form, 'title'),
            notes: val(form, 'notes'),
            definitionOfDone: val(form, 'dod'),
            timeEstimateHours: val(form, 'est'),
            dueDate: val(form, 'dueDate'),
          };
          fields.projectId = picker.resolve();
          rememberProject(fields.projectId);
          if (adhoc) {
            store.startAdHoc(fields, item?.id ?? null);
            toast('Ad-hoc started — timer running 🔥', 'info');
          } else {
            store.promoteToReady(item.id, fields);
            toast('Scoped and ready ✓', 'success');
          }
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Doing → Done
// ---------------------------------------------------------------------------
export function openCompleteModal(item) {
  const spent = store.spentMs(item);
  const est = item.timeEstimateHours;
  const running = !!store.runningEntry(item);
  const body = `
    ${item.definitionOfDone ? `
      <div class="dod-check">
        <span class="dod-check__label">🎯 Definition of Done</span>
        <p>${esc(item.definitionOfDone)}</p>
        <label class="checkbox"><input type="checkbox" name="confirm" autofocus> <span>Yes — I have this now.</span></label>
      </div>` : ''}
    <div class="stats-row">
      <div class="stat"><span class="stat__value">${fmtDuration(spent)}</span><span class="stat__label">time spent</span></div>
      <div class="stat"><span class="stat__value">${est ? fmtHours(est) : '—'}</span><span class="stat__label">estimated</span></div>
      <div class="stat"><span class="stat__value">${item.timeLog.length}</span><span class="stat__label">session${item.timeLog.length === 1 ? '' : 's'}</span></div>
    </div>
    ${running ? '<p class="field__hint">The running timer will be stopped.</p>' : ''}`;

  openModal({
    title: `Finish “${item.title}”`,
    body,
    actions: [
      { label: 'Not yet' },
      {
        label: '✔ Mark done',
        primary: true,
        variant: 'success',
        onClick: ({ form }) => {
          const cb = form.querySelector('[name="confirm"]');
          if (cb && !cb.checked) throw new Error('Confirm the Definition of Done is met — or keep working on it.');
          store.completeItem(item.id);
          toast('Shipped! 🎉', 'success');
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Edit details + time log
// ---------------------------------------------------------------------------
function timeLogEditor(item) {
  let entries = item.timeLog.map((e) => ({ ...e }));
  const el = document.createElement('section');
  el.className = 'timelog';

  const durationOf = (e) => {
    const s = Date.parse(e.start);
    const en = e.end === null ? Date.now() : Date.parse(e.end);
    return Number.isNaN(s) || Number.isNaN(en) || en <= s ? null : en - s;
  };
  const total = () => entries.reduce((sum, e) => sum + (durationOf(e) || 0), 0);

  const rowHtml = (e, i) => {
    const d = durationOf(e);
    return `
      <div class="timelog__row" data-i="${i}">
        <input type="datetime-local" class="input input--sm" data-field="start" value="${toLocalInput(e.start)}" aria-label="Start">
        <span class="timelog__arrow" aria-hidden="true">→</span>
        ${e.end === null
          ? '<span class="chip chip--live">● running</span>'
          : `<input type="datetime-local" class="input input--sm" data-field="end" value="${toLocalInput(e.end)}" aria-label="End">`}
        <span class="timelog__dur${d === null ? ' timelog__dur--bad' : ''}" data-dur>${d === null ? 'invalid' : fmtDuration(d)}</span>
        <span class="timelog__tag">${e.manual ? '<span class="chip">manual</span>' : ''}</span>
        <button type="button" class="icon-btn icon-btn--danger" data-del aria-label="Delete entry">✕</button>
      </div>`;
  };

  const render = () => {
    el.innerHTML = `
      <header class="timelog__head">
        <h3 class="timelog__title">Time log</h3>
        <span class="timelog__total" data-total>${fmtDuration(total())}</span>
      </header>
      <div class="timelog__rows">
        ${entries.length ? entries.map(rowHtml).join('') : '<p class="empty-hint">No time logged yet. Forgot the timer? Add an entry.</p>'}
      </div>
      <button type="button" class="btn btn--sm btn--ghost timelog__add" data-add>＋ Add entry</button>`;
  };

  el.addEventListener('change', (e) => {
    const input = e.target.closest('[data-field]');
    if (!input) return;
    const row = input.closest('[data-i]');
    const entry = entries[Number(row.dataset.i)];
    // Empty end on a finished entry stays '' (invalid) — never silently becomes "running".
    entry[input.dataset.field] = fromLocalInput(input.value) ?? '';
    entry.manual = true;
    const d = durationOf(entry);
    const durEl = row.querySelector('[data-dur]');
    durEl.textContent = d === null ? 'invalid' : fmtDuration(d);
    durEl.classList.toggle('timelog__dur--bad', d === null);
    row.querySelector('.timelog__tag').innerHTML = '<span class="chip">manual</span>';
    el.querySelector('[data-total]').textContent = fmtDuration(total());
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) {
      const end = new Date();
      end.setSeconds(0, 0);
      entries.push({ id: uid('log'), start: new Date(end.getTime() - 3600000).toISOString(), end: end.toISOString(), manual: true });
      render();
      el.querySelector('.timelog__row:last-child [data-field="start"]')?.focus();
    } else if (e.target.closest('[data-del]')) {
      entries.splice(Number(e.target.closest('[data-i]').dataset.i), 1);
      render();
    }
  });

  render();
  return { el, getEntries: () => entries };
}

export function openDetailsModal(item) {
  const scoped = !['backlog', 'someday'].includes(item.status) || item.definitionOfDone || item.timeEstimateHours;
  const showLog = ['doing', 'done', 'archived'].includes(item.status) || item.timeLog.length > 0;

  const meta = [
    `Created ${fmtDate(item.createdAt)}`,
    item.movedToReadyAt && `Ready ${fmtDate(item.movedToReadyAt)}`,
    item.movedToDoingAt && `Started ${fmtDate(item.movedToDoingAt)}`,
    item.completedAt && `Completed ${fmtDate(item.completedAt)}`,
  ].filter(Boolean).join(' · ');

  const body = document.createElement('div');
  body.className = 'form-stack';
  body.innerHTML = `
    <label class="field">
      <span class="field__label">Title</span>
      <input class="input" name="title" maxlength="200" value="${esc(item.title)}">
    </label>
    <div class="field"><span class="field__label">Project</span><div data-slot="project"></div></div>
    ${scoped ? dodField(item.definitionOfDone, item.status !== 'ready', false) + estimateField(item.timeEstimateHours, item.status !== 'ready') : ''}
    ${dueDateField(item.dueDate)}
    <label class="field">
      <span class="field__label">Notes</span>
      <textarea class="input" name="notes" rows="${scoped ? 2 : 5}" maxlength="4000" placeholder="Freeform thoughts, links, context…">${esc(item.notes)}</textarea>
    </label>
    <p class="meta-line">${esc(meta)}</p>`;

  const picker = projectPicker(item.projectId);
  body.querySelector('[data-slot="project"]').append(picker.el);
  if (scoped) wireEstimate(body);

  let editor = null;
  if (showLog) {
    editor = timeLogEditor(item);
    body.append(editor.el);
  }

  const spentNow = fmtClock(store.spentMs(item));
  openModal({
    title: 'Edit item',
    subtitle: `${STATUS_LABEL[item.status]}${item.isAdHoc ? ' · 🔥 Ad-hoc' : ''}${showLog ? ` · ${spentNow} tracked` : ''}`,
    size: showLog ? 'lg' : 'md',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save changes',
        primary: true,
        onClick: ({ form }) => {
          const fields = {
            title: val(form, 'title'),
            notes: val(form, 'notes'),
            dueDate: val(form, 'dueDate'),
          };
          if (scoped) {
            fields.definitionOfDone = val(form, 'dod');
            fields.timeEstimateHours = val(form, 'est');
          }
          fields.projectId = picker.resolve();
          store.updateItem(item.id, fields, editor ? editor.getEntries() : undefined);
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Quick Edit Tracked Time (when timer is stopped)
// ---------------------------------------------------------------------------
export function openEditTimerModal(item) {
  if (store.runningEntry(item)) {
    throw new Error('Pause the timer before editing tracked time.');
  }
  const initialMs = store.spentMs(item);
  let currentMs = initialMs;

  const msToHms = (ms) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return { h, m, s };
  };

  const hmsToMs = (h, m, s) => {
    const hours = Math.max(0, Number(h) || 0);
    const mins = Math.max(0, Math.min(59, Number(m) || 0));
    const secs = Math.max(0, Math.min(59, Number(s) || 0));
    return (hours * 3600 + mins * 60 + secs) * 1000;
  };

  const { h: initH, m: initM, s: initS } = msToHms(initialMs);

  const body = document.createElement('div');
  body.className = 'form-stack time-modal';
  body.innerHTML = `
    <p class="callout">
      Forgot to start or stop the timer? Set the actual time spent on this item.
    </p>

    <div class="field">
      <span class="field__label">⏱ Total tracked time</span>
      <div class="time-edit-inputs">
        <div class="time-input-group">
          <label class="time-input-label" for="time-h">Hours</label>
          <input type="number" id="time-h" name="timeH" class="input input--num time-input-field" min="0" max="999" step="1" value="${initH}" autofocus>
        </div>
        <span class="time-input-sep">:</span>
        <div class="time-input-group">
          <label class="time-input-label" for="time-m">Minutes</label>
          <input type="number" id="time-m" name="timeM" class="input input--num time-input-field" min="0" max="59" step="1" value="${initM}">
        </div>
        <span class="time-input-sep">:</span>
        <div class="time-input-group">
          <label class="time-input-label" for="time-s">Seconds</label>
          <input type="number" id="time-s" name="timeS" class="input input--num time-input-field" min="0" max="59" step="1" value="${initS}">
        </div>
      </div>
    </div>

    <div class="field">
      <span class="field__label">Quick adjustments</span>
      <div class="time-adjust-chips">
        <button type="button" class="chip chip--btn chip--btn-sub" data-delta="-3600000">-1h</button>
        <button type="button" class="chip chip--btn chip--btn-sub" data-delta="-1800000">-30m</button>
        <button type="button" class="chip chip--btn chip--btn-sub" data-delta="-900000">-15m</button>
        <button type="button" class="chip chip--btn chip--btn-add" data-delta="900000">+15m</button>
        <button type="button" class="chip chip--btn chip--btn-add" data-delta="1800000">+30m</button>
        <button type="button" class="chip chip--btn chip--btn-add" data-delta="3600000">+1h</button>
        <button type="button" class="chip chip--btn chip--btn-zero" data-zero>Reset to 0</button>
      </div>
    </div>

    <div class="time-preview-box">
      <span class="time-preview-label">Change preview:</span>
      <span class="time-preview-text" data-preview></span>
    </div>

    <div class="time-modal__footer-links">
      <button type="button" class="link-btn" data-open-detailed>Need to edit individual session dates? Open full time log →</button>
    </div>`;

  const inputH = body.querySelector('#time-h');
  const inputM = body.querySelector('#time-m');
  const inputS = body.querySelector('#time-s');
  const previewEl = body.querySelector('[data-preview]');

  const updatePreview = () => {
    currentMs = hmsToMs(inputH.value, inputM.value, inputS.value);
    const diff = currentMs - initialMs;
    const prevFormatted = fmtClock(initialMs);
    const newFormatted = fmtClock(currentMs);

    if (diff === 0) {
      previewEl.innerHTML = `<span class="delta delta--ok">No change (${newFormatted})</span>`;
    } else if (diff > 0) {
      previewEl.innerHTML = `<span class="time-preview__old">${prevFormatted}</span> → <strong class="time-preview__new">${newFormatted}</strong> <span class="delta delta--over">+${fmtDuration(diff)}</span>`;
    } else {
      previewEl.innerHTML = `<span class="time-preview__old">${prevFormatted}</span> → <strong class="time-preview__new">${newFormatted}</strong> <span class="delta delta--under">-${fmtDuration(-diff)}</span>`;
    }
  };

  const setFromMs = (ms) => {
    const clamped = Math.max(0, ms);
    const { h, m, s } = msToHms(clamped);
    inputH.value = h;
    inputM.value = m;
    inputS.value = s;
    updatePreview();
  };

  body.querySelectorAll('.time-input-field').forEach((inp) => {
    inp.addEventListener('input', updatePreview);
  });

  body.addEventListener('click', (e) => {
    const deltaBtn = e.target.closest('[data-delta]');
    if (deltaBtn) {
      const delta = Number(deltaBtn.dataset.delta);
      setFromMs(currentMs + delta);
      return;
    }
    if (e.target.closest('[data-zero]')) {
      setFromMs(0);
      return;
    }
    if (e.target.closest('[data-open-detailed]')) {
      document.querySelector('dialog.modal')?.close();
      openDetailsModal(item);
    }
  });

  updatePreview();

  openModal({
    title: 'Adjust tracked time',
    subtitle: `“${item.title}” · Currently ${fmtClock(initialMs)}`,
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save time',
        primary: true,
        variant: 'primary',
        onClick: () => {
          store.setTrackedTime(item.id, currentMs);
          toast(`Tracked time updated to ${fmtClock(currentMs)} ✓`, 'success');
        },
      },
    ],
  });
}

