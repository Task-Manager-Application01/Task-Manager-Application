'use strict';

/**
 * Shared input rules for accounts (REQ-1.1).
 * Owner: Chetana V Iyer (PES1UG24CS130) | ARC-AUTH | DSN-01
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 digit, and 1 special character.';

module.exports = { EMAIL_REGEX, PASSWORD_REGEX, PASSWORD_RULE_MESSAGE };
