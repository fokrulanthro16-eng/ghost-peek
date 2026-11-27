import Phaser from "phaser";
import scenariosJson from "./data/scenarios.json";
import "./styles.css";
import { GhostPeekScene } from "./game/GhostPeekScene";
import { SoundEngine } from "./game/sound";
import type {
  GhostRunSummary,
  GhostTimingMap,
  HudState,
  LeaderboardEntry,
  OpponentMode,
  ScenarioEvent,
  ScreenName,
  ShotOutcome,
  ShotResult,
} from "./game/types";

const LEADERBOARD_KEY = "ghostpeek_lb_v3";
const FAN_GHOST_KEY = "ghostpeek_fan_v3";

const scenarios = scenariosJson as ScenarioEvent[];
const targetEvents = scenarios.filter((event) => event.kind === "target");
const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("Missing #app root");
}

const app: HTMLDivElement = appRoot;

const sound = new SoundEngine();
let screen: ScreenName = "start";
let opponentMode: OpponentMode = "pro";
let leaderboard = loadLeaderboard();
let fanGhost = loadFanGhost() ?? leaderboard[0];
let game: Phaser.Game | null = null;
let resetTimerId: number | null = null;
let arenaBootFrameId: number | null = null;

saveLeaderboard(leaderboard);
saveFanGhost(fanGhost);
renderStart();

function renderStart(): void {
  screen = "start";
  clearResetTimer();
  clearPendingArenaBoot();
  destroyGame();

  const topFan = getActiveFanGhost();
  const fanLabel = topFan
    ? `vs #1 Booth Fan ${escapeHtml(topFan.handle)} (${topFan.avgReactionMs}ms)`
    : "vs #1 Booth Fan";

  app.innerHTML = `
    <main class="shell start-shell">
      <section class="start-panel glass">
        <div class="brand-block">
          <div class="brand-kicker">Event Mini Game</div>
          <h1>GhostPeek</h1>
          <p class="rule">Click blue targets before the Ghost. Hold fire on red decoys.</p>
        </div>

        <div class="opponent-toggle" role="tablist" aria-label="Opponent">
          <button class="toggle-option ${opponentMode === "pro" ? "active" : ""}" type="button" data-opponent="pro">vs Pro Ghost</button>
          <button class="toggle-option ${opponentMode === "fan" ? "active" : ""}" type="button" data-opponent="fan">${fanLabel}</button>
        </div>

        <button id="play-button" class="primary-button play-button" type="button">PLAY 30s RUN</button>
      </section>

      <section class="leaderboard glass" aria-label="Booth Top 5 Leaderboard">
        <div class="section-title">Booth Top 5 Leaderboard</div>
        <ol class="leaderboard-list">
          ${renderLeaderboardRows(leaderboard)}
        </ol>
      </section>
    </main>
  `;

  app.querySelectorAll<HTMLButtonElement>("[data-opponent]").forEach((button) => {
    button.addEventListener("click", () => {
      opponentMode = button.dataset.opponent === "fan" ? "fan" : "pro";
      renderStart();
    });
  });

  document.onkeydown = (event) => {
    if (screen === "start" && event.key === "Enter") {
      event.preventDefault();
      startRun();
    }
  };

  app.querySelector<HTMLButtonElement>("#play-button")?.addEventListener("click", () => {
    startRun();
  });
}

function startRun(): void {
  void sound.resume();
  renderArena();
}

function renderArena(): void {
  screen = "arena";
  clearResetTimer();
  clearPendingArenaBoot();
  destroyGame();
  document.onkeydown = null;

  const activeFan = getActiveFanGhost();
  const opponentLabel =
    opponentMode === "fan" && activeFan
      ? `vs #1 Fan ${activeFan.handle}`
      : "vs Pro Ghost";

  app.innerHTML = `
    <main class="arena-shell">
      <header class="hud glass">
        <div class="hud-item">
          <span class="hud-label">Round</span>
          <strong id="hud-round">Pistol Rush</strong>
        </div>
        <div class="hud-timer" id="hud-timer">30.0s</div>
        <div class="hud-item">
          <span class="hud-label">Score</span>
          <strong id="hud-score">0</strong>
        </div>
        <div class="hud-badge hud-streak" id="hud-streak">STREAK 1x</div>
        <div class="hud-badge" id="hud-opponent">${escapeHtml(opponentLabel)}</div>
        <button id="mute-button" class="mute-button" type="button">${sound.isMuted() ? "Unmute" : "Mute"}</button>
      </header>
      <section id="game-root" class="game-root" aria-label="GhostPeek arena"></section>
    </main>
  `;

  const gameRoot = app.querySelector<HTMLElement>("#game-root");
  const roundEl = app.querySelector<HTMLElement>("#hud-round");
  const timerEl = app.querySelector<HTMLElement>("#hud-timer");
  const scoreEl = app.querySelector<HTMLElement>("#hud-score");
  const streakEl = app.querySelector<HTMLElement>("#hud-streak");
  const opponentEl = app.querySelector<HTMLElement>("#hud-opponent");
  const muteButton = app.querySelector<HTMLButtonElement>("#mute-button");

  muteButton?.addEventListener("click", () => {
    const muted = sound.toggleMuted();
    muteButton.textContent = muted ? "Unmute" : "Mute";
  });

  if (gameRoot) {
    gameRoot.style.display = "block";
  }

  arenaBootFrameId = window.requestAnimationFrame(() => {
    arenaBootFrameId = null;
    if (screen !== "arena") {
      return;
    }

    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game-root",
      backgroundColor: "#000A17",
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: 1280,
        height: 720,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: true,
        pixelArt: false,
        powerPreference: "high-performance",
      },
      scene: [],
    });

    game.scene.add("GhostPeekScene", GhostPeekScene, true, {
      scenarios,
      opponentMode,
      fanGhost: activeFan,
      sound,
      onHud: (state: HudState) => {
        if (roundEl) {
          roundEl.textContent = state.roundName;
        }
        if (timerEl) {
          timerEl.textContent = `${(state.countdownMs / 1000).toFixed(1)}s`;
        }
        if (scoreEl) {
          scoreEl.textContent = String(state.score);
        }
        if (streakEl) {
          streakEl.textContent = `STREAK ${state.streak}x`;
          streakEl.classList.toggle("active", state.streak >= 2);
        }
        if (opponentEl) {
          opponentEl.textContent = state.opponentLabel;
        }
      },
      onShot: () => undefined,
      onComplete: (summary: GhostRunSummary) => {
        const topScore = leaderboard[0]?.score ?? 0;
        const completedRun = {
          ...summary,
          beatTopSpot: summary.score > topScore,
        };
        destroyGame();
        renderEnd(completedRun);
      },
    });
  });
}

function renderEnd(run: GhostRunSummary): void {
  screen = "end";
  clearResetTimer();
  document.onkeydown = null;

  const shotStrip = sortShots(run.shots)
    .map(
      (shot) =>
        `<span class="shot-badge ${shotClass(shot.outcome)}">${escapeHtml(shot.label)}</span>`,
    )
    .join("");

  app.innerHTML = `
    <main class="shell end-shell">
      <section class="end-card glass">
        <div class="end-head">
          <div>
            <div class="section-title">Run Complete</div>
            <h2>${run.score}</h2>
            <p>Total Score</p>
          </div>
          <div id="new-top-tag" class="top-tag ${run.beatTopSpot ? "" : "hidden"}">NEW BOOTH #1 - YOUR GHOST IS READY</div>
        </div>

        <div class="summary-grid">
          <div>
            <span>Player Avg</span>
            <strong>${formatMs(run.avgReactionMs)}</strong>
          </div>
          <div>
            <span>Ghost Avg</span>
            <strong>${formatMs(run.ghostAvgMs)}</strong>
          </div>
          <div>
            <span>Duels Won</span>
            <strong>${run.duelsWon} / ${run.totalTargets}</strong>
          </div>
        </div>

        <div class="shot-strip" aria-label="Shot by shot results">${shotStrip}</div>

        <div class="save-row">
          <input id="handle-input" class="handle-input" type="text" inputmode="latin" minlength="3" maxlength="10" autocomplete="off" placeholder="HANDLE" aria-label="Handle" />
          <button id="save-button" class="secondary-button" type="button" disabled>SAVE TO LEADERBOARD</button>
        </div>
        <div id="save-status" class="save-status" aria-live="polite"></div>

        <div class="end-actions">
          <button id="again-button" class="primary-button" type="button">PLAY AGAIN</button>
          <label class="auto-reset">
            <input id="auto-reset-toggle" type="checkbox" checked />
            <span>Booth Auto-Reset <strong id="reset-countdown">15s</strong></span>
          </label>
        </div>
      </section>
    </main>
  `;

  const handleInput = app.querySelector<HTMLInputElement>("#handle-input");
  const saveButton = app.querySelector<HTMLButtonElement>("#save-button");
  const statusEl = app.querySelector<HTMLElement>("#save-status");
  const topTag = app.querySelector<HTMLElement>("#new-top-tag");
  const resetCountdown = app.querySelector<HTMLElement>("#reset-countdown");
  const resetToggle = app.querySelector<HTMLInputElement>("#auto-reset-toggle");
  let saved = false;
  let resetSeconds = 15;

  handleInput?.addEventListener("input", () => {
    handleInput.value = sanitizeHandle(handleInput.value);
    if (saveButton) {
      saveButton.disabled = saved || handleInput.value.length < 3;
    }
  });

  saveButton?.addEventListener("click", () => {
    if (!handleInput || handleInput.value.length < 3 || saved) {
      return;
    }

    const entry = makeLeaderboardEntry(handleInput.value, run);
    const wasTop = entry.score > (leaderboard[0]?.score ?? 0);
    leaderboard = [...leaderboard, entry]
      .sort(compareLeaderboardEntries)
      .slice(0, 5);
    saveLeaderboard(leaderboard);

    if (wasTop) {
      fanGhost = entry;
      saveFanGhost(entry);
      if (topTag) {
        topTag.textContent = "NEW BOOTH #1 - YOUR GHOST IS NOW LIVE";
        topTag.classList.remove("hidden");
      }
      if (statusEl) {
        statusEl.textContent = "Saved as the active #1 Booth Fan ghost.";
      }
    } else if (leaderboard.some((item) => item.createdAt === entry.createdAt)) {
      if (statusEl) {
        statusEl.textContent = "Saved to the Booth Top 5.";
      }
    } else if (statusEl) {
      statusEl.textContent = "Score did not reach the Booth Top 5.";
    }

    saved = true;
    saveButton.disabled = true;
    handleInput.disabled = true;
  });

  app.querySelector<HTMLButtonElement>("#again-button")?.addEventListener("click", () => {
    startRun();
  });

  resetTimerId = window.setInterval(() => {
    if (screen !== "end" || !resetToggle?.checked) {
      return;
    }
    if (document.activeElement === handleInput) {
      return;
    }
    resetSeconds -= 1;
    if (resetCountdown) {
      resetCountdown.textContent = `${Math.max(0, resetSeconds)}s`;
    }
    if (resetSeconds <= 0) {
      renderStart();
    }
  }, 1000);
}

function renderLeaderboardRows(entries: LeaderboardEntry[]): string {
  return entries
    .map(
      (entry, index) => `
        <li>
          <span class="rank">#${index + 1}</span>
          <span class="handle">${escapeHtml(entry.handle)}</span>
          <span class="score">${entry.score}</span>
          <span class="avg">${entry.avgReactionMs}ms</span>
        </li>
      `,
    )
    .join("");
}

function loadLeaderboard(): LeaderboardEntry[] {
  const parsed = readJson<LeaderboardEntry[]>(LEADERBOARD_KEY);
  if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
    return seedLeaderboard();
  }
  const valid = parsed.filter(isLeaderboardEntry).sort(compareLeaderboardEntries);
  return valid.length > 0 ? valid.slice(0, 5) : seedLeaderboard();
}

function saveLeaderboard(entries: LeaderboardEntry[]): void {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries.slice(0, 5)));
}

