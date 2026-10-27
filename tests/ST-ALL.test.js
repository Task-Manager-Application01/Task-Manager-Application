
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');

function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let rawData = '';

      res.on('data', chunk => {
        rawData += chunk;
      });

      res.on('end', () => {
        let parsed;

        try {
          parsed = JSON.parse(rawData);
        } catch {
          parsed = rawData;
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', reject);

    if (body !== null) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

test(
  'Comprehensive System Integration (ST-AUTH, ST-WS, ST-TASK, ST-KB, ST-SRCH, ST-RPT, ST-NOTIF)',
  async (t) => {
    db.reset();

    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, resolve);
    });

    t.after(async () => {
      await new Promise((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    });

    await t.test(
      'Full End-to-End Collaborative Agile Workflow across all 4 Members Modules',
      async () => {
        // 1. Register the workspace administrator.
        const regRes = await request(server, {
          method: 'POST',
          path: '/api/v1/auth/register'
        }, {
          full_name: 'Chetana Admin',
          email: 'chetana@pes.edu',
          password: 'AdminPassword#2026'
        });

        assert.equal(regRes.statusCode, 201, JSON.stringify(regRes.data));

        const token = regRes.data.data.token;
        const adminId = regRes.data.data.user_id;

        assert.ok(token, 'Registration should return an authentication token');
        assert.ok(adminId, 'Registration should return a user ID');

        const authHeaders = {
          Authorization: `Bearer ${token}`
        };

        // 2. Create a workspace.
        const wsRes = await request(server, {
          method: 'POST',
          path: '/api/v1/workspaces',
          headers: authHeaders
        }, {
          title: 'Full Team Agile Workspace',
          description: 'PES University Semester 5 Project'
        });

        assert.equal(wsRes.statusCode, 201, JSON.stringify(wsRes.data));

        const workspaceId = wsRes.data.data.workspace_id;
        assert.ok(workspaceId, 'Workspace creation should return a workspace ID');

        // 3. Invite Rudra as a workspace member.
        const inviteRes = await request(server, {
          method: 'POST',
          path: `/api/v1/workspaces/${workspaceId}/invite`,
          headers: authHeaders
        }, {
          email: 'rudra@pes.edu',
          role: 'Member'
        });

        assert.equal(inviteRes.statusCode, 200, JSON.stringify(inviteRes.data));

        const rudraId = inviteRes.data.data.user_id;
        assert.ok(rudraId, 'Invitation should return the member user ID');

        // 4. Create a task assigned to Rudra.
        const taskRes = await request(server, {
          method: 'POST',
          path: '/api/v1/tasks',
          headers: authHeaders
        }, {
          workspace_id: workspaceId,
          title: 'Setup Production Cluster',
          description: 'Provision AWS Kubernetes infrastructure',
          priority: 'High',
          status: 'To-Do',
          created_by: adminId,
          assignees: [rudraId]
        });

        assert.equal(taskRes.statusCode, 201, JSON.stringify(taskRes.data));

        const taskId = taskRes.data.data.task_id;
        assert.ok(taskId, 'Task creation should return a task ID');

        // 5. Add a subtask.
        const subRes = await request(server, {
          method: 'POST',
          path: `/api/v1/tasks/${taskId}/subtasks`,
          headers: authHeaders
        }, {
          title: 'Configure VPC & Subnets'
        });

        assert.equal(subRes.statusCode, 201, JSON.stringify(subRes.data));

        // 6. Upload an attachment.
        const attachRes = await request(server, {
          method: 'POST',
          path: `/api/v1/tasks/${taskId}/attachments`,
          headers: authHeaders
        }, {
          file_name: 'cluster_spec.pdf',
          file_size: 1024 * 500,
          mime_type: 'application/pdf',
          uploaded_by: rudraId
        });

        assert.equal(attachRes.statusCode, 201, JSON.stringify(attachRes.data));

        // 7. Retrieve the Kanban board.
        const kanbanRes = await request(server, {
          method: 'GET',
          path: `/api/v1/workspaces/${workspaceId}/kanban`,
          headers: authHeaders
        });

        assert.equal(kanbanRes.statusCode, 200, JSON.stringify(kanbanRes.data));
        assert.equal(kanbanRes.data.data['To-Do'].length, 1);

        // 8. Move the task to In-Progress.
        const moveRes = await request(server, {
          method: 'POST',
          path: `/api/v1/tasks/${taskId}/move`,
          headers: authHeaders
        }, {
          targetColumn: 'In-Progress',
          actorId: rudraId
        });

        assert.equal(moveRes.statusCode, 200, JSON.stringify(moveRes.data));

        // 9. Search for the task.
        const searchRes = await request(server, {
          method: 'GET',
          path: `/api/v1/search/tasks?workspace_id=${workspaceId}&q=Cluster`,
          headers: authHeaders
        });

        assert.equal(searchRes.statusCode, 200, JSON.stringify(searchRes.data));
        assert.equal(searchRes.data.total, 1);

        // 10. Retrieve workspace KPI analytics.
        const kpiRes = await request(server, {
          method: 'GET',
          path: `/api/v1/workspaces/${workspaceId}/analytics/kpi`,
          headers: authHeaders
        });

        assert.equal(kpiRes.statusCode, 200, JSON.stringify(kpiRes.data));
        assert.equal(kpiRes.data.data.total_tasks, 1);

        // 11. Verify the workspace audit log.
        const auditRes = await request(server, {
          method: 'GET',
          path: `/api/v1/workspaces/${workspaceId}/audit-logs`,
          headers: authHeaders
        });

        assert.equal(auditRes.statusCode, 200, JSON.stringify(auditRes.data));
        assert.ok(
          auditRes.data.count >= 3,
          'Expected workspace creation, member invitation and task events in the audit log'
        );
      }
    );
  }
);
