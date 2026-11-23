import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Format tokens into compact format (e.g. 1.9B, 450M, 12.4K)
function formatCompact(num) {
  if (num >= 1e9) {
    return (num / 1e9).toFixed(1) + "B";
  }
  if (num >= 1e6) {
    return (num / 1e6).toFixed(1) + "M";
  }
  if (num >= 1e3) {
    return (num / 1e3).toFixed(1) + "K";
  }
  return num.toLocaleString();
}

function getDatabasePath() {
  const home = process.env.HOME || "/Users/adibrushanfikrraharjo";
  const defaultPath = path.join(home, ".omniroute", "storage.sqlite");
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  return null;
}

export function fetchUsageDataFromSqlite(dbPath) {
  const sql = `
    SELECT
      DATE(timestamp) as date,
      COALESCE(SUM(tokens_input + tokens_output), 0) as totalTokens
    FROM usage_history
    WHERE timestamp >= datetime('now', '-365 days')
    GROUP BY DATE(timestamp)
    ORDER BY date ASC;
  `;
  const raw = execSync(`sqlite3 "${dbPath}" "${sql}"`, { encoding: "utf-8" });
  const map = new Map();
  for (const line of raw.trim().split("\n")) {
    if (!line.trim()) continue;
    const [date, tokensStr] = line.split("|");
    map.set(date, parseInt(tokensStr, 10) || 0);
  }
  return map;
}

