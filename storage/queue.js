const fs = require("fs");
const { QUEUE_FILE } = require("../config");
const logger = require("../logs/logger");

const DEFAULT_QUEUE = { jobs: [], lastProcessedAt: null };

let cache = null;

function readQueueFromDisk() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      writeQueueToDisk(DEFAULT_QUEUE);
      cache = JSON.parse(JSON.stringify(DEFAULT_QUEUE));
      return cache;
    }
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    cache = parsed;
    return parsed;
  } catch (err) {
    logger.logError("[Queue] Failed to read queue", err);
    cache = JSON.parse(JSON.stringify(DEFAULT_QUEUE));
    return cache;
  }
}

function getQueue() {
  if (cache === null) {
    return readQueueFromDisk();
  }
  return cache;
}

function writeQueueToDisk(queue) {
  try {
    const dir = require("path").dirname(QUEUE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tempFile = QUEUE_FILE + ".tmp";
    fs.writeFileSync(tempFile, JSON.stringify(queue, null, 2), "utf8");
    fs.renameSync(tempFile, QUEUE_FILE);
    return true;
  } catch (err) {
    logger.logError("[Queue] Failed to write queue", err);
    return false;
  }
}

function writeQueue(queue) {
  cache = queue;
  return writeQueueToDisk(queue);
}

module.exports = {
  getAll: getQueue,
  getPending: () => getQueue().jobs.filter((j) => j.status === "pending"),
  getRetryable: (maxRetries = 5) =>
    getQueue().jobs.filter(
      (j) => j.status === "failed" && j.retryCount < maxRetries
    ),
  enqueue: (payload) => {
    const q = getQueue();
    const job = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      payload,
      status: "pending",
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      errorMessage: null,
    };
    q.jobs.push(job);
    writeQueue(q);
    logger.info(`[Queue] Enqueued job ${job.id}`);
    return job;
  },
  markProcessing: (jobId) => {
    const q = getQueue();
    const job = q.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    job.status = "processing";
    job.updatedAt = new Date().toISOString();
    writeQueue(q);
    return true;
  },
  markCompleted: (jobId) => {
    const q = getQueue();
    const before = q.jobs.length;
    q.jobs = q.jobs.filter((j) => j.id !== jobId);
    q.lastProcessedAt = new Date().toISOString();
    writeQueue(q);
    if (q.jobs.length < before) logger.info(`[Queue] Completed job ${jobId}`);
    return true;
  },
  markFailed: (jobId, errorMessage) => {
    const q = getQueue();
    const job = q.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    job.status = "failed";
    job.retryCount += 1;
    job.errorMessage = errorMessage;
    job.updatedAt = new Date().toISOString();
    writeQueue(q);
    logger.warn(
      `[Queue] Job ${jobId} failed (retry ${job.retryCount}): ${errorMessage}`
    );
    return true;
  },
  remove: (jobId) => {
    const q = getQueue();
    q.jobs = q.jobs.filter((j) => j.id !== jobId);
    writeQueue(q);
    logger.info(`[Queue] Removed job ${jobId}`);
    return true;
  },
  getStats: () => {
    const q = getQueue();
    const pending = q.jobs.filter((j) => j.status === "pending").length;
    const processing = q.jobs.filter((j) => j.status === "processing").length;
    const failed = q.jobs.filter((j) => j.status === "failed").length;
    const dead = q.jobs.filter(
      (j) => j.status === "failed" && j.retryCount >= 5
    ).length;
    return { total: q.jobs.length, pending, processing, failed, dead };
  },
  reload: readQueueFromDisk,
};