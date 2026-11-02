const crypto = require('crypto');
const path = require('path');
const { db } = require('../models/Database');
const auditLogger = require('./auditLogger');

/**
 * File Upload & Attachment Service (Owner: Dhadhal Rudra | PES1UG24CS146)
 * Implements Feature 4: REQ-4.3 (Secure File Attachments)
 * Architectural Reference: ARC-FILE | Design Reference: DSN-04
 */
class FileUploadService {
  constructor() {
    // 10 MB strictly per Section 2.5 and REQ-4.3
    this.MAX_FILE_SIZE = 10 * 1024 * 1024; // 10,485,760 bytes

    // Allowed MIME types per Section 2.5: PDF, PNG, JPG, DOCX, ZIP
    this.ALLOWED_MIME_TYPES = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/zip',
      'application/x-zip-compressed'
    ]);

    this.ALLOWED_EXTENSIONS = new Set([
      '.pdf',
      '.png',
      '.jpg',
      '.jpeg',
      '.docx',
      '.doc',
      '.zip'
    ]);
  }

  /**
   * Validates file upload constraints
   */
  validateFile({ fileName, fileSize, mimeType }) {
    const errors = [];

    if (!fileName || typeof fileName !== 'string') {
      errors.push('File name is required.');
    } else {
      const ext = path.extname(fileName).toLowerCase();
      if (!this.ALLOWED_EXTENSIONS.has(ext)) {
        errors.push(`File extension '${ext}' is not permitted. Allowed extensions: .pdf, .png, .jpg, .jpeg, .docx, .zip`);
      }
    }

    if (typeof fileSize !== 'number' || fileSize <= 0) {
      errors.push('File size must be a positive integer.');
    } else if (fileSize > this.MAX_FILE_SIZE) {
      errors.push(`File size (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds the 10 MB maximum limit.`);
    }

    if (!mimeType || !this.ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
      errors.push(`MIME type '${mimeType}' is not supported. Allowed formats: PDF, PNG, JPG, DOCX, ZIP.`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Processes and commits attachment record with cryptographic download token
   */
  async processAttachment({ taskId, fileName, fileSize, mimeType, uploadedBy, fileBuffer }) {
    const parentTask = db.getTask(taskId);
    if (!parentTask) {
      throw new Error(`Task '${taskId}' does not exist or has been archived.`);
    }

    const validation = this.validateFile({ fileName, fileSize, mimeType });
    if (!validation.isValid) {
      const error = new Error('File validation failed: ' + validation.errors.join(' '));
      error.validationErrors = validation.errors;
      error.statusCode = fileSize > this.MAX_FILE_SIZE ? 413 : 415;
      throw error;
    }

    // Generate secure download token and hash
    const downloadToken = crypto.randomBytes(32).toString('hex');
    const sanitizedFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `secure_uploads/${taskId}/${crypto.randomUUID()}_${sanitizedFileName}`;

    const attachmentRecord = db.createAttachment({
      task_id: taskId,
      file_name: sanitizedFileName,
      file_size: fileSize,
      mime_type: mimeType.toLowerCase(),
      storage_path: storagePath,
      download_token: downloadToken,
      uploaded_by: uploadedBy
    });

    auditLogger.log({
      workspaceId: parentTask.workspace_id,
      actorId: uploadedBy,
      action: 'ATTACHMENT_UPLOADED',
      targetEntity: 'ATTACHMENT',
      targetId: attachmentRecord.attachment_id,
      details: { task_id: taskId, file_name: sanitizedFileName, file_size: fileSize }
    });

    const secureDownloadUrl = `/api/v1/attachments/download/${downloadToken}`;

    return {
      attachment: attachmentRecord,
      secure_download_url: secureDownloadUrl,
      expires_in_hours: 24
    };
  }

  /**
   * Validates download token and retrieves attachment
   */
  verifyDownloadToken(downloadToken, now = new Date()) {
    if (!downloadToken || typeof downloadToken !== 'string') {
      return null;
    }

    const currentTime = (now instanceof Date ? now : new Date(now)).getTime();

    for (const att of db.attachments.values()) {
      if (att.download_token === downloadToken) {
        if (att.is_archived) {
          return null;
        }

        const expiryTime = att.expires_at
          ? new Date(att.expires_at).getTime()
          : (att.uploaded_at ? new Date(att.uploaded_at).getTime() + 24 * 60 * 60 * 1000 : null);

        if (expiryTime && currentTime > expiryTime) {
          return null;
        }

        return att;
      }
    }
    return null;
  }
}

module.exports = new FileUploadService();
