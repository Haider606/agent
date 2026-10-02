const { createClient } = require("@supabase/supabase-js");
const settings = require("../storage/settings");
const { executePrint } = require("./printExecutor");
const logger = require("../logs/logger");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const POLL_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;

// Custom fetch that aborts after timeout — actually cancels the request
function createFetchWithTimeout(timeoutMs) {
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

// Single reusable Supabase client — never recreated
let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createFetchWithTimeout(REQUEST_TIMEOUT_MS),
      headers: { "x-client-info": "stocko-print-agent" },
    },
  });
}

let timeoutId = null;
let isRunning = false;
let isPolling = false;
let currentSession = null;
let consecutiveErrors = 0;

function getSupabase() {
  if (!supabase) {
    throw new Error("Supabase credentials missing in environment");
  }
  return supabase;
}

async function ensureSession() {
  const auth = settings.getAuth();
  if (!auth.accessToken || !auth.refreshToken) {
    currentSession = null;
    return false;
  }

  // Only set session when tokens actually changed
  if (
    currentSession &&
    currentSession.access_token === auth.accessToken &&
    currentSession.refresh_token === auth.refreshToken
  ) {
    return true;
  }

  try {
    const { error } = await getSupabase().auth.setSession({
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
    });
    if (error) throw error;
    currentSession = {
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
    };
    return true;
  } catch (err) {
    logger.warn(`[CloudQueue] Session refresh failed: ${err.message}`);
    currentSession = null;
    return false;
  }
}

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    const auth = settings.getAuth();
    const cloud = settings.getCloud();

    if (!auth.accessToken || !auth.refreshToken || !auth.branchId) {
      consecutiveErrors = 0;
      return;
    }
    if (!cloud.agentId) {
      consecutiveErrors = 0;
      return;
    }

    const hasSession = await ensureSession();
    if (!hasSession) return;

    const sb = getSupabase();

    const { data: jobs, error } = await sb
      .from("print_jobs")
      .select("*")
      .eq("branch_id", auth.branchId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);

    if (error) {
      logger.error(`[CloudQueue] Fetch error: ${error.message}`);
      consecutiveErrors++;
      return;
    }

    consecutiveErrors = 0;

    if (!jobs || jobs.length === 0) return;

    for (const job of jobs) {
      try {
        const { data: locked, error: lockErr } = await sb
          .from("print_jobs")
          .update({
            status: "processing",
            agent_id: cloud.agentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          .eq("status", "pending")
          .select()
          .single();

        if (lockErr || !locked) continue;

        logger.info(`[CloudQueue] Printing job ${job.id}`);
        const { printer, order, receipt, type } = job.payload || {};
        const targetPrinter = printer || settings.getPrinters().receipt;

        if (!targetPrinter) {
          throw new Error("No printer assigned in agent settings");
        }

        await executePrint({
          printer: targetPrinter,
          order,
          receipt,
          type,
          payload: job.payload,
        });

        await sb
          .from("print_jobs")
          .update({
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        logger.info(`[CloudQueue] Job ${job.id} completed`);
      } catch (err) {
        logger.logError(`[CloudQueue] Job ${job.id} failed`, err);
        try {
          await sb
            .from("print_jobs")
            .update({
              status: "failed",
              error_message: err.message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);
        } catch (updateErr) {
          logger.warn(`[CloudQueue] Failed to mark job ${job.id} as failed: ${updateErr.message}`);
        }
      }
    }
  } catch (err) {
    logger.logError("[CloudQueue] Poll crashed", err);
    consecutiveErrors++;
  } finally {
    isPolling = false;
  }
}

function getBackoffDelay() {
  if (consecutiveErrors === 0) return POLL_INTERVAL_MS;
  // Exponential backoff capped at 60 s
  return Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), 60000);
}

async function loop() {
  if (!isRunning) return;

  try {
    await poll();
  } catch (err) {
    logger.logError("[CloudQueue] Loop error", err);
  }

  if (isRunning) {
    const delay = getBackoffDelay();
    timeoutId = setTimeout(loop, delay);
  }
}

function start() {
  if (isRunning) return;
  isRunning = true;
  consecutiveErrors = 0;
  logger.info("[CloudQueue] Started polling for cloud print jobs");
  loop();
}

function stop() {
  isRunning = false;
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  isPolling = false;
  currentSession = null;
  logger.info("[CloudQueue] Stopped");
}

module.exports = { start, stop };