/**
 * Workitem Tracker — minimal local server.
 *
 * Serves the static frontend from /public and persists the whole board to a
 * single JSON file (data.json). Writes are atomic (temp file + rename) and
 * serialized, and WIP limits are re-validated here so a buggy client can
 * never corrupt the board into an invalid state.
 */
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// Keep in sync with LIMITS in public/js/store.js
const LIMITS = { ready: 5, doing: 2, adHoc: 1 };
const STATUSES = new Set(['backlog', 'ready', 'doing', 'done', 'someday', 'archived']);

function seedData() {
  const now = new Date().toISOString();
  return {
    version: 1,
    projects: [{ id: 'proj-workitem-tracker', name: 'Workitem Tracker', color: '#818cf8' }],
    items: [
      {
        id: 'item-weekly-review',
        title: 'Guided weekly review mode',
        projectId: 'proj-workitem-tracker',
        status: 'backlog',
        isAdHoc: false,
        notes:
          'Deferred from the v1 design session. A "Start Weekly Review" flow: ' +
          '(1) triage Backlog → Ready / Someday / delete, ' +
          '(2) flag Doing items older than 5 days, ' +
          '(3) queue the next 3–5 Ready items.',
        definitionOfDone: '',
        timeEstimateHours: null,
        timeLog: [],
        createdAt: now,
        movedToReadyAt: null,
        movedToDoingAt: null,
        completedAt: null,
        archivedAt: null,
        somedayAt: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
let writeQueue = Promise.resolve();

function writeData(data) {
  const run = async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, DATA_FILE);
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

async function readData() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      const seed = seedData();
      await writeData(seed);
      return seed;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Validation — the server is the last line of defence for the hard limits.
// ---------------------------------------------------------------------------
function validate(data) {
  if (!data || typeof data !== 'object') return 'Body must be a JSON object';
  if (!Array.isArray(data.projects) || !Array.isArray(data.items)) {
    return '"projects" and "items" must be arrays';
  }

  const ids = new Set();
  let ready = 0;
  let doing = 0;
  let adHoc = 0;
  let running = 0;

  for (const item of data.items) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !item.title.trim()) {
      return 'Every item needs an id and a non-empty title';
    }
    if (ids.has(item.id)) return `Duplicate item id "${item.id}"`;
    ids.add(item.id);
    if (!STATUSES.has(item.status)) return `Invalid status "${item.status}" on "${item.title}"`;

    if (item.status === 'ready') {
      ready += 1;
      if (!String(item.definitionOfDone || '').trim() || !(Number(item.timeEstimateHours) > 0)) {
        return `Ready item "${item.title}" needs a Definition of Done and a time estimate`;
      }
    }
    if (item.status === 'doing') {
      if (item.isAdHoc) adHoc += 1;
      else doing += 1;
    }
    if (!Array.isArray(item.timeLog)) return `Item "${item.title}" has an invalid time log`;
    running += item.timeLog.filter((e) => !e.end).length;
  }

  if (ready > LIMITS.ready) return `Ready is limited to ${LIMITS.ready} items`;
  if (doing > LIMITS.doing) return `Doing is limited to ${LIMITS.doing} items`;
  if (adHoc > LIMITS.adHoc) return `Only ${LIMITS.adHoc} ad-hoc item is allowed`;
  if (running > 1) return 'Only one timer can run at a time';
  return null;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', async (req, res, next) => {
  try {
    res.json(await readData());
  } catch (err) {
    next(err);
  }
});

app.put('/api/data', async (req, res, next) => {
  try {
    const error = validate(req.body);
    if (error) return res.status(422).json({ error });
    await writeData(req.body);
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: `Server error: ${err.message}` });
});

app.listen(PORT, HOST, () => {
  console.log(`Workitem Tracker running at http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
