# Workitem Tracker

A tiny, local, file-based kanban for personal projects. Built around one idea:
**focus on a few things inside a dedicated timeline.**

```
[ Backlog ] ──> [ Ready (max 5) ] ──> [ Doing (max 2 + 🔥1 ad-hoc) ] ──> [ Done ] ──> Archive
     │                                                                              
     └──> 💤 Someday (cold storage, separate page)
```

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # same, auto-restarts on server changes
```

Everything is stored in `data.json` at the project root (automatically created with sample data on first run).
It is included in `.gitignore` so your personal tasks and time logs remain private. An example template is provided in `data.json.example`.

## Rules the app enforces

| Column  | Limit | What's required |
|---------|-------|-----------------|
| Backlog | Soft — amber at 15, red at 20 | Title (notes and project are optional) |
| Ready   | **Hard: 5** | Definition of Done + time estimate (set when you scope an item) |
| Doing   | **Hard: 2** regular + **1 ad-hoc** slot | Timer starts automatically when you start |
| Done    | — | Ticking off the Definition of Done before completing |

- **Limits are global** across every project. Filtering by project never hides used slots.
- **Ad-hoc slot** is only for breaking changes: create one from the Doing column, or
  use *Handle as ad-hoc* on a Backlog item. It skips Ready.
- **One timer at a time.** Starting a timer pauses whichever other timer is running.
  Leaving Doing stops the timer.
- **Time log**: open any Doing/Done card (click its title) to add, edit, or delete
  entries. Overlapping entries are rejected so time is never counted twice.
- **Weekly reset**: click **Archive** on the Done column. The Archive page groups
  items by week and shows time tracked plus how close your estimates were.
- Over-4-hour estimates show a hint to slice the item. Cards that have been in
  Doing for more than 5 days get a nudge.

## Keyboard

- `N`: jump to quick capture
- `Enter`: submit the focused form · `Esc`: close a dialog or menu

## Project layout

```
server.js            Express: static files + GET/PUT /api/data (validates limits, atomic writes)
data.json            Your board (auto-created)
public/
  index.html
  css/styles.css
  js/app.js          Shell: routing, header, filter bar, 1s tick
  js/store.js        State + every workflow rule
  js/views.js        Board / Someday / Archive rendering + events
  js/modals.js       Scope, complete, edit + time log dialogs
  js/ui.js           Modal, menu, toast, project picker primitives
  js/api.js, utils.js
```

## Backlog (deferred from v1)

- Guided weekly review mode
- Drag-and-drop between columns
- Project management (rename / recolor / delete)
