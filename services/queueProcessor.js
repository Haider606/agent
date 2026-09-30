const { executePrint } = require("./printExecutor");
const queue = require("../storage/queue");
const logger = require("../logs/logger");

/**
 * Process all pending and retryable jobs in the queue.
 * Called periodically by the heartbeat service.
 */
async function processQueue() {
  try {
    const allJobs = queue.getAll().jobs;
    const pending = allJobs.filter((j) => j.status === "pending");
    const retryable = allJobs.filter(
      (j) => j.status === "failed" && j.retryCount < 5
    );
    const jobs = [...pending, ...retryable];

    if (jobs.length === 0) return;

    logger.info(
      `[QueueProcessor] Processing ${jobs.length} jobs (${pending.length} pending, ${retryable.length} retryable)`
    );

    for (const job of jobs) {
      await processJob(job);
    }
  } catch (err) {
    logger.logError("[QueueProcessor] Queue processing failed", err);
  }
}

/**
 * Process a single job.
 */
async function processJob(job) {
  try {
    queue.markProcessing(job.id);
    logger.info(`[QueueProcessor] Processing job ${job.id}`);

    const { printer, order, receipt } = job.payload;
    await executePrint({ printer, order, receipt });

    queue.markCompleted(job.id);
    logger.info(`[QueueProcessor] Job ${job.id} completed`);
  } catch (err) {
    queue.markFailed(job.id, err.message);
    logger.warn(`[QueueProcessor] Job ${job.id} failed: ${err.message}`);

    const stats = queue.getStats();
    if (stats.dead > 0) {
      logger.error(
        `[QueueProcessor] ${stats.dead} jobs have exceeded max retries`
      );
    }
  }
}

module.exports = {
  processQueue,
  processJob,
};