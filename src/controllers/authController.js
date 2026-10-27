'use strict';

const { db } = require('../models/Database');
const {
  hashPassword,
  verifyPassword,
  generateJWT
} = require('../middleware/authMiddleware');
const { sanitizeString } = require('../middleware/validationMiddleware');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

const GENERIC_SERVER_ERROR = 'An unexpected error occurred.';

/**
 * Auth Controller
 * Owner: Chetana V Iyer | PES1UG24CS130
 *
 * Feature Set A — Authentication, RBAC and Workspaces
 * REQ-1.1: Account Registration
 * REQ-1.2: Secure Authentication using JWT
 * REQ-1.3: Password Recovery
 */
class AuthController {
  /**
   * REQ-1.1 — Register a user.
   *
   * Validates the full name, email and password.
   * Password requirements:
   * - At least 8 characters
   * - At least one uppercase letter
   * - At least one digit
   * - At least one special character
   */
  async register(req, res) {
    try {
      const body = req.body || {};
      const { full_name, password } = body;

      const email =
        typeof body.email === 'string'
          ? body.email.trim().toLowerCase()
          : '';

      const errors = [];

      if (
        typeof full_name !== 'string' ||
        full_name.trim().length === 0
      ) {
        errors.push('full_name is required.');
      }

      if (!EMAIL_REGEX.test(email)) {
        errors.push('A valid email address is required.');
      }

      if (
        typeof password !== 'string' ||
        !PASSWORD_REGEX.test(password)
      ) {
        errors.push(
          'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 digit, and 1 special character.'
        );
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Registration Validation Failed',
          details: errors
        });
      }

      const existingUser = db.findUserByEmail(email);

      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'An account with this email already exists.'
        });
      }

      const passwordHash = hashPassword(password);

      const newUser = db.createUser({
        full_name: sanitizeString(full_name),
        email,
        password_hash: passwordHash
      });

      const token = generateJWT({
        userId: newUser.user_id,
        email: newUser.email,
        name: newUser.full_name
      });

      return res.status(201).json({
        success: true,
        message: 'Account registered successfully.',
        data: {
          user_id: newUser.user_id,
          full_name: newUser.full_name,
          email: newUser.email,
          token
        }
      });
    } catch (err) {
      console.error('Registration error:', err.message);

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: GENERIC_SERVER_ERROR
      });
    }
  }

  /**
   * REQ-1.2 — Authenticate a user.
   *
   * Verifies the supplied password against its salted hash
   * and returns a signed JWT on successful authentication.
   */
  async login(req, res) {
    try {
      const body = req.body || {};

      const email =
        typeof body.email === 'string'
          ? body.email.trim().toLowerCase()
          : '';

      const { password } = body;

      if (!email || typeof password !== 'string' || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required.'
        });
      }

      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'A valid email address is required.'
        });
      }

      const user = db.findUserByEmail(email);

      if (
        !user ||
        typeof user.password_hash !== 'string' ||
        !verifyPassword(password, user.password_hash)
      ) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Invalid email or password.'
        });
      }

      const token = generateJWT({
        userId: user.user_id,
        email: user.email,
        name: user.full_name
      });

      return res.status(200).json({
        success: true,
        message: 'Authentication successful.',
        data: {
          user_id: user.user_id,
          full_name: user.full_name,
          email: user.email,
          token
        }
      });
    } catch (err) {
      console.error('Login error:', err.message);

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: GENERIC_SERVER_ERROR
      });
    }
  }

  /**
   * REQ-1.3 — Request a password reset.
   *
   * Creates a reset token for an existing account.
   * The database controls the token's 15-minute expiry.
   *
   * The response for an unknown email does not reveal
   * whether the account exists.
   */
  async requestPasswordReset(req, res) {
    try {
      const body = req.body || {};

      const email =
        typeof body.email === 'string'
          ? body.email.trim().toLowerCase()
          : '';

      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'A valid email address is required.'
        });
      }

      const user = db.findUserByEmail(email);

      if (!user) {
        return res.status(200).json({
          success: true,
          message:
            'If the email is registered, a password reset link has been dispatched.'
        });
      }

      const resetToken = db.createPasswordResetToken(email);

      return res.status(200).json({
        success: true,
        message: 'Password reset token generated (valid for 15 minutes).',
        resetToken
      });
    } catch (err) {
      console.error('Password reset request error:', err.message);

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: GENERIC_SERVER_ERROR
      });
    }
  }

  /**
   * REQ-1.3 — Reset a password using a valid reset token.
   *
   * Validates the new password, verifies the token,
   * updates the stored password hash, and consumes the token.
   */
  async resetPassword(req, res) {
    try {
      const body = req.body || {};
      const { token, new_password } = body;

      if (
        typeof token !== 'string' ||
        token.trim().length === 0 ||
        typeof new_password !== 'string' ||
        new_password.length === 0
      ) {
        return res.status(400).json({
          success: false,
          error: 'Token and new_password are required.'
        });
      }

      if (!PASSWORD_REGEX.test(new_password)) {
        return res.status(400).json({
          success: false,
          error: 'New password does not meet complexity requirements.'
        });
      }

      const email = db.verifyPasswordResetToken(token);

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired password reset token.'
        });
      }

      const newPasswordHash = hashPassword(new_password);

      const updated = db.updateUserPassword(
        email,
        newPasswordHash
      );

      if (!updated) {
        return res.status(400).json({
          success: false,
          error: 'Unable to update the password for this account.'
        });
      }

      db.consumePasswordResetToken(token);

      return res.status(200).json({
        success: true,
        message: 'Password has been updated successfully.'
      });
    } catch (err) {
      console.error('Password reset error:', err.message);

      return res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: GENERIC_SERVER_ERROR
      });
    }
  }
}

module.exports = new AuthController();
