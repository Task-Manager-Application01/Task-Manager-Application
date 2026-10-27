
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../src/app');
const { db } = require('../src/models/Database');

/**
 * System Integration Test Suite: ST-TASK-01, ST-TASK-02, ST-FILE-01
 * Verifies End-to-End RESTful API flows over HTTP.
 * Traces to RTM Table: ST-TASK-01, ST-TASK-02, ST-FILE-01
 */

function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let rawData = '';

      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        let parsed = null;

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

test('System Integration: End-to-End Task & Subtask Lifecycle', async (t) => {
  const server = createServer();

  await new Promise((resolve) => server.listen(0, resolve));

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  /**
   * Register a real user, obtain a JWT, and create a workspace
   * for that user before testing protected task endpoints.
   */
  async function setupFixture(email) {
    db.reset();

    const registerRes = await request(
      server,
      {
        method: 'POST',
        path: '/api/v1/auth/register'
      },
      {
        full_name: 'Integration Test User',
        email,
        password: 'TestPassword#2026'
      }
    );

    assert.equal(
      registerRes.statusCode,
      201,
      `Registration failed: ${JSON.stringify(registerRes.data)}`
    );

    const token = registerRes.data.data.token;
    const userId = registerRes.data.data.user_id;

    assert.ok(token, 'Registration should return a JWT');
    assert.ok(userId, 'Registration should return a user ID');

    const headers = {
      Authorization: `Bearer ${token}`
    };

    const workspaceRes = await request(
      server,
      {
        method: 'POST',
        path: '/api/v1/workspaces',
        headers
      },
      {
        title: 'Integration Test Workspace',
        description: 'Workspace for HTTP integration tests'
      }
    );

    assert.equal(
      workspaceRes.statusCode,
      201,
      `Workspace creation failed: ${JSON.stringify(workspaceRes.data)}`
    );

    const workspaceId = workspaceRes.data.data.workspace_id;

    assert.ok(workspaceId, 'Workspace creation should return a workspace ID');

    return { token, headers, userId, workspaceId };
  }

  await t.test('ST-TASK-01: Complete Task Lifecycle via HTTP', async () => {
    const { headers, userId, workspaceId } =
      await setupFixture('task-lifecycle@example.com');

    // 1. Create Task
    const createRes = await request(
      server,
      {
        method: 'POST',
        path: '/api/v1/tasks',
        headers
      },
      {
        workspace_id: workspaceId,
        created_by: userId,
        title: 'Full Stack Sprint Integration',
        description: 'End-to-end testing of REST endpoints',
        priority: 'High',
        status: 'To-Do'
      }
    );

    assert.equal(
      createRes.statusCode,
      201,
      `Task creation failed: ${JSON.stringify(createRes.data)}`
    );

    const taskId = createRes.data.data.task_id;
    assert.ok(taskId);

    // 2. Fetch Task
    const getRes = await request(server, {
      method: 'GET',
      path: `/api/v1/tasks/${taskId}`,
      headers
    });

    assert.equal(getRes.statusCode, 200);
    assert.equal(
      getRes.data.data.title,
      'Full Stack Sprint Integration'
    );

    // 3. Update Task
    const updateRes = await request(
      server,
      {
        method: 'PUT',
        path: `/api/v1/tasks/${taskId}`,
        headers
      },
      {
        status: 'In-Progress',
        priority: 'Medium'
      }
    );

    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.data.data.status, 'In-Progress');
    assert.equal(updateRes.data.data.priority, 'Medium');

    // 4. Archive Task (Soft Delete)
    const archiveRes = await request(server, {
      method: 'POST',
      path: `/api/v1/tasks/${taskId}/archive`,
      headers
    });

    assert.equal(archiveRes.statusCode, 200);

    // Task should not be found in the active query.
    const afterArchiveRes = await request(server, {
      method: 'GET',
      path: `/api/v1/tasks/${taskId}`,
      headers
    });

    assert.equal(afterArchiveRes.statusCode, 404);

    // Task remains accessible when includeArchived=true.
    const includeArchivedRes = await request(server, {
      method: 'GET',
      path: `/api/v1/tasks/${taskId}?includeArchived=true`,
      headers
    });

    assert.equal(includeArchivedRes.statusCode, 200);
    assert.equal(includeArchivedRes.data.data.is_archived, true);
  });

  await t.test(
    'ST-TASK-02: Subtask Checklist & Progress Tracking via HTTP',
    async () => {
      const { headers, userId, workspaceId } =
        await setupFixture('subtask-lifecycle@example.com');

      // Create Task
      const taskRes = await request(
        server,
        {
          method: 'POST',
          path: '/api/v1/tasks',
          headers
        },
        {
          workspace_id: workspaceId,
          created_by: userId,
          title: 'Feature Module Verification',
          priority: 'Medium'
        }
      );

      assert.equal(
        taskRes.statusCode,
        201,
        `Task creation failed: ${JSON.stringify(taskRes.data)}`
      );

      const taskId = taskRes.data.data.task_id;
      assert.ok(taskId);

      // Add Subtask 1
      const sub1Res = await request(
        server,
        {
          method: 'POST',
          path: `/api/v1/tasks/${taskId}/subtasks`,
          headers
        },
        {
          title: 'Step 1: Write Unit Tests'
        }
      );

      assert.equal(
        sub1Res.statusCode,
        201,
        `Subtask creation failed: ${JSON.stringify(sub1Res.data)}`
      );

      const sub1Id = sub1Res.data.data.subtask.subtask_id;

      // Add Subtask 2
      const sub2Res = await request(
        server,
        {
          method: 'POST',
          path: `/api/v1/tasks/${taskId}/subtasks`,
          headers
        },
        {
          title: 'Step 2: Deploy to Staging'
        }
      );

      assert.equal(
        sub2Res.statusCode,
        201,
        `Subtask creation failed: ${JSON.stringify(sub2Res.data)}`
      );

      const sub2Id = sub2Res.data.data.subtask.subtask_id;

      // Check Task Progress (0%)
      let taskCheck = await request(server, {
        method: 'GET',
        path: `/api/v1/tasks/${taskId}`,
        headers
      });

      assert.equal(taskCheck.statusCode, 200);
      assert.equal(taskCheck.data.data.progress_percentage, 0);

      // Toggle Subtask 1 as Completed
      const toggleRes = await request(
        server,
        {
          method: 'PUT',
          path: `/api/v1/subtasks/${sub1Id}`,
          headers
        },
        {
          is_completed: true
        }
      );

      assert.equal(
        toggleRes.statusCode,
        200,
        `Subtask update failed: ${JSON.stringify(toggleRes.data)}`
      );

      assert.equal(toggleRes.data.data.task_progress_percentage, 50);

      // Verify Task Progress (50%)
      taskCheck = await request(server, {
        method: 'GET',
        path: `/api/v1/tasks/${taskId}`,
        headers
      });

      assert.equal(taskCheck.data.data.progress_percentage, 50);

      // Toggle Subtask 2 as Completed
      const toggleSecondRes = await request(
        server,
        {
          method: 'PUT',
          path: `/api/v1/subtasks/${sub2Id}`,
          headers
        },
        {
          is_completed: true
        }
      );

      assert.equal(
        toggleSecondRes.statusCode,
        200,
        `Subtask update failed: ${JSON.stringify(toggleSecondRes.data)}`
      );

      // Verify Task Progress (100%)
      taskCheck = await request(server, {
        method: 'GET',
        path: `/api/v1/tasks/${taskId}`,
        headers
      });

      assert.equal(taskCheck.data.data.progress_percentage, 100);
    }
  );

  await t.test(
    'ST-FILE-01: File Attachment Upload and Secure Download via HTTP',
    async () => {
      const { headers, userId, workspaceId } =
        await setupFixture('file-lifecycle@example.com');

      // Create Task
      const taskRes = await request(
        server,
        {
          method: 'POST',
          path: '/api/v1/tasks',
          headers
        },
        {
          workspace_id: workspaceId,
          created_by: userId,
          title: 'Design Assets Task',
          priority: 'Low'
        }
      );

      assert.equal(
        taskRes.statusCode,
        201,
        `Task creation failed: ${JSON.stringify(taskRes.data)}`
      );

      const taskId = taskRes.data.data.task_id;
      assert.ok(taskId);

      // Upload Attachment
      const uploadRes = await request(
        server,
        {
          method: 'POST',
          path: `/api/v1/tasks/${taskId}/attachments`,
          headers
        },
        {
          file_name: 'system_architecture.pdf',
          file_size: 1024 * 1024 * 2,
          mime_type: 'application/pdf',
          uploaded_by: userId
        }
      );

      assert.equal(
        uploadRes.statusCode,
        201,
        `Attachment upload failed: ${JSON.stringify(uploadRes.data)}`
      );

      const downloadUrl = uploadRes.data.data.secure_download_url;
      assert.ok(downloadUrl);

      // Signed download links are public and validate their own token.
      const downloadRes = await request(server, {
        method: 'GET',
        path: downloadUrl
      });

      assert.equal(downloadRes.statusCode, 200);
      assert.equal(
        downloadRes.data.data.file_name,
        'system_architecture.pdf'
      );
    }
  );
});
