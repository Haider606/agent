const express = require("express");
const { login, logout } = require("../auth/supabase");
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

router.get("/session", (req, res) => {
  try {
    const auth = settings.getAuth();
    if (!auth.accessToken) {
      return res.json({ success: true, loggedIn: false });
    }
    res.json({
      success: true,
      loggedIn: true,
      session: {
        email: auth.email,
        role: auth.role,
        branchId: auth.branchId,
        branchName: auth.branchName,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;