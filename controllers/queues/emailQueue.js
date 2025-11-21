const Queue = require("bull");
const emailQueue = new Queue("emailQueue", {
  redis: {
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: null,   // disable ioredis request retry limit
    retryStrategy(times) {
      return Math.min(times * 50, 2000); // backoff retry
    }
  }
});

module.exports = emailQueue;
