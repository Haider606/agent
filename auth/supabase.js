


const { createClient } = require("@supabase/supabase-js");
const { v4: uuidv4 } = require("uuid");
const settings = require("../storage/settings");
const { registerAgent } = require("../services/cloudSync");
const logger = require("../logs/logger");

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

let supabase = null;

function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        "Supabase credentials missing. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables."
      );
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
      },
    });
  }
  return supabase;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function login(email, password) {
  try {
    const client = getClient();

    const { data: authData, error: authError } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.session) {
      logger.warn(`[Auth] Login failed for ${email}: ${authError?.message}`);
      return { success: false, error: authError?.message || "Invalid credentials" };
    }

    const { user, session } = authData;
    logger.info(`[Auth] User ${email} authenticated. UID: ${user.id}`);

    // Query users table
    const { data: userRow, error: userError } = await client
      .from("users")
      .select("role, branch_id")
      .eq("auth_id", user.id)
      .single();

    if (userError || !userRow) {
      logger.logError("[Auth] Failed to resolve user row", userError || new Error("No row found"));
      return { success: false, error: "User profile not found. Contact administrator." };
    }

    const { role, branch_id: branchId } = userRow;
    logger.info(`[Auth] Resolved role=${role}, branch_id=${branchId}`);

    // Query branches table
    let branchName = "Unknown Branch";
    if (branchId) {
      const { data: branchRow, error: branchError } = await client
        .from("branches")
        .select("name")
        .eq("id", branchId)
        .single();

      if (branchError) {
        logger.warn(`[Auth] Could not resolve branch name: ${branchError.message}`);
      } else if (branchRow) {
        branchName = branchRow.name;
        logger.info(`[Auth] Resolved branch name: ${branchName}`);
      }
    }

    // Generate agent ID on first login if not present
    const cloud = settings.getCloud();
    if (!cloud.agentId) {
      settings.setCloud({
        agentId: uuidv4(),
        registeredAt: new Date().toISOString(),
      });
      logger.info(`[Auth] Generated new agent ID`);
    }

    // Persist auth
    settings.setAuth({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      userId: user.id,
      email: user.email,
      role,
      branchId,
      branchName,
    });

    // Register with cloud (fire-and-forget, don't block login)
    registerAgent().catch((err) => {
      logger.warn(`[Auth] Cloud registration deferred: ${err.message}`);
    });

    return {
      success: true,
      session: {
        email: user.email,
        role,
        branchId,
        branchName,
        agentId: settings.getCloud().agentId,
      },
    };
  } catch (err) {
    logger.logError("[Auth] Unexpected login error", err);
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

async function logout() {
  try {
    const client = getClient();
    await client.auth.signOut();
  } catch (err) {
    logger.warn(`[Auth] Sign-out API call failed (ignoring): ${err.message}`);
  }

  settings.clearAuth();
  logger.info("[Auth] Session cleared locally");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Session validation
// ---------------------------------------------------------------------------

async function validateSession() {
  try {
    const auth = settings.getAuth();
    if (!auth.accessToken) {
      return { valid: false, error: "No session stored" };
    }

    const client = getClient();

    const { data, error } = await client.auth.setSession({
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
    });

    if (error || !data.session) {
      const message = error?.message || "Session unavailable";
      const status = Number(error?.status || 0);
      const normalized = message.toLowerCase();
      const definitelyInvalid =
        status === 400 ||
        status === 401 ||
        normalized.includes("refresh token") ||
        normalized.includes("invalid token") ||
        normalized.includes("jwt");

      logger.warn(`[Auth] Session restore failed: ${message}`);

      if (definitelyInvalid) {
        settings.clearAuth();
        return { valid: false, error: message };
      }

      // Network/server outages must not sign the client out. Keep the saved
      // identity locally and retry token refresh when connectivity returns.
      logger.info("[Auth] Keeping saved login during temporary connectivity failure");
      return { valid: true, offline: true, user: null };
    }

    if (data.session.access_token !== auth.accessToken) {
      settings.setAuth({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
      logger.info("[Auth] Access token refreshed");
    }

    return { valid: true, user: data.user };
  } catch (err) {
    logger.logError("[Auth] Session validation error", err);
    return { valid: false, error: err.message };
  }
}

module.exports = {
  login,
  logout,
  validateSession,
  getClient,
};
