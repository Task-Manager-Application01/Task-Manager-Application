/**
 * Real-time Event Broadcast (Server-Sent Events)
 * Feature 5 — Task Assignment & Kanban Workflow Engine
 * SRS 4.3.1 stimulus/response: a card move is broadcast to other active viewers.
 *
 * Subscribers are grouped by workspace, so an event is only ever written to
 * connections that were authorized for that workspace when they subscribed.
 */

const HEARTBEAT_MS = 25000;

class RealtimeService {
  constructor() {
    this.subscribers = new Map(); // workspaceId -> Set<res>
    this.owners = new WeakMap(); // res -> userId of the subscriber
  }

  subscribe(workspaceId, req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');

    if (!this.subscribers.has(workspaceId)) this.subscribers.set(workspaceId, new Set());
    const group = this.subscribers.get(workspaceId);
    group.add(res);
    if (req.user) this.owners.set(res, req.user.userId);

    // Comment lines keep proxies from closing idle streams and surface dead sockets.
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    heartbeat.unref();

    const cleanup = () => {
      clearInterval(heartbeat);
      group.delete(res);
      if (group.size === 0 && this.subscribers.get(workspaceId) === group) {
        this.subscribers.delete(workspaceId);
      }
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
  }

  publish(workspaceId, eventName, data) {
    const group = this.subscribers.get(workspaceId);
    if (!group) return 0;
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    let delivered = 0;
    for (const res of [...group]) {
      try {
        res.write(frame);
        delivered++;
      } catch (err) {
        group.delete(res);
      }
    }
    return delivered;
  }

  /**
   * Closes a user's open streams for a workspace, e.g. when they are removed from it.
   * Authorization is checked when a stream opens, so it must also be cut when access ends.
   */
  disconnectUser(workspaceId, userId) {
    const group = this.subscribers.get(workspaceId);
    if (!group) return 0;
    let closed = 0;
    for (const res of [...group]) {
      if (this.owners.get(res) !== userId) continue;
      group.delete(res);
      try { res.end(); } catch (err) { /* already closed */ }
      closed++;
    }
    if (group.size === 0 && this.subscribers.get(workspaceId) === group) {
      this.subscribers.delete(workspaceId);
    }
    return closed;
  }

  subscriberCount(workspaceId) {
    const group = this.subscribers.get(workspaceId);
    return group ? group.size : 0;
  }
}

module.exports = new RealtimeService();
