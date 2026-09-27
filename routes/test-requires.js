console.log("Testing all requires...\n");

const files = [
  "./config/index.js",
  "./logs/logger.js",
  "./storage/settings.js",
  "./storage/queue.js",
  "./auth/supabase.js",
  "./middleware/auth.js",
  "./services/printExecutor.js",
  "./services/printer.js",
  "./routes/health.js",
  "./routes/printers.js",
  "./routes/print.js",
  "./routes/auth.js",
  "./routes/settings.js",
];

for (const file of files) {
  try {
    const mod = require(file);
    const type = typeof mod;
    const keys = type === "object" && mod !== null ? Object.keys(mod).join(", ") : type;
    console.log(`✅ ${file} — ${type}${keys ? " (" + keys + ")" : ""}`);
  } catch (err) {
    console.log(`❌ ${file} — FAILED:`);
    console.log("   " + err.message);
    console.log("   " + (err.stack.split("\n")[1]?.trim() || ""));
  }
}