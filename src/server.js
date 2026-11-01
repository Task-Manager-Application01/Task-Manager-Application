const { createServer } = require('./app');
const deadlineScheduler = require('./services/deadlineScheduler');

const PORT = process.env.PORT || 3000;
const server = createServer();

server.on('close', () => deadlineScheduler.stop());

server.listen(PORT, () => {
  deadlineScheduler.start(process.env.DEADLINE_CHECK_INTERVAL_MS);
  console.log(`================================================================`);
  console.log(`Task Manager API - Feature Set B (Task Lifecycle & Content)`);
  console.log(`Owner: Dhadhal Rudra | SRN: PES1UG24CS146 | Team #4 (Section C)`);
  console.log(`Server actively running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`================================================================`);
});
