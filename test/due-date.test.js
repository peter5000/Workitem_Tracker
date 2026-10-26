import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { fmtDate, parseDate, endOfDay } from '../public/js/utils.js';
import { dueChip } from '../public/js/views.js';

describe('Due Date formatting and parsing', () => {
  describe('parseDate()', () => {
    it('parses YYYY-MM-DD date-only string as local calendar date', () => {
      const d = parseDate('2026-10-24');
      assert.ok(d instanceof Date);
      assert.strictEqual(d.getFullYear(), 2026);
      assert.strictEqual(d.getMonth(), 9); // 0-indexed: 9 = October
      assert.strictEqual(d.getDate(), 24);
    });

    it('handles leading and trailing whitespace in date-only string', () => {
      const d = parseDate('  2026-10-24  ');
      assert.ok(d instanceof Date);
      assert.strictEqual(d.getFullYear(), 2026);
      assert.strictEqual(d.getMonth(), 9);
      assert.strictEqual(d.getDate(), 24);
    });

    it('parses full ISO strings correctly', () => {
      const d = parseDate('2026-10-24T15:30:00.000Z');
      assert.ok(d instanceof Date);
      assert.strictEqual(d.toISOString(), '2026-10-24T15:30:00.000Z');
    });

    it('returns null for null, undefined, and empty string', () => {
      assert.strictEqual(parseDate(null), null);
      assert.strictEqual(parseDate(undefined), null);
      assert.strictEqual(parseDate(''), null);
      assert.strictEqual(parseDate('   '), null);
    });

    it('returns null for invalid date strings', () => {
      assert.strictEqual(parseDate('not-a-date'), null);
    });

    it('returns Date instance as-is if already a valid Date', () => {
      const original = new Date(2026, 9, 24);
      assert.strictEqual(parseDate(original), original);
    });
  });

  describe('endOfDay()', () => {
    it('sets time to 23:59:59.999 local time for YYYY-MM-DD', () => {
      const d = endOfDay('2026-10-24');
      assert.ok(d instanceof Date);
      assert.strictEqual(d.getFullYear(), 2026);
      assert.strictEqual(d.getMonth(), 9);
      assert.strictEqual(d.getDate(), 24);
      assert.strictEqual(d.getHours(), 23);
      assert.strictEqual(d.getMinutes(), 59);
      assert.strictEqual(d.getSeconds(), 59);
      assert.strictEqual(d.getMilliseconds(), 999);
    });

    it('returns null for empty/invalid inputs', () => {
      assert.strictEqual(endOfDay(null), null);
      assert.strictEqual(endOfDay(''), null);
      assert.strictEqual(endOfDay('invalid'), null);
    });
  });

  describe('fmtDate()', () => {
    it('formats date-only string matching details modal without timezone shift', () => {
      // The bug caused "2026-10-24" to display as "Oct 23" in timezones west of UTC.
      // fmtDate should display "Oct 24" matching the source-of-truth date picked in details.
      const formatted = fmtDate('2026-10-24', { month: 'short', day: 'numeric' }, 'en-US');
      assert.strictEqual(formatted, 'Oct 24');
      assert.doesNotMatch(formatted, /Oct 23/);
    });

    it('formats with year when requested', () => {
      const formatted = fmtDate('2026-10-24', { month: 'short', day: 'numeric', year: 'numeric' }, 'en-US');
      assert.strictEqual(formatted, 'Oct 24, 2026');
    });

    it('handles various calendar dates including leap years and month boundaries', () => {
      assert.strictEqual(fmtDate('2026-01-01', { month: 'short', day: 'numeric' }, 'en-US'), 'Jan 1');
      assert.strictEqual(fmtDate('2026-12-31', { month: 'short', day: 'numeric' }, 'en-US'), 'Dec 31');
      assert.strictEqual(fmtDate('2024-02-29', { month: 'short', day: 'numeric' }, 'en-US'), 'Feb 29');
    });

    it('formats full ISO timestamp strings accurately', () => {
      const iso = new Date(2026, 9, 24, 10, 0, 0).toISOString();
      const formatted = fmtDate(iso, { month: 'short', day: 'numeric' }, 'en-US');
      assert.strictEqual(formatted, 'Oct 24');
    });

    it('returns empty string for null, undefined, or invalid input', () => {
      assert.strictEqual(fmtDate(null), '');
      assert.strictEqual(fmtDate(undefined), '');
      assert.strictEqual(fmtDate(''), '');
      assert.strictEqual(fmtDate('invalid-date'), '');
    });

    it('consistently produces Oct 24 across timezones', () => {
      // Test that date-only "YYYY-MM-DD" is timezone-independent
      const tzList = ['UTC', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York'];
      for (const tz of tzList) {
        const out = execSync(
          'node -e "import(\\"./public/js/utils.js\\").then(m => console.log(m.fmtDate(\\"2026-10-24\\", { month: \\"short\\", day: \\"numeric\\" }, \\"en-US\\")))"',
          { env: { ...process.env, TZ: tz } }
        ).toString().trim();
        assert.strictEqual(out, 'Oct 24', `Expected "Oct 24" in TZ ${tz}, got "${out}"`);
      }
    });
  });

  describe('dueChip() dashboard rendering', () => {
    it('returns empty string when item has no dueDate', () => {
      assert.strictEqual(dueChip({ dueDate: null, status: 'ready' }), '');
      assert.strictEqual(dueChip({ dueDate: '', status: 'ready' }), '');
      assert.strictEqual(dueChip({ status: 'ready' }), '');
    });

    it('renders correct due date on dashboard chip matching details (not shifted to Oct 23)', () => {
      const item = { dueDate: '2026-10-24', status: 'ready' };
      // Reference time: Oct 24, 2026 noon local time (not overdue yet)
      const now = new Date(2026, 9, 24, 12, 0, 0).getTime();
      const html = dueChip(item, now);

      assert.ok(html.includes('Oct 24'), `Expected chip to contain "Oct 24", got: ${html}`);
      assert.ok(!html.includes('Oct 23'), `Chip must not contain "Oct 23": ${html}`);
      assert.ok(html.includes('chip'));
      assert.ok(!html.includes('chip--overdue'));
    });

    it('renders overdue state when current time is past due date end-of-day', () => {
      const item = { dueDate: '2026-10-24', status: 'ready' };
      // Reference time: Oct 25, 2026 09:00:00 (past end of Oct 24)
      const now = new Date(2026, 9, 25, 9, 0, 0).getTime();
      const html = dueChip(item, now);

      assert.ok(html.includes('chip--overdue'));
      assert.ok(html.includes('Overdue'));
      assert.ok(html.includes('Oct 24'), `Expected overdue chip to contain "Oct 24", got: ${html}`);
      assert.ok(!html.includes('Oct 23'), `Overdue chip must not contain "Oct 23": ${html}`);
    });

    it('does not mark item as overdue if status is done or archived', () => {
      const now = new Date(2026, 9, 25, 9, 0, 0).getTime();
      const doneItem = { dueDate: '2026-10-24', status: 'done' };
      const archivedItem = { dueDate: '2026-10-24', status: 'archived' };

      const doneHtml = dueChip(doneItem, now);
      const archivedHtml = dueChip(archivedItem, now);

      assert.ok(!doneHtml.includes('chip--overdue'));
      assert.ok(!doneHtml.includes('Overdue'));
      assert.ok(doneHtml.includes('Oct 24'));

      assert.ok(!archivedHtml.includes('chip--overdue'));
      assert.ok(!archivedHtml.includes('Overdue'));
      assert.ok(archivedHtml.includes('Oct 24'));
    });
  });
});
