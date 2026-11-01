/**
 * Replaceable email sender. SMTP is out of scope in the STP, so the default transport only logs.
 * Owner: Harsh Pandya | PES1UG24CS182
 * REQ-8.2 | ARC-NOTIF | DSN-08
 */
function logTransport({ to, subject }) {
  console.log(`[email stub] To: ${to} | Subject: ${subject}`);
}

class EmailService {
  constructor() {
    this.transport = logTransport;
  }

  /**
   * Sets the function that delivers messages. It receives { to, subject, text }.
   * Calling this with no argument restores the logging stub.
   */
  setTransport(transport = logTransport) {
    this.transport = transport;
  }

  /**
   * Sends in the background. Failures are logged and never reach the caller.
   */
  send(message) {
    return Promise.resolve()
      .then(() => this.transport(message))
      .catch(err => {
        console.error(`Email to ${message.to} failed:`, err.message);
      });
  }
}

module.exports = new EmailService();
