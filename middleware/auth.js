
const { validateSession } = require("../auth/supabase");
const settings = require("../storage/settings");
const logger = require("../logs/logger");

/**
 * Verify the user is logged in.
 * Attaches `req.user` with session info if valid.
 */
async function requireAuth(req, res, next) {
  try {
    // Fast path: check local settings first
    if (!settings.isLoggedIn()) {
      return res.status(401).json({
        success: false,
        error: "Not authenticated. Please log in.",
      });
    }

    // Validate token with Supabase (also refreshes if needed)
    const result = await validateSession();
    if (!result.valid) {
      return res.status(401).json({
        success: false,
        error: result.error || "Session expired. Please log in again.",
      });
    }

    // Attach user info to request for downstream handlers
    const auth = settings.getAuth();
    req.user = {
      userId: auth.userId,
      email: auth.email,
      role: auth.role,
      branchId: auth.branchId,
      branchName: auth.branchName,
    };

    next();
  } catch (err) {
    logger.logError("[Middleware] Auth check failed", err);
    res.status(500).json({ success: false, error: "Authentication check failed" });
  }
}

/**
 * Verify the user has Manager role.
 * Must be used AFTER requireAuth.
 */
function requirePrinterAdmin(req, res, next) {
  const allowed = ["Manager", "Developer"];
  if (!req.user || !allowed.includes(req.user.role)) {
    logger.warn(`[Middleware] Printer settings access denied for ${req.user?.email}`);
    return res.status(403).json({
      success: false,
      error: "Manager or Developer access required.",
    });
  }
  next();
}

function requireDeveloper(req, res, next) {
  if (!req.user || req.user.role !== "Developer") {
    logger.warn(`[Middleware] Print calibration access denied for ${req.user?.email}`);
    return res.status(403).json({
      success: false,
      error: "Developer access required for print calibration.",
    });
  }
  next();
}

// Backward-compatible alias for older routes.
const requireManager = requirePrinterAdmin;

module.exports = {
  requireAuth,
  requireManager,
  requirePrinterAdmin,
  requireDeveloper,
};
