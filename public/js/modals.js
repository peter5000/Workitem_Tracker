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
