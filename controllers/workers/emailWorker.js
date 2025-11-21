const emailQueue = require("../queues/emailQueue");
const { sendMail } = require("../../utils/mailHelper");

emailQueue.process(async (job, done) => {
  try {
    const { email, subject, html } = job.data;

    return sendMail(email, subject, html);
    console.log('Mail sent in background success');

    done();
  } catch (error) {
    console.error("Email Worker Error:", error);
    done(error);
  }
});

// handle failures
emailQueue.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

// handle completed
emailQueue.on("completed", (job) => {
  console.log(`Job ${job.id} completed successfully`);
});