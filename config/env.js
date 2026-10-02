const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function loadEnvironment(options = {}) {
  const isPackaged = Boolean(options.isPackaged);
  const resourcesPath = options.resourcesPath || process.resourcesPath;
  const appDir = options.appDir || path.join(__dirname, "..");

  const candidates = isPackaged
    ? [path.join(resourcesPath || appDir, ".env"), path.join(appDir, ".env")]
    : [path.join(appDir, ".env")];

  for (const envPath of candidates) {
    if (envPath && fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      break;
    }
  }

  // Stocko web uses VITE_* names. The Electron agent historically used
  // SUPABASE_* names. Accept both so the same Supabase project config works.
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }
  if (!process.env.SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  }

  return {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  };
}

module.exports = { loadEnvironment };
