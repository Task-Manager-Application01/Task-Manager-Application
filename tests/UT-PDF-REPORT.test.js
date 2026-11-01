const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');
const { generateJWT } = require('../src/middleware/authMiddleware');
const reportExporter = require('../src/services/reportExporter');

function get(server, path, token) {
  return new Promise((resolve, reject) => {
    http.get({
      port: server.address().port,
      path,
      headers: { Authorization: `Bearer ${token}` }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function makeUser(email) {
  const user = db.createUser({ email, full_name: email, password_hash: 'hash' });
  return { ...user, token: generateJWT({ userId: user.user_id, email, name: email }) };
}

function assertValidXref(pdf) {
  const text = pdf.toString('latin1');
  const xrefOffset = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');
  const entries = [...text.slice(xrefOffset).matchAll(/^(\d{10}) 00000 n $/gm)];
  assert.ok(entries.length > 0);
  entries.forEach((entry, index) => {
    const offset = Number(entry[1]);
    assert.equal(text.slice(offset).split('\n')[0], `${index + 1} 0 obj`);
  });
}

test('UT-RPT-02: PDF report export (REQ-7.3)', async t => {
  let owner, workspace;

  t.beforeEach(() => {
    db.reset();
    owner = makeUser('owner@example.com');
    workspace = db.createWorkspace({ title: 'Reports', owner_id: owner.user_id });
  });

  await t.test('contains task metadata and a valid structure', () => {
    const task = db.createTask({
      workspace_id: workspace.workspace_id,
      title: 'Ship (the) report',
      priority: 'High',
      status: 'Review',
      due_date: '2030-01-15',
      created_by: owner.user_id,
      assignees: [owner.user_id]
    });
    db.createSubtask({ task_id: task.task_id, title: 'Draft', is_completed: false });

    const pdf = reportExporter.exportToPDF(workspace.workspace_id);
    const text = pdf.toString('latin1');

    assert.ok(text.startsWith('%PDF-1.4'));
    assertValidXref(pdf);
    assert.ok(text.includes('Ship \\(the\\) report'));
    for (const value of ['Priority: High', 'Status: Review', 'Due: 2030-01-15', 'owner@example.com', '[ ] Draft']) {
      assert.ok(text.includes(value), value);
    }
  });

  await t.test('adds pages for long reports and handles unsupported characters', () => {
    for (let i = 0; i < 60; i++) {
      db.createTask({ workspace_id: workspace.workspace_id, title: `Task ${i} 日本語`, created_by: owner.user_id });
    }

    const pdf = reportExporter.exportToPDF(workspace.workspace_id);
    const text = pdf.toString('latin1');

    assert.ok(Number(text.match(/\/Count (\d+)/)[1]) > 1);
    assert.ok(text.includes('Task 59 ???'));
    assertValidXref(pdf);
  });

  await t.test('an empty workspace still produces a valid PDF', () => {
    const pdf = reportExporter.exportToPDF(workspace.workspace_id);
    assert.ok(pdf.toString('latin1').includes('Tasks: 0'));
    assertValidXref(pdf);
  });

  await t.test('route serves the PDF to members only', async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const path = `/api/v1/workspaces/${workspace.workspace_id}/reports/pdf`;

    const allowed = await get(server, path, owner.token);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.headers['content-type'], 'application/pdf');
    assert.match(allowed.headers['content-disposition'], /^attachment; filename=report_.*\.pdf$/);
    assert.ok(allowed.body.toString('latin1').startsWith('%PDF-'));

    const outsider = makeUser('outsider@example.com');
    assert.equal((await get(server, path, outsider.token)).statusCode, 403);
  });
});