function loadFanGhost(): LeaderboardEntry | null {
  const parsed = readJson<LeaderboardEntry>(FAN_GHOST_KEY);
  return parsed && isLeaderboardEntry(parsed) ? parsed : null;
}

function saveFanGhost(entry: LeaderboardEntry): void {
  localStorage.setItem(FAN_GHOST_KEY, JSON.stringify(entry));
}

function getActiveFanGhost(): LeaderboardEntry | null {
  return fanGhost ?? leaderboard[0] ?? null;
}

function seedLeaderboard(): LeaderboardEntry[] {
  const entries = [
    seedEntry("NOVA", 3850, 935, 9, -100),
    seedEntry("KAI", 3300, 990, 8, -45),
    seedEntry("RIFT", 2850, 1065, 7, 30),
  ];
  return entries.sort(compareLeaderboardEntries);
}

function seedEntry(
  handle: string,
  score: number,
  avgReactionMs: number,
  duelsWon: number,
  offset: number,
): LeaderboardEntry {
  const ghostTimings: GhostTimingMap = {};
  targetEvents.forEach((event, index) => {
    const variance = ((index % 5) - 2) * 7;
    ghostTimings[event.id] = clamp(
      event.proGhostMs + offset + variance,
      175,
      event.windowMs - 120,
    );
  });
  return {
    handle,
    score,
    avgReactionMs,
    duelsWon,
    totalTargets: targetEvents.length,
    createdAt: new Date(Date.UTC(2026, 10, 27, 12, score % 60, 0)).toISOString(),
    ghostTimings,
  };
}

function makeLeaderboardEntry(handle: string, run: GhostRunSummary): LeaderboardEntry {
  const ghostTimings: GhostTimingMap = {};
  targetEvents.forEach((event) => {
    const timing = run.ghostTimings[event.id] ?? event.proGhostMs;
    ghostTimings[event.id] = clamp(Math.round(timing), 160, event.windowMs - 120);
  });

  return {
    handle,
    score: run.score,
    avgReactionMs: run.avgReactionMs,
    duelsWon: run.duelsWon,
    totalTargets: run.totalTargets,
    createdAt: new Date().toISOString(),
    ghostTimings,
  };
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as LeaderboardEntry;
  return (
    typeof entry.handle === "string" &&
    typeof entry.score === "number" &&
    typeof entry.avgReactionMs === "number" &&
    typeof entry.duelsWon === "number" &&
    typeof entry.totalTargets === "number" &&
    typeof entry.createdAt === "string" &&
    Boolean(entry.ghostTimings) &&
    typeof entry.ghostTimings === "object"
  );
}

function compareLeaderboardEntries(
  first: LeaderboardEntry,
  second: LeaderboardEntry,
): number {
  if (second.score !== first.score) {
    return second.score - first.score;
  }
  return first.avgReactionMs - second.avgReactionMs;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function sortShots(shots: ShotResult[]): ShotResult[] {
  const order = new Map(scenarios.map((event, index) => [event.id, index]));
  return [...shots].sort(
    (first, second) =>
      (order.get(first.eventId) ?? 0) - (order.get(second.eventId) ?? 0),
  );
}

function shotClass(outcome: ShotOutcome): string {
  switch (outcome) {
    case "faster":
      return "cyan";
    case "slower":
      return "amber";
    case "held":
      return "green";
    case "baited":
    case "miss":
      return "red";
  }
}

function sanitizeHandle(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

function formatMs(value: number): string {
  return value > 0 ? `${value}ms` : "--";
}

function clearResetTimer(): void {
  if (resetTimerId !== null) {
    window.clearInterval(resetTimerId);
    resetTimerId = null;
  }
}

function clearPendingArenaBoot(): void {
  if (arenaBootFrameId !== null) {
    window.cancelAnimationFrame(arenaBootFrameId);
    arenaBootFrameId = null;
  }
}

function destroyGame(): void {
  if (game) {
    game.destroy(true);
    game = null;
  }
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

window.addEventListener("beforeunload", () => {
  clearResetTimer();
  clearPendingArenaBoot();
  destroyGame();
});
