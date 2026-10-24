/**
 * Sprint-1 demo walkthrough (for the 1-minute video).
 * Starts nothing itself: run `npm start` in one terminal, then `npm run demo` in another.
 * Uses only Node 18+ built-ins (global fetch). Override target with BASE_URL.
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function call(label, method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  console.log(`\n▶ ${label}\n  ${method} ${path} -> ${res.status}`);
  console.log('  ' + JSON.stringify(data).slice(0, 220));
  return data;
}

(async () => {
  const stamp = Date.now();
  const email = `demo${stamp}@pes.edu`;
  const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

  await call('Health check', 'GET', '/health');

  const reg = await call('Register user', 'POST', '/api/v1/auth/register',
    { full_name: 'Demo User', email, password: 'Passw0rd!x' });
  const login = await call('Login (JWT)', 'POST', '/api/v1/auth/login',
    { email, password: 'Passw0rd!x' });
  const token = (login.data && login.data.token) || (reg.data && reg.data.token);
  const userId = (login.data && (login.data.user_id || (login.data.user || {}).user_id)) ||
                 (reg.data && (reg.data.user_id || (reg.data.user || {}).user_id));

  const ws = await call('Create workspace', 'POST', '/api/v1/workspaces',
    { title: 'Sprint-1 Demo', description: 'Demo workspace' }, token);
  const wsId = ws.data && (ws.data.workspace_id || ws.data.id);

  const task = await call('Create task', 'POST', '/api/v1/tasks', {
    workspace_id: wsId, title: 'Write Sprint-1 report', description: 'Demo task',
    priority: 'High', due_date: due, created_by: userId
  }, token);
  const taskId = task.data && task.data.task_id;

  await call('Add subtask', 'POST', `/api/v1/tasks/${taskId}/subtasks`, { title: 'Draft outline' }, token);
  await call('Attach file (metadata)', 'POST', `/api/v1/tasks/${taskId}/attachments`,
    { file_name: 'notes.pdf', file_size: 120000, mime_type: 'application/pdf', uploaded_by: userId }, token);
  await call('Move card on Kanban', 'POST', `/api/v1/tasks/${taskId}/move`,
    { targetColumn: 'In-Progress', actorId: userId }, token);
  await call('Search tasks', 'GET', `/api/v1/search/tasks?workspace_id=${wsId}&q=report`, null, token);
  await call('Analytics KPIs', 'GET', `/api/v1/workspaces/${wsId}/analytics/kpi`, null, token);
  await call('Audit log', 'GET', `/api/v1/workspaces/${wsId}/audit-logs`, null, token);
  console.log('\n✔ Demo complete');
})().catch(e => { console.error('Demo failed:', e.message); process.exit(1); });
