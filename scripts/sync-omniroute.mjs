import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fetchUsageDataFromSqlite, generateCardSvg } from "./generate-omniroute-card.mjs";

const REPO_DIR = path.resolve(import.meta.dirname, "..");
const HOME = process.env.HOME || "/Users/adibrushanfikrraharjo";
const DB_PATH = path.join(HOME, ".omniroute", "storage.sqlite");
const STATE_FILE = path.join(HOME, ".omniroute", "last-github-sync.json");
const SVG_OUTPUT = path.join(REPO_DIR, "assets", "omniroute-overview.svg");

// Minimum interval between automated pushes (in milliseconds) - 4 hours
const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;

function isOmniRouteRunning() {
  try {
    const res = execSync("pgrep -f omniroute || true", { encoding: "utf-8" }).trim();
    return res.length > 0;
  } catch {
    return false;
  }
}

function runCommand(cmd, cwd = REPO_DIR) {
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

export async function syncOmniRoute(force = false) {
  console.log(`[${new Date().toISOString()}] Checking OmniRoute usage status...`);

  if (!fs.existsSync(DB_PATH)) {
    console.log(`OmniRoute database not found at ${DB_PATH}. Skipping.`);
    return;
  }

  const running = isOmniRouteRunning();
  console.log(`OmniRoute running status: ${running ? "ONLINE" : "OFFLINE"}`);

  // Fetch usage and render SVG
  const map = fetchUsageDataFromSqlite(DB_PATH);
  const svg = generateCardSvg(map);
  
  // Ensure assets dir exists
  fs.mkdirSync(path.dirname(SVG_OUTPUT), { recursive: true });
  fs.writeFileSync(SVG_OUTPUT, svg, "utf-8");

  // Check if git detects diff in SVG
  const diff = runCommand(`git status --porcelain assets/omniroute-overview.svg`);
  if (!diff) {
    console.log("No token count or visual changes detected in assets/omniroute-overview.svg. Up to date.");
    return;
  }

  console.log("Card SVG has updated content. Checking sync throttle...");

  let lastSync = 0;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      lastSync = data.lastSyncTimestamp || 0;
    } catch {}
  }

  const now = Date.now();
  const timeSinceLastSync = now - lastSync;

  if (!force && timeSinceLastSync < MIN_INTERVAL_MS) {
    const remainingMins = Math.round((MIN_INTERVAL_MS - timeSinceLastSync) / 60000);
    console.log(`Throttled: Last push was ${Math.round(timeSinceLastSync / 60000)}m ago. Next allowed in ${remainingMins}m. Use --force to bypass.`);
    return;
  }

  // Push to GitHub
  console.log("Pushing updated OmniRoute overview to GitHub...");
  try {
    runCommand("git add assets/omniroute-overview.svg");
    runCommand(`git commit -m "chore(stats): update OmniRoute AI usage overview card [skip ci]"`);
    runCommand("git push origin main");

    // Save sync state
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          lastSyncTimestamp: now,
          lastSyncDate: new Date(now).toISOString(),
          activeDaysCount: map.size
        },
        null,
        2
      ),
      "utf-8"
    );

    console.log("Successfully synced OmniRoute AI usage overview card to GitHub!");
  } catch (err) {
    console.error("Failed to commit or push to GitHub:", err.message);
  }
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith("sync-omniroute.mjs")) {
  const force = process.argv.includes("--force");
  syncOmniRoute(force);
}
