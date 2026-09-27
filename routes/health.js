const express = require("express");
const { APP_NAME, APP_VERSION } = require("../config");
const queue = require("../storage/queue");
const logger = require("../logs/logger");

const router = express.Router();

router.get("/", (req, res) => {
  const stats = queue.getStats();
  logger.debug(`[Health] Ping — queue: ${JSON.stringify(stats)}`);
  res.json({
    success: true,
    status: "ok",
    service: APP_NAME,
    version: APP_VERSION,
    queue: stats,
  });
});

module.exports = router;