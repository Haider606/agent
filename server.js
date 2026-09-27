const express = require("express");
const cors = require("cors");
const { PORT, HOST, APP_NAME, APP_VERSION } = require("./config");
const logger = require("./logs/logger");

const healthRouter = require("./routes/health");
const printersRouter = require("./routes/printers");
const printRouter = require("./routes/print");
const authRouter = require("./routes/auth");
const settingsRouter = require("./routes/settings");
const cloudRouter = require("./routes/cloud");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send(`${APP_NAME} is working!`);
});

app.use("/health", healthRouter);
app.use("/printers", printersRouter);
app.use("/print", printRouter);
app.use("/auth", authRouter);
app.use("/settings", settingsRouter);
app.use("/cloud", cloudRouter);

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint not found" });
});

app.use((err, req, res, next) => {
  logger.logError("[Server] Unhandled error", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

let server;
const connections = new Set();

try {
  server = app.listen(PORT, HOST, () => {
    logger.info(
      `[Server] ${APP_NAME} v${APP_VERSION} running on http://${HOST}:${PORT}`
    );
  });

  server.on("connection", (conn) => {
    connections.add(conn);
    conn.on("close", () => connections.delete(conn));
  });

  server.on("error", (error) => {
    logger.logError("[Server] Server error", error);
  });
} catch (err) {
  logger.logError("[Server] Failed to start server", err);
  process.exit(1);
}

// Graceful shutdown with hard fallback
server.forceClose = function (callback, timeoutMs = 3000) {
  this.close(callback);
  setTimeout(() => {
    connections.forEach((conn) => {
      try {
        conn.destroy();
      } catch (e) {}
    });
  }, timeoutMs);
};

module.exports = server;