

const express = require("express");
const { getStatus } = require("../services/cloudSync");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /cloud/status
 * Returns cloud connection status.
 */
router.get("/status", requireAuth, (req, res) => {
  res.json({
    success: true,
    cloud: getStatus(),
  });
});

module.exports = router;
