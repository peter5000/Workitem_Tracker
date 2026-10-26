/** Reusable UI primitives: toasts, modal dialogs, popover menus, project picker. */
import * as store from './store.js';
import { RuleError, PALETTE } from './store.js';
import { esc } from './utils.js';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const TOAST_ICON = { info: 'ℹ', success: '✓', warn: '!', error: '✕' };

export function toast(message, type = 'info', ms = 3400) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast__icon" aria-hidden="true">${TOAST_ICON[type]}</span><span>${esc(message)}</span>`;
  root.append(el);
  setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/** Run an action; surface rule violations as warnings and anything else as errors. */
export function attempt(fn) {
  try {
    return fn();
  } catch (err) {
    toast(err.message, err instanceof RuleError ? 'warn' : 'error');
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Modal dialogs (native <dialog>: focus trap + Esc for free)
// ---------------------------------------------------------------------------
/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.subtitle]
 * @param {string|HTMLElement} o.body
 * @param {Array<{label:string, primary?:boolean, variant?:string, onClick?:Function}>} o.actions
 *        onClick({form, close}) may throw to show an inline error, or return false to stay open.
 * @param {'md'|'lg'} [o.size]
 */
export function openModal({ title, subtitle = '', body, actions = [], size = 'md' }) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal modal--${size}`;
  dlg.innerHTML = `
    <form class="modal__form" novalidate>
      <header class="modal__header">
        <div class="modal__titles">
          <h2 class="modal__title">${esc(title)}</h2>
          ${subtitle ? `<p class="modal__subtitle">${esc(subtitle)}</p>` : ''}
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close dialog">✕</button>
      </header>
      <div class="modal__body"></div>
      <div class="modal__error" role="alert" hidden></div>
      <footer class="modal__footer"></footer>
    </form>`;

  const form = dlg.querySelector('form');
  const bodyEl = dlg.querySelector('.modal__body');
  const errEl = dlg.querySelector('.modal__error');
  const footer = dlg.querySelector('.modal__footer');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);

  const close = () => dlg.close();
  const showError = (msg) => {
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  };
  const run = async (action) => {
    showError('');
    try {
      const result = await action.onClick?.({ form, close, dlg });
      if (result !== false) close();
    } catch (err) {
      showError(err.message);
    }
  };

  let primary = null;
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = action.primary ? 'submit' : 'button';
    btn.className = `btn btn--${action.variant || (action.primary ? 'primary' : 'ghost')}`;
    btn.textContent = action.label;
    if (action.primary) primary = action;
    else btn.addEventListener('click', () => (action.onClick ? run(action) : close()));
    footer.append(btn);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (primary) run(primary);
  });
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close(); // backdrop click
  });
  dlg.addEventListener('close', () => dlg.remove());

  document.getElementById('modal-root').append(dlg);
  dlg.showModal();
  (dlg.querySelector('[autofocus]') || dlg.querySelector('.modal__footer .btn--primary, .modal__footer [type=submit]'))?.focus();
  return { dlg, close, showError };
}

export function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let ok = false;
    const { dlg } = openModal({
      title,
      body: `<p class="modal__text">${esc(message)}</p>`,
      actions: [
        { label: 'Cancel' },
        { label: confirmLabel, primary: true, variant: danger ? 'danger' : 'primary', onClick: () => { ok = true; } },
      ],
    });
    dlg.addEventListener('close', () => resolve(ok));
  });
}

// ---------------------------------------------------------------------------
// Popover menu
// ---------------------------------------------------------------------------
let activeMenu = null;

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu.el.remove();
  activeMenu.anchor.setAttribute('aria-expanded', 'false');
  activeMenu = null;
}

/**
 * @param {HTMLElement} anchor
 * @param {Array<{label?:string, run?:Function, disabled?:boolean, reason?:string, danger?:boolean, sep?:boolean}>} entries
 */
export function openMenu(anchor, entries) {
  if (activeMenu?.anchor === anchor) {
    closeMenu();
    return;
  }
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  for (const entry of entries) {
    if (entry.sep) {
      el.append(Object.assign(document.createElement('div'), { className: 'menu__sep' }));
      continue;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.className = `menu__item${entry.danger ? ' menu__item--danger' : ''}`;
    btn.textContent = entry.label;
    if (entry.disabled) {
      btn.setAttribute('aria-disabled', 'true');
      if (entry.reason) btn.title = entry.reason;
    }
    btn.addEventListener('click', () => {
      closeMenu();
      if (entry.disabled) {
        if (entry.reason) toast(entry.reason, 'warn');
        return;
      }
      entry.run();
    });
    el.append(btn);
  }
  document.body.append(el);

  const r = anchor.getBoundingClientRect();
  const { offsetWidth: w, offsetHeight: h } = el;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  anchor.setAttribute('aria-expanded', 'true');
  activeMenu = { el, anchor };
  el.querySelector('.menu__item:not([aria-disabled])')?.focus();
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    if (activeMenu && !activeMenu.el.contains(e.target) && !activeMenu.anchor.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  document.addEventListener('scroll', closeMenu, true);
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', closeMenu);
}

// ---------------------------------------------------------------------------
// Project picker: pre-defined list + inline creation with a color
// ---------------------------------------------------------------------------
const LAST_PROJECT_KEY = 'wt:lastProject';

export function lastProject() {
  const id = localStorage.getItem(LAST_PROJECT_KEY);
  return id && store.getProject(id) ? id : null;
}

export function rememberProject(id) {
  if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
  else localStorage.removeItem(LAST_PROJECT_KEY);
}

/** Returns { el, resolve() } — resolve() returns a projectId, creating the project if needed. */
export function projectPicker(selectedId = null, { compact = false } = {}) {
  const { projects } = store.getState();
  const wrap = document.createElement('div');
  wrap.className = `project-picker${compact ? ' project-picker--compact' : ''}`;
  wrap.innerHTML = `
    <div class="select-wrap">
      <span class="select-wrap__dot" aria-hidden="true"></span>
      <select class="input input--select${compact ? ' input--sm' : ''}" aria-label="Project">
        <option value="">No project</option>
        ${projects.map((p) => `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
        <option value="__new__">＋ New project…</option>
      </select>
    </div>
    <div class="project-picker__new" hidden>
      <input class="input${compact ? ' input--sm' : ''}" type="text" maxlength="40" placeholder="New project name" aria-label="New project name">
      <div class="swatches" role="radiogroup" aria-label="Project color">
        ${PALETTE.map((c) => `<button type="button" class="swatch" role="radio" data-color="${c}" style="--swatch:${c}" aria-label="Color ${c}"></button>`).join('')}
      </div>
    </div>`;

  const select = wrap.querySelector('select');
  const dot = wrap.querySelector('.select-wrap__dot');
  const newBox = wrap.querySelector('.project-picker__new');
  const nameInput = newBox.querySelector('input');
  const swatches = [...newBox.querySelectorAll('.swatch')];
  let color = store.nextColor();

  const sync = () => {
    const isNew = select.value === '__new__';
    newBox.hidden = !isNew;
    const p = store.getProject(select.value);
    dot.style.setProperty('--c', isNew ? color : p?.color || 'transparent');
    dot.classList.toggle('select-wrap__dot--empty', !isNew && !p);
    swatches.forEach((s) => s.setAttribute('aria-checked', String(s.dataset.color === color)));
  };
  select.addEventListener('change', () => {
    sync();
    if (select.value === '__new__') nameInput.focus();
  });
  swatches.forEach((s) => s.addEventListener('click', () => {
    color = s.dataset.color;
    sync();
  }));
  sync();

  return {
    el: wrap,
    resolve() {
      if (select.value === '__new__') return store.addProject(nameInput.value, color).id;
      return select.value || null;
    },
  };
}
