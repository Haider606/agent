const settings = require("../storage/settings");

module.exports = {
  registerAgent: async () => ({ success: true }),

  sendHeartbeat: async () => ({ success: true, online: true }),

  sendOfflinePulse: async () => {},

  getStatus: () => ({
    online: true,
    localMode: true,
    message: "Local mode — agent is running",
    agentId: settings.getCloud().agentId,
    lastHeartbeatAt: new Date().toISOString(),
  }),

  getBackoffMs: () => 30000,

  resetBackoff: () => {},
};