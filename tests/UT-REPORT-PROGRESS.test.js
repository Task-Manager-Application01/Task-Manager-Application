const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../src/models/Database');
const reports = require('../src/services/reportExporter');

test('CSV and PDF show 100% for Done tasks and preserve other progress', () => {
  db.reset();
  const done = db.createTask({ workspace_id: 'w', title: 'Finished', status: 'Done', priority: 'High' });
  const active = db.createTask({ workspace_id: 'w', title: 'Ongoing', status: 'Review', priority: 'Low' });
  db.updateTask(done.task_id, { progress_percentage: 25 });
  db.updateTask(active.task_id, { progress_percentage: 50 });

  const csv = reports.exportToCSV('w');
  assert.match(csv, /"Finished","High","Done","100"/);
  assert.match(csv, /"Ongoing","Low","Review","50"/);
  const pdf = reports.exportToPDF('w').toString('latin1');
  assert.match(pdf, /Status: Done \| Progress: 100%/);
  assert.match(pdf, /Status: Review \| Progress: 50%/);
  assert.equal(db.getTask(done.task_id).progress_percentage, 25);
});
