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

function runCommand(cmd, cwd = REPO_DIR) {
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

function isOmniRouteRunning() {
  try {
    // Check listening port 20128 first (most reliable indicator of active OmniRoute server)
    const portCheck = execSync("lsof -iTCP:20128 -sTCP:LISTEN -n -P 2>/dev/null || true", {
      encoding: "utf-8"
    }).trim();
    if (portCheck.includes("20128")) return true;

    // Fallback: check node process running omniroute
    const procCheck = execSync("pgrep -f 'omniroute' || true", {
      encoding: "utf-8"
    }).trim();
    return procCheck.length > 0;
  } catch {
    return false;
  }
}

function getUnpushedCommitsCount() {
  try {
    const count = runCommand("git rev-list --count @{u}..HEAD 2>/dev/null || echo 0");
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

function safePull() {
  try {
    runCommand("git pull --ff-only origin main 2>/dev/null || true");
  } catch (err) {
    console.log(`[pull notice] Could not pull remote changes: ${err.message}`);
  }
}

export async function syncOmniRoute(force = false) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] --- OmniRoute Sync Check ---`);

  if (!fs.existsSync(DB_PATH)) {
    console.log(`Database not found at ${DB_PATH}. Exiting.`);
    return;
  }

  // 1. Check OmniRoute Online status
  const running = isOmniRouteRunning();
  if (!running && !force) {
    console.log("OmniRoute is OFFLINE. Skipping sync (only syncs when OmniRoute is online).");
    return;
  }
  console.log(`OmniRoute status: ${running ? "ONLINE" : "OFFLINE (forced run)"}`);

  // 2. Check and retry any pending unpushed commits from previous network interruptions
  const unpushed = getUnpushedCommitsCount();
  if (unpushed > 0) {
    console.log(`Found ${unpushed} unpushed commit(s) from previous session. Attempting push now...`);
    try {
      runCommand("git push origin main");
      console.log("Successfully pushed pending commits!");
    } catch (err) {
      console.error(`Pending push failed (network still unavailable): ${err.message}`);
      console.log("Will retry on the next cycle when connection is restored.");
      return;
    }
  }

  // 3. Fast-forward pull remote changes to stay clean
  safePull();

  // 4. Generate SVG from current SQLite usage
  const map = fetchUsageDataFromSqlite(DB_PATH);
  const svg = generateCardSvg(map);

  fs.mkdirSync(path.dirname(SVG_OUTPUT), { recursive: true });
  fs.writeFileSync(SVG_OUTPUT, svg, "utf-8");

  // 5. Check if SVG changed visually or in token counts
  const diff = runCommand("git status --porcelain assets/omniroute-overview.svg");
  if (!diff) {
    console.log("No token count or visual changes detected in assets/omniroute-overview.svg. Up to date.");
    return;
  }

  console.log("Card SVG has updated token activity. Checking throttle window...");

  // 6. Throttle check
  let state = { lastSyncTimestamp: 0, pendingPush: false };
  if (fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    } catch {}
  }

  const now = Date.now();
  const timeSinceLastSync = now - (state.lastSyncTimestamp || 0);

  if (!force && timeSinceLastSync < MIN_INTERVAL_MS) {
    const remainingMins = Math.round((MIN_INTERVAL_MS - timeSinceLastSync) / 60000);
    console.log(`Throttled: Last push was ${Math.round(timeSinceLastSync / 60000)}m ago. Next push window in ${remainingMins}m. Use --force to bypass.`);
    return;
  }

  // 7. Commit changes locally
  console.log("Committing updated OmniRoute card locally...");
  try {
    runCommand("git add assets/omniroute-overview.svg");
    runCommand('git commit -m "chore(stats): update OmniRoute AI usage overview card [skip ci]"');
  } catch (err) {
    console.error("Local git commit failed:", err.message);
    return;
  }

  // 8. Attempt git push to remote
  console.log("Pushing to GitHub (origin main)...");
  try {
    runCommand("git push origin main");

    // Success: update state
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          lastSyncTimestamp: now,
          lastSyncDate: new Date(now).toISOString(),
          activeDaysCount: map.size,
          pendingPush: false
        },
        null,
        2
      ),
      "utf-8"
    );

    console.log("Successfully synced OmniRoute AI usage overview card to GitHub!");
  } catch (err) {
    console.error(`Push failed (network error / offline): ${err.message}`);
    // Mark as pending push in state file so next run retries immediately
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          ...state,
          pendingPush: true,
          failedAt: new Date(now).toISOString(),
          error: err.message
        },
        null,
        2
      ),
      "utf-8"
    );
    console.log("Commit is preserved locally. The background daemon will automatically retry pushing once connection is restored.");
  }
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith("sync-omniroute.mjs")) {
  const force = process.argv.includes("--force");
  syncOmniRoute(force);
}
