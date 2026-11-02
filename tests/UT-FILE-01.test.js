const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { db } = require('../src/models/Database');
const fileUploadService = require('../src/services/fileUploadService');

/**
 * Unit Test Suite: UT-FILE-01
 * Traces to SRS Requirement: REQ-4.3 (Secure File Attachments & 10MB Limit)
 * Owner: Dhadhal Rudra (PES1UG24CS146)
 */

test('UT-FILE-01: File Upload Validation & Secure Storage Services', async (t) => {
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  let parentTaskId;

  t.beforeEach(() => {
    db.reset();
    const task = db.createTask({
      workspace_id: workspaceId,
      created_by: userId,
      title: 'Task with Document Deliverables',
      priority: 'Medium'
    });
    parentTaskId = task.task_id;
  });

  await t.test('REQ-4.3: Accepts valid file attachments (PDF, PNG, JPG, DOCX, ZIP) under 10MB', async () => {
    const validTestCases = [
      { name: 'architecture_diagram.png', size: 1024 * 500, mime: 'image/png' },
      { name: 'requirements_doc.pdf', size: 1024 * 1024 * 3, mime: 'application/pdf' },
      { name: 'dataset.zip', size: 1024 * 1024 * 8, mime: 'application/zip' },
      { name: 'photo.jpg', size: 1024 * 200, mime: 'image/jpeg' },
      { name: 'spec.docx', size: 1024 * 350, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    ];

    for (const testCase of validTestCases) {
      const result = await fileUploadService.processAttachment({
        taskId: parentTaskId,
        fileName: testCase.name,
        fileSize: testCase.size,
        mimeType: testCase.mime,
        uploadedBy: userId
      });

      assert.ok(result.attachment.attachment_id);
      assert.equal(result.attachment.file_size, testCase.size);
      assert.equal(result.attachment.mime_type, testCase.mime);
      assert.ok(result.secure_download_url.includes('/api/v1/attachments/download/'));
      assert.ok(result.attachment.download_token);
    }
  });

  await t.test('REQ-4.3 / Section 2.5: Strictly rejects files exceeding the 10 MB limit', async () => {
    const oversizedFile = {
      fileName: 'large_backup_archive.zip',
      fileSize: 11 * 1024 * 1024, // 11 MB > 10 MB
      mimeType: 'application/zip'
    };

    await assert.rejects(
      async () => {
        await fileUploadService.processAttachment({
          taskId: parentTaskId,
          fileName: oversizedFile.fileName,
          fileSize: oversizedFile.fileSize,
          mimeType: oversizedFile.mimeType,
          uploadedBy: userId
        });
      },
      (err) => {
        assert.equal(err.statusCode, 413);
        assert.ok(err.message.includes('exceeds the 10 MB maximum limit'));
        return true;
      }
    );
  });

  await t.test('REQ-4.3: Strictly rejects disallowed MIME types and dangerous extensions', async () => {
    const dangerousFiles = [
      { fileName: 'malicious.exe', size: 1024 * 50, mime: 'application/x-msdownload' },
      { fileName: 'script.sh', size: 1024 * 10, mime: 'application/x-sh' },
      { fileName: 'phish.html', size: 1024 * 20, mime: 'text/html' }
    ];

    for (const testCase of dangerousFiles) {
      await assert.rejects(
        async () => {
          await fileUploadService.processAttachment({
            taskId: parentTaskId,
            fileName: testCase.name,
            fileSize: testCase.size,
            mimeType: testCase.mime,
            uploadedBy: userId
          });
        },
        (err) => {
          assert.equal(err.statusCode, 415);
          assert.ok(err.message.includes('File validation failed'));
          return true;
        }
      );
    }
  });

  await t.test('REQ-4.3: Secure download token authorization and 24-hour expiry', async () => {
    const uploadResult = await fileUploadService.processAttachment({
      taskId: parentTaskId,
      fileName: 'final_report.pdf',
      fileSize: 1024 * 800,
      mimeType: 'application/pdf',
      uploadedBy: userId
    });

    const token = uploadResult.attachment.download_token;
    const attachmentId = uploadResult.attachment.attachment_id;

    // 1. Valid token retrieval
    const retrievedAttachment = fileUploadService.verifyDownloadToken(token);
    assert.ok(retrievedAttachment);
    assert.equal(retrievedAttachment.file_name, 'final_report.pdf');

    // 2. Invalid token rejected
    const invalidRetrieval = fileUploadService.verifyDownloadToken('invalid-fake-token');
    assert.equal(invalidRetrieval, null);

    // 3. Expired token rejected (past 24 hours)
    const futureTimeAfter25Hours = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const expiredRetrieval = fileUploadService.verifyDownloadToken(token, futureTimeAfter25Hours);
    assert.equal(expiredRetrieval, null, 'Attachment download must be rejected after 24 hours');

    // Expired attachment record in DB returns null
    const originalAttachment = db.attachments.get(attachmentId);
    originalAttachment.expires_at = new Date(Date.now() - 1000).toISOString();
    assert.equal(fileUploadService.verifyDownloadToken(token), null, 'Expired attachment link returns null');

    // 4. Archived attachment rejected
    originalAttachment.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    originalAttachment.is_archived = true;
    assert.equal(fileUploadService.verifyDownloadToken(token), null, 'Archived attachment link returns null');
  });
});
