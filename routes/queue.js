

const express = require("express");
const queue = require("../storage/queue");
const { requireAuth } = require("../middleware/auth");
const logger = require("../logs/logger");

const router = express.Router();

/**
 * GET /queue/stats
 */
router.get("/stats", requireAuth, (req, res) => {
  try {
    const stats = queue.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    logger.logError("[Queue] Failed to get stats", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /queue/jobs
 */
router.get("/jobs", requireAuth, (req, res) => {
  try {
    const q = queue.getAll();
    res.json({ success: true, jobs: q.jobs });
  } catch (error) {
    logger.logError("[Queue] Failed to get jobs", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /queue/retry/:id
 * Reset a failed job to pending so the processor picks it up.
 */
router.post("/retry/:id", requireAuth, (req, res) => {
  try {
    const q = queue.getAll();
    const job = q.jobs.find((j) => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    if (job.status === "completed") {
      return res.status(400).json({ success: false, error: "Job already completed" });
    }

    job.status = "pending";
    job.updatedAt = new Date().toISOString();
    require("../storage/queue").writeQueue(q); // persist

    logger.info(`[Queue] Job ${req.params.id} manually queued for retry`);
    res.json({ success: true, message: "Job queued for retry" });
  } catch (error) {
    logger.logError("[Queue] Retry failed", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /queue/:id
 */
router.delete("/:id", requireAuth, (req, res) => {
  try {
    queue.remove(req.params.id);
    res.json({ success: true, message: "Job removed" });
  } catch (error) {
    logger.logError("[Queue] Remove failed", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