export function generateCardSvg(activityMap, options = {}) {
  const today = options.now ? new Date(options.now) : new Date();
  
  // We want 53 columns (weeks), ending at the Saturday of the current week
  // Sunday = 0 ... Saturday = 6
  const currentDayOfWeek = today.getDay();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + (6 - currentDayOfWeek)); // End of current week (Saturday)

  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - (53 * 7 - 1)); // 53 weeks ago (Sunday)

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayLabels = [
    { day: 0, text: "Sun" },
    { day: 1, text: "Mon" },
    { day: 2, text: "Tue" },
    { day: 3, text: "Wed" },
    { day: 4, text: "Thu" },
    { day: 5, text: "Fri" },
    { day: 6, text: "Sat" }
  ];

  let totalTokens = 0;
  let activeDays = 0;

  // Pre-calculate cells
  const weeks = [];
  let currentWeek = [];
  const monthHeaders = [];
  let lastMonth = -1;

  const iter = new Date(startDate);
  for (let col = 0; col < 53; col++) {
    currentWeek = [];
    for (let row = 0; row < 7; row++) {
      const year = iter.getFullYear();
      const month = String(iter.getMonth() + 1).padStart(2, "0");
      const day = String(iter.getDate()).padStart(2, "0");
      const dateKey = `${year}-${month}-${day}`;

      if (row === 0) {
        const m = iter.getMonth();
        if (m !== lastMonth) {
          monthHeaders.push({ col, name: monthNames[m] });
          lastMonth = m;
        }
      }

      const isFuture = iter > today;
      const tokens = isFuture ? 0 : (activityMap.get(dateKey) || 0);

      if (tokens > 0) {
        totalTokens += tokens;
        activeDays++;
      }

      // Determine color level (0..4)
      let level = 0;
      if (!isFuture) {
        if (tokens >= 100_000_000) level = 4;
        else if (tokens >= 30_000_000) level = 3;
        else if (tokens >= 5_000_000) level = 2;
        else if (tokens > 0) level = 1;
      }

      currentWeek.push({
        date: dateKey,
        tokens,
        level,
        isFuture,
        row,
        col
      });

      iter.setDate(iter.getDate() + 1);
    }
    weeks.push(currentWeek);
  }

  // Visual layout constants
  const cellWidth = 10;
  const cellHeight = 10;
  const cellGap = 3.5;
  const gridStartX = 65;
  const gridStartY = 64;
  const svgWidth = 840;
  const svgHeight = 205;

  // Color palette matching OmniRoute dark theme
  const colors = {
    bg: "#111215",
    border: "#1f232b",
    textMuted: "#8b949e",
    textDim: "#64748b",
    textBright: "#f0f6fc",
    level0: {
      fill: "rgba(255, 255, 255, 0.02)",
      stroke: "rgba(255, 255, 255, 0.18)"
    },
    level1: { fill: "#3b5b78", stroke: "#4a7094" },
    level2: { fill: "#5d8aa8", stroke: "#70a2c4" },
    level3: { fill: "#93c5fd", stroke: "#bfdbfe" },
    level4: { fill: "#ffffff", stroke: "#ffffff" }
  };

  // Build cells SVG
  let cellsSvg = "";
  for (const week of weeks) {
    for (const cell of week) {
      const x = gridStartX + cell.col * (cellWidth + cellGap);
      const y = gridStartY + cell.row * (cellHeight + cellGap);
      let fill = colors.level0.fill;
      let stroke = colors.level0.stroke;
      let strokeWidth = "1";

      if (cell.level === 1) {
        fill = colors.level1.fill;
        stroke = colors.level1.stroke;
      } else if (cell.level === 2) {
        fill = colors.level2.fill;
        stroke = colors.level2.stroke;
      } else if (cell.level === 3) {
        fill = colors.level3.fill;
        stroke = colors.level3.stroke;
      } else if (cell.level === 4) {
        fill = colors.level4.fill;
        stroke = colors.level4.stroke;
      }

      const opacity = cell.isFuture ? "0.3" : "1";
      const tooltip = cell.isFuture
        ? `${cell.date}`
        : `${cell.date}: ${cell.tokens.toLocaleString()} tokens`;

      cellsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellWidth}" height="${cellHeight}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"><title>${tooltip}</title></rect>\n`;
    }
  }

  // Build day labels
  let dayLabelsSvg = "";
  for (const item of dayLabels) {
    const y = gridStartY + item.day * (cellHeight + cellGap) + 8.5;
    dayLabelsSvg += `<text x="50" y="${y.toFixed(1)}" text-anchor="end" class="day-label">${item.text}</text>\n`;
  }

  // Build month labels
  let monthLabelsSvg = "";
  for (const item of monthHeaders) {
    const x = gridStartX + item.col * (cellWidth + cellGap);
    monthLabelsSvg += `<text x="${x.toFixed(1)}" y="${gridStartY - 10}" class="month-label">${item.name}</text>\n`;
  }

  const statText = `${activeDays} active days · ${formatCompact(totalTokens)} tokens · 365 days`;

  const legendX = gridStartX;
  const legendY = svgHeight - 20;

  return `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; fill: #94a3b8; letter-spacing: 1.5px; }
    .stats { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 500; fill: #94a3b8; }
    .month-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 400; fill: #64748b; }
    .day-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 9px; font-weight: 400; fill: #64748b; }
    .legend-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 400; fill: #64748b; }
    .badge-sub { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 500; fill: #475569; }
  </style>

  <!-- Background Card -->
  <rect width="${svgWidth}" height="${svgHeight}" rx="10" fill="${colors.bg}" stroke="${colors.border}" stroke-width="1"/>

  <!-- Header -->
  <text x="24" y="34" class="title">OVERVIEW</text>
  <text x="${svgWidth - 24}" y="34" text-anchor="end" class="stats">${statText}</text>

  <!-- Month Headers -->
  ${monthLabelsSvg}

  <!-- Day Labels -->
  ${dayLabelsSvg}

  <!-- Heatmap Grid -->
  ${cellsSvg}

  <!-- Legend -->
  <g transform="translate(${legendX}, ${legendY})">
    <text x="0" y="8" class="legend-text">Less</text>
    <rect x="28" y="0" width="9" height="9" rx="1.5" fill="${colors.level0.fill}" stroke="${colors.level0.stroke}" stroke-width="1"/>
    <rect x="41" y="0" width="9" height="9" rx="1.5" fill="${colors.level1.fill}" stroke="${colors.level1.stroke}" stroke-width="1"/>
    <rect x="54" y="0" width="9" height="9" rx="1.5" fill="${colors.level2.fill}" stroke="${colors.level2.stroke}" stroke-width="1"/>
    <rect x="67" y="0" width="9" height="9" rx="1.5" fill="${colors.level3.fill}" stroke="${colors.level3.stroke}" stroke-width="1"/>
    <rect x="80" y="0" width="9" height="9" rx="1.5" fill="${colors.level4.fill}" stroke="${colors.level4.stroke}" stroke-width="1"/>
    <text x="96" y="8" class="legend-text">More</text>
  </g>

  <!-- Branding Tag -->
  <text x="${svgWidth - 24}" y="${legendY + 8}" text-anchor="end" class="badge-sub">Aggregated LLM token routing via OmniRoute</text>
</svg>`;
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith("generate-omniroute-card.mjs")) {
  const dbPath = getDatabasePath();
  if (!dbPath) {
    console.error("OmniRoute database not found at ~/.omniroute/storage.sqlite");
    process.exit(1);
  }

  const map = fetchUsageDataFromSqlite(dbPath);
  const svg = generateCardSvg(map);
  const outPath = path.resolve("assets", "omniroute-overview.svg");
  fs.writeFileSync(outPath, svg, "utf-8");
  console.log(`Generated OmniRoute card at ${outPath}`);
}
