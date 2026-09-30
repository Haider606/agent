const express = require("express");
const { login, logout, validateSession } = require("../auth/supabase");
const settings = require("../storage/settings");
const logger = require("../logs/logger");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password required" });
    }
    const result = await login(email, password);
    if (result.success) {
      res.json({ success: true, session: result.session });
    } else {
      res.status(401).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    await logout();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/session", async (req, res) => {
  try {
    const auth = settings.getAuth();
    if (!auth.accessToken || !auth.refreshToken) {
      return res.json({ success: true, loggedIn: false });
    }

    // Restore and refresh the saved Supabase session on every app start.
    // The local session is cleared only when it can no longer be refreshed
    // (or when the user explicitly logs out).
    const validation = await validateSession();
    if (!validation.valid) {
      return res.json({ success: true, loggedIn: false, reason: validation.error });
    }

    const restored = settings.getAuth();
    res.json({
      success: true,
      loggedIn: true,
      session: {
        email: restored.email,
        role: restored.role,
        branchId: restored.branchId,
        branchName: restored.branchName,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;