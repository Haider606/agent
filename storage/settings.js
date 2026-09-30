const fs = require("fs");
const { SETTINGS_FILE } = require("../config");
const logger = require("../logs/logger");

const DEFAULT_SETTINGS = {
  auth: {
    accessToken: null,
    refreshToken: null,
    userId: null,
    email: null,
    role: null,
    branchId: null,
    branchName: null,
    loggedInAt: null,
  },
  printers: {
    receipt: null,
    dispatch: null,
    label: null,
  },
  print: {
    paperWidthMm: 80,
    printableWidthMm: 70,
    marginLeftMm: 4,
    marginRightMm: 6,
    fontScale: 1,
    driverScale: "fit",
  },
  cloud: {
    agentId: null,
    registeredAt: null,
  },
  app: {
    firstRun: true,
    version: "2.2.0",
  },
};

let cache = null;

function readSettingsFromDisk() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      logger.info("[Settings] No settings file found. Creating defaults.");
      writeSettingsToDisk(DEFAULT_SETTINGS);
      cache = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      return cache;
    }

    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const merged = deepMerge(DEFAULT_SETTINGS, parsed);
    cache = merged;
    return merged;
  } catch (err) {
    logger.logError("[Settings] Failed to read settings", err);
    cache = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    return cache;
  }
}

function getSettings() {
  if (cache === null) {
    return readSettingsFromDisk();
  }
  return cache;
}

function writeSettingsToDisk(settings) {
  try {
    const dir = require("path").dirname(SETTINGS_FILE);
    fs.mkdirSync(dir, { recursive: true });

    const tempFile = SETTINGS_FILE + ".tmp";
    fs.writeFileSync(tempFile, JSON.stringify(settings, null, 2), "utf8");
    fs.renameSync(tempFile, SETTINGS_FILE);

    return true;
  } catch (err) {
    logger.logError("[Settings] Failed to write settings", err);
    return false;
  }
}

function writeSettings(settings) {
  cache = settings;
  return writeSettingsToDisk(settings);
}

function deepMerge(defaults, overrides) {
  const result = JSON.parse(JSON.stringify(defaults));

  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] !== null &&
      typeof overrides[key] === "object" &&
      !Array.isArray(overrides[key])
    ) {
      result[key] = deepMerge(result[key] || {}, overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }

  return result;
}

module.exports = {
  getAll: getSettings,
  getAuth: () => getSettings().auth,
  getPrinters: () => getSettings().printers,
  getCloud: () => getSettings().cloud,
  getPrint: () => getSettings().print,
  setAuth: (authData) => {
    const s = getSettings();
    s.auth = { ...s.auth, ...authData, loggedInAt: new Date().toISOString() };
    return writeSettings(s);
  },
  clearAuth: () => {
    const s = getSettings();
    s.auth = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.auth));
    return writeSettings(s);
  },
  setPrinters: (printerMap) => {
    const s = getSettings();
    s.printers = { ...s.printers, ...printerMap };
    return writeSettings(s);
  },
  setPrint: (printData) => {
    const s = getSettings();
    s.print = { ...s.print, ...printData };
    return writeSettings(s);
  },
  setCloud: (cloudData) => {
    const s = getSettings();
    s.cloud = { ...s.cloud, ...cloudData };
    return writeSettings(s);
  },
  isManager: () => {
    const role = getSettings().auth.role;
    return role === "Manager" || role === "Developer";
  },
  isLoggedIn: () => {
    const auth = getSettings().auth;
    return !!(auth.accessToken && auth.userId && auth.branchId);
  },
  reload: readSettingsFromDisk,
};