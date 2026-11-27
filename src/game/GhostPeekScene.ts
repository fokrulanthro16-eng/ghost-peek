import Phaser from "phaser";
import type {
  GhostRunSummary,
  HudState,
  LeaderboardEntry,
  OpponentMode,
  ScenarioEvent,
  ShotResult,
} from "./types";
import type { SoundEngine } from "./sound";

interface SceneCallbacks {
  onHud: (state: HudState) => void;
  onShot: (shot: ShotResult) => void;
  onComplete: (summary: GhostRunSummary) => void;
}

interface SceneInitData extends SceneCallbacks {
  scenarios: ScenarioEvent[];
  opponentMode: OpponentMode;
  fanGhost: LeaderboardEntry | null;
  sound: SoundEngine;
}

interface ActiveEvent {
  event: ScenarioEvent;
  spawnAt: number;
  expiresAt: number;
  x: number;
  y: number;
  radius: number;
  ghostMs: number | null;
  ghostFlashed: boolean;
  ghostStartNorm: { x: number; y: number };
  container: Phaser.GameObjects.Container;
  targetBase: Phaser.GameObjects.Graphics;
  timingRing: Phaser.GameObjects.Graphics | null;
  ghostReticle: Phaser.GameObjects.Graphics | null;
  raceLine: Phaser.GameObjects.Graphics | null;
}

interface CoverStructure {
  label: string;
  labelNorm: [number, number];
  polygons: [number, number][][];
  connector?: [[number, number], [number, number]];
}

const TACTICAL_COVER: CoverStructure[] = [
  {
    label: "LEFT FLANK",
    labelNorm: [0.145, 0.425],
    polygons: [
      [
        [0.07, 0.36],
        [0.19, 0.36],
        [0.22, 0.4],
        [0.22, 0.49],
        [0.13, 0.49],
        [0.07, 0.45],
      ],
    ],
  },
  {
    label: "MID ARCH",
    labelNorm: [0.48, 0.32],
    polygons: [
      [
        [0.38, 0.29],
        [0.44, 0.29],
        [0.45, 0.35],
        [0.39, 0.35],
      ],
      [
        [0.52, 0.29],
        [0.58, 0.29],
        [0.57, 0.35],
        [0.51, 0.35],
      ],
    ],
    connector: [
      [0.44, 0.305],
      [0.52, 0.305],
    ],
  },
  {
    label: "SITE COVER",
    labelNorm: [0.715, 0.74],
    polygons: [
      [
        [0.66, 0.69],
        [0.76, 0.69],
        [0.78, 0.75],
        [0.74, 0.79],
        [0.65, 0.76],
      ],
    ],
  },
  {
    label: "UPPER RAMP",
    labelNorm: [0.765, 0.185],
    polygons: [
      [
        [0.71, 0.14],
        [0.81, 0.14],
        [0.83, 0.22],
        [0.75, 0.24],
        [0.7, 0.2],
      ],
    ],
  },
];

const RUN_MS = 30_000;
const TARGET_BLUE = 0x00d8ff;
const ELECTRIC_BLUE = 0x007fff;
const RED = 0xff3d35;

export class GhostPeekScene extends Phaser.Scene {
  private scenarios: ScenarioEvent[] = [];
  private opponentMode: OpponentMode = "pro";
  private fanGhost: LeaderboardEntry | null = null;
  private soundEngine!: SoundEngine;
  private callbacks: SceneCallbacks = {
    onHud: () => undefined,
    onShot: () => undefined,
    onComplete: () => undefined,
  };

  private grid!: Phaser.GameObjects.Graphics;
  private laneLayer!: Phaser.GameObjects.Container;
  private crosshair!: Phaser.GameObjects.Graphics;
  private runStartTime: number | null = null;
  private elapsedMs = 0;
  private nextEventIndex = 0;
  private activeEvents: ActiveEvent[] = [];
  private shots: ShotResult[] = [];
  private score = 0;
  private duelsWon = 0;
  private consecutiveFaster = 0;
  private lastTargetNorm = { x: 0.5, y: 0.5 };
  private completed = false;
  private lastHudAt = -1;
  private currentRoundName = "Pistol Rush";
  private shownRounds = new Set<number>();
  private playedCountdownTicks = new Set<number>();
  private playedRoundEnds = new Set<number>();

  constructor() {
    super("GhostPeekScene");
  }

  init(data: SceneInitData): void {
    this.scenarios = [...data.scenarios].sort(
      (a, b) => a.spawnTimeMs - b.spawnTimeMs,
    );
    this.opponentMode = data.opponentMode;
    this.fanGhost = data.fanGhost;
    this.soundEngine = data.sound;
    this.callbacks = {
      onHud: data.onHud,
      onShot: data.onShot,
      onComplete: data.onComplete,
    };
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#000A17");
    this.input.setDefaultCursor("none");
    this.grid = this.add.graphics().setDepth(-20);
    this.laneLayer = this.add.container(0, 0).setDepth(-15);
    this.crosshair = this.add.graphics().setDepth(200);
    this.drawGrid();
    this.resetRunState();

    this.input.on("pointerdown", this.handlePointerDown, this);
    this.scale.on("resize", this.handleResize, this);
  }

  override update(time: number): void {
    if (this.completed) {
      return;
    }

    if (this.runStartTime === null) {
      this.runStartTime = time;
      this.elapsedMs = 0;
      this.emitHud(true);
      return;
    }

    this.elapsedMs = Math.min(time - this.runStartTime, RUN_MS);
    this.updateRoundState(this.elapsedMs);
    this.spawnDueEvents(this.elapsedMs, time);
    this.updateActiveEvents(time, this.elapsedMs);
    this.updateCrosshair();
    this.playCountdownTicks(this.elapsedMs);
    this.emitHud();

    if (this.elapsedMs >= RUN_MS) {
      this.finishRun();
    }
  }

  private resetRunState(): void {
    this.clearActiveEvents(true);
    this.tweens.killAll();
    this.children.each((child) => {
      if (
        child !== this.grid &&
        child !== this.laneLayer &&
        child !== this.crosshair
      ) {
        child.destroy();
      }
    });
    this.grid.setAlpha(1);
    this.crosshair.clear();
    this.runStartTime = null;
    this.elapsedMs = 0;
    this.nextEventIndex = 0;
    this.activeEvents = [];
    this.shots = [];
    this.score = 0;
    this.duelsWon = 0;
    this.consecutiveFaster = 0;
    this.lastTargetNorm = { x: 0.5, y: 0.5 };
    this.completed = false;
    this.lastHudAt = -1;
    this.currentRoundName = "Pistol Rush";
    this.shownRounds = new Set<number>([1]);
    this.playedCountdownTicks.clear();
    this.playedRoundEnds.clear();
    this.showRoundBanner(1, "Pistol Rush");
    this.emitHud(true);
  }

  private clearActiveEvents(destroyImmediately = false): void {
    for (const active of this.activeEvents) {
      this.tweens.killTweensOf(active.container);
      if (active.ghostReticle) {
        this.tweens.killTweensOf(active.ghostReticle);
      }
      if (active.raceLine) {
        this.tweens.killTweensOf(active.raceLine);
      }
      active.timingRing?.destroy();
      active.ghostReticle?.destroy();
      active.raceLine?.destroy();
      if (destroyImmediately) {
        active.container.destroy(true);
      }
    }
    this.activeEvents = [];
  }

  private handleResize(): void {
    this.drawGrid();
    for (const active of this.activeEvents) {
      active.x = active.event.xNorm * this.scale.width;
      active.y = active.event.yNorm * this.scale.height;
      active.container.setPosition(active.x, active.y);
      if (active.raceLine) {
        this.drawDashedLine(
          active.raceLine,
          active.ghostStartNorm.x * this.scale.width,
          active.ghostStartNorm.y * this.scale.height,
          active.x,
          active.y,
        );
      }
    }
  }

  private drawGrid(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.grid.clear();
    this.grid.fillStyle(0x000a17, 1);
    this.grid.fillRect(0, 0, width, height);

    this.grid.lineStyle(1, ELECTRIC_BLUE, 0.13);
    const step = Math.max(48, Math.min(width, height) / 10);
    for (let x = 0; x <= width; x += step) {
      this.grid.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += step) {
      this.grid.lineBetween(0, y, width, y);
    }

    this.grid.lineStyle(1, TARGET_BLUE, 0.12);
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(width, height) * 0.46;
    for (let radius = maxRadius / 4; radius <= maxRadius; radius += maxRadius / 4) {
      this.grid.strokeCircle(cx, cy, radius);
    }
    this.grid.lineStyle(2, ELECTRIC_BLUE, 0.18);
    this.grid.lineBetween(cx, 0, cx, height);
    this.grid.lineBetween(0, cy, width, cy);

    this.drawTacticalCover(width, height);
  }

  private drawTacticalCover(width: number, height: number): void {
    this.laneLayer.removeAll(true);

    for (const cover of TACTICAL_COVER) {
      for (const poly of cover.polygons) {
        const points = poly.map(([nx, ny]) => ({
          x: nx * width,
          y: ny * height,
        }));
        this.grid.fillStyle(0x05182e, 0.78);
        this.grid.fillPoints(points, true);
        this.grid.lineStyle(2, ELECTRIC_BLUE, 0.56);
        this.grid.strokePoints(points, true);

        this.grid.lineStyle(1, TARGET_BLUE, 0.2);
        this.grid.lineBetween(
          points[0].x + 6,
          points[0].y + 6,
          points[1].x - 6,
          points[1].y + 6,
        );
      }

      if (cover.connector) {
        const [[x1, y1], [x2, y2]] = cover.connector;
        this.grid.lineStyle(1.5, ELECTRIC_BLUE, 0.38);
        this.grid.lineBetween(x1 * width, y1 * height, x2 * width, y2 * height);
      }

      const [lx, ly] = cover.labelNorm;
      const label = this.add
        .text(lx * width, ly * height, cover.label, {
          color: "#69b8ff",
          fontFamily: "Inter, Segoe UI, Arial, sans-serif",
          fontSize: "11px",
          fontStyle: "800",
        })
        .setOrigin(0.5)
        .setAlpha(0.75);
      this.laneLayer.add(label);
    }
  }

  private updateCrosshair(): void {
    const pointer = this.input.activePointer;
    this.crosshair.clear();
    if (!pointer.active) {
      return;
    }
    this.crosshair.lineStyle(1, 0xd7f7ff, 0.9);
    this.crosshair.strokeCircle(pointer.x, pointer.y, 10);
    this.crosshair.lineBetween(pointer.x - 18, pointer.y, pointer.x - 6, pointer.y);
    this.crosshair.lineBetween(pointer.x + 6, pointer.y, pointer.x + 18, pointer.y);
    this.crosshair.lineBetween(pointer.x, pointer.y - 18, pointer.x, pointer.y - 6);
    this.crosshair.lineBetween(pointer.x, pointer.y + 6, pointer.x, pointer.y + 18);
  }

  private updateRoundState(elapsed: number): void {
    const round = elapsed >= 20_000 ? 3 : elapsed >= 10_000 ? 2 : 1;
    const eventForRound = this.scenarios.find((event) => event.round === round);
    this.currentRoundName = eventForRound?.roundName ?? this.currentRoundName;

    if (!this.shownRounds.has(round)) {
      this.shownRounds.add(round);
      this.showRoundBanner(round, this.currentRoundName);
    }

    for (const threshold of [10_000, 20_000]) {
      if (elapsed >= threshold && !this.playedRoundEnds.has(threshold)) {
        this.playedRoundEnds.add(threshold);
        this.soundEngine.play("roundEnd");
      }
    }
  }

  private spawnDueEvents(elapsed: number, sceneTime: number): void {
    while (
      this.nextEventIndex < this.scenarios.length &&
      elapsed >= this.scenarios[this.nextEventIndex].spawnTimeMs
    ) {
      this.spawnEvent(this.scenarios[this.nextEventIndex], sceneTime);
      this.nextEventIndex += 1;
    }
  }

  private spawnEvent(event: ScenarioEvent, sceneTime: number): void {
    const x = event.xNorm * this.scale.width;
    const y = event.yNorm * this.scale.height;
    const radius = event.kind === "target" ? 54 : 54;
    const container = this.add.container(x, y).setDepth(20);
    const targetBase = this.add.graphics();
    container.add(targetBase);

    let timingRing: Phaser.GameObjects.Graphics | null = null;
    let ghostReticle: Phaser.GameObjects.Graphics | null = null;
    let raceLine: Phaser.GameObjects.Graphics | null = null;
    const ghostMs = event.kind === "target" ? this.ghostMsFor(event) : null;
    const ghostStartNorm = { ...this.lastTargetNorm };

    if (event.kind === "target") {
      this.lastTargetNorm = { x: event.xNorm, y: event.yNorm };
      this.drawTargetBase(targetBase);
      timingRing = this.add.graphics().setDepth(40);
      const startX = ghostStartNorm.x * this.scale.width;
      const startY = ghostStartNorm.y * this.scale.height;
      raceLine = this.add.graphics().setDepth(15);
      this.drawDashedLine(raceLine, startX, startY, x, y);
      ghostReticle = this.add.graphics().setDepth(35);
      this.drawGhostReticle(ghostReticle, false);
      ghostReticle.setPosition(startX, startY);
      this.tweens.add({
        targets: container,
        scale: { from: 0.84, to: 1 },
        alpha: { from: 0.45, to: 1 },
        duration: 130,
        ease: "Cubic.easeOut",
      });
    } else {
      this.drawDecoyBase(targetBase, container);
    }

    this.activeEvents.push({
      event,
      spawnAt: sceneTime,
      expiresAt: sceneTime + event.windowMs,
      x,
      y,
      radius,
      ghostMs,
      ghostFlashed: false,
      ghostStartNorm,
      container,
      targetBase,
      timingRing,
      ghostReticle,
      raceLine,
    });
  }

  private drawTargetBase(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();
    graphics.fillStyle(TARGET_BLUE, 0.08);
    graphics.fillCircle(0, 0, 48);
    graphics.lineStyle(2, TARGET_BLUE, 0.85);
    graphics.strokeCircle(0, 0, 34);
    graphics.lineStyle(2, 0x97f4ff, 0.95);
    graphics.strokeCircle(0, 0, 20);
    graphics.fillStyle(0xdffcff, 0.92);
    graphics.fillCircle(0, 0, 5);
    graphics.lineStyle(2, ELECTRIC_BLUE, 0.9);
    graphics.lineBetween(-45, 0, -30, 0);
    graphics.lineBetween(30, 0, 45, 0);
    graphics.lineBetween(0, -45, 0, -30);
    graphics.lineBetween(0, 30, 0, 45);
  }

  private drawDecoyBase(
    graphics: Phaser.GameObjects.Graphics,
    container: Phaser.GameObjects.Container,
  ): void {
    graphics.clear();
    graphics.fillStyle(RED, 0.14);
    graphics.beginPath();
    graphics.moveTo(0, -46);
    graphics.lineTo(48, 36);
    graphics.lineTo(-48, 36);
    graphics.closePath();
    graphics.fillPath();
    graphics.lineStyle(3, 0xff6d3d, 0.95);
    graphics.strokePath();
    graphics.lineStyle(2, 0xffc15d, 0.8);
    graphics.lineBetween(0, -20, 0, 10);
    graphics.fillStyle(0xffc15d, 1);
    graphics.fillCircle(0, 22, 3);

    const label = this.add
      .text(0, 54, "HOLD", {
        color: "#ffd1b3",
        fontFamily: "Inter, Segoe UI, Arial, sans-serif",
        fontSize: "16px",
        fontStyle: "700",
      })
      .setOrigin(0.5);
    container.add(label);
    this.tweens.add({
      targets: container,
      scale: { from: 0.94, to: 1.06 },
      duration: 280,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private updateActiveEvents(sceneTime: number, elapsed: number): void {
    for (const active of [...this.activeEvents]) {
      const age = sceneTime - active.spawnAt;
      if (active.event.kind === "target") {
        this.updateTarget(active, age);
      }

      if (sceneTime >= active.expiresAt) {
        if (active.event.kind === "target") {
          this.resolveTargetMiss(active);
        } else {
          this.resolveDecoyHeld(active);
        }
      }
    }

    if (elapsed >= RUN_MS) {
      for (const active of [...this.activeEvents]) {
        if (active.event.kind === "target") {
          this.resolveTargetMiss(active);
        } else {
          this.resolveDecoyHeld(active);
        }
      }
    }
  }

  private updateTarget(active: ActiveEvent, age: number): void {
    const ghostMs = active.ghostMs ?? active.event.proGhostMs;
    const ringProgress = Phaser.Math.Clamp(age / ghostMs, 0, 1);
    const ringRadius = Phaser.Math.Linear(54, 18, ringProgress);
    if (active.timingRing) {
      active.timingRing.clear();
      active.timingRing.lineStyle(3, 0xd7f7ff, 0.9);
      active.timingRing.strokeCircle(active.x, active.y, ringRadius);
      active.timingRing.lineStyle(1, TARGET_BLUE, 0.38);
      active.timingRing.strokeCircle(active.x, active.y, ringRadius + 7);
    }

    if (active.ghostReticle) {
      const startX = active.ghostStartNorm.x * this.scale.width;
      const startY = active.ghostStartNorm.y * this.scale.height;
      const progress = Phaser.Math.Clamp(age / ghostMs, 0, 1);
      const eased = Phaser.Math.Easing.Sine.InOut(progress);
      active.ghostReticle.setPosition(
        Phaser.Math.Linear(startX, active.x, eased),
        Phaser.Math.Linear(startY, active.y, eased),
      );
      if (age >= ghostMs && !active.ghostFlashed) {
        active.ghostFlashed = true;
        this.drawGhostReticle(active.ghostReticle, true);
        this.triggerGhostArrivalFlash(active.x, active.y);
        this.tweens.add({
          targets: active.ghostReticle,
          alpha: { from: 1, to: 0.45 },
          duration: 140,
          yoyo: true,
          ease: "Sine.easeOut",
        });
      }
    }
  }

  private drawDashedLine(
    graphics: Phaser.GameObjects.Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    graphics.clear();
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance < 4) {
      return;
    }
    const dashLen = 8;
    const gapLen = 7;
    const step = dashLen + gapLen;
    const ux = dx / distance;
    const uy = dy / distance;
    graphics.lineStyle(1.5, TARGET_BLUE, 0.3);
    for (let pos = 0; pos < distance; pos += step) {
      const end = Math.min(pos + dashLen, distance);
      graphics.lineBetween(
        x1 + ux * pos,
        y1 + uy * pos,
        x1 + ux * end,
        y1 + uy * end,
      );
    }
  }

  private triggerGhostArrivalFlash(x: number, y: number): void {
    const ring = this.add.graphics().setPosition(x, y).setDepth(38);
    ring.lineStyle(3, 0xffffff, 0.95);
    ring.strokeCircle(0, 0, 20);
    ring.lineStyle(2, TARGET_BLUE, 0.85);
    ring.strokeCircle(0, 0, 27);
    this.tweens.add({
      targets: ring,
      scale: { from: 0.85, to: 1.9 },
      alpha: { from: 1, to: 0 },
      duration: 210,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  private drawGhostReticle(
    graphics: Phaser.GameObjects.Graphics,
    flash: boolean,
  ): void {
    graphics.clear();
    const color = flash ? 0xffffff : 0x7df6ff;
    const alpha = flash ? 1 : 0.85;
    graphics.fillStyle(TARGET_BLUE, flash ? 0.24 : 0.14);
    graphics.fillCircle(0, 0, flash ? 24 : 19);
    graphics.lineStyle(2, color, alpha);
    graphics.strokeCircle(0, 0, flash ? 18 : 14);
    graphics.lineBetween(-24, 0, -10, 0);
    graphics.lineBetween(10, 0, 24, 0);
    graphics.lineBetween(0, -24, 0, -10);
    graphics.lineBetween(0, 10, 0, 24);
    graphics.fillStyle(color, alpha);
    graphics.fillCircle(0, 0, flash ? 4 : 3);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    void this.soundEngine.resume();
    if (this.completed) {
      return;
    }

    const active = this.activeEvents.find((item) => {
      const dx = pointer.x - item.x;
      const dy = pointer.y - item.y;
      return Math.sqrt(dx * dx + dy * dy) <= item.radius;
    });

    if (!active) {
      return;
    }

    if (active.event.kind === "target") {
      this.resolveTargetClick(active, pointer.downTime);
    } else {
      this.resolveDecoyBaited(active);
    }
  }

  private get streak(): number {
    return Math.min(4, Math.max(1, this.consecutiveFaster));
  }

  private resolveTargetClick(active: ActiveEvent, pointerTime: number): void {
    const reactionMs = Math.max(0, Math.round(pointerTime - active.spawnAt));
    const ghostMs = active.ghostMs ?? active.event.proGhostMs;
    const deltaMs = reactionMs - ghostMs;
    let scoreDelta = 120;
    let outcome: ShotResult["outcome"] = "slower";
    let label = `+${deltaMs}ms SLOWER`;
    let color = "#ffbd62";

    if (deltaMs <= 0) {
      this.consecutiveFaster += 1;
      const multiplier = this.streak;
      const bonus = Math.max(0, Math.round(Math.abs(deltaMs) * 1.35));
      scoreDelta = 250 * multiplier + bonus;
      outcome = "faster";
      label =
        multiplier >= 2
          ? `-${Math.abs(deltaMs)}ms FASTER · ${multiplier}x STREAK`
          : `-${Math.abs(deltaMs)}ms FASTER`;
      color = "#8ff8ff";
      this.duelsWon += 1;
      this.soundEngine.play("faster");
      this.burst(active.x, active.y, TARGET_BLUE);
      this.flash(0x6df6ff, 0.17, 40);
    } else {
      this.consecutiveFaster = 0;
      this.soundEngine.play("slower");
    }

    this.score += scoreDelta;
    this.showFloat(active.x, active.y - 54, label, color);
    this.recordShot({
      eventId: active.event.id,
      kind: "target",
      round: active.event.round,
      label: deltaMs <= 0 ? `-${Math.abs(deltaMs)}ms` : `+${deltaMs}ms`,
      outcome,
      scoreDelta,
      reactionMs,
      ghostMs,
      deltaMs,
    });
    this.removeActive(active, true);
  }

  private resolveTargetMiss(active: ActiveEvent): void {
    const ghostMs = active.ghostMs ?? active.event.proGhostMs;
    this.consecutiveFaster = 0;
    this.showFloat(active.x, active.y - 54, "MISSED", "#ff6868");
    this.recordShot({
      eventId: active.event.id,
      kind: "target",
      round: active.event.round,
      label: "MISS",
      outcome: "miss",
      scoreDelta: 0,
      reactionMs: null,
      ghostMs,
      deltaMs: null,
    });
    this.removeActive(active, false);
  }

  private resolveDecoyHeld(active: ActiveEvent): void {
    this.score += 50;
    this.soundEngine.play("held");
    this.showFloat(active.x, active.y - 52, "DISCIPLINE +50", "#72ffc8");
    this.recordShot({
      eventId: active.event.id,
      kind: "decoy",
      round: active.event.round,
      label: "HELD",
      outcome: "held",
      scoreDelta: 50,
      reactionMs: null,
      ghostMs: null,
      deltaMs: null,
    });
    this.removeActive(active, true);
  }

  private resolveDecoyBaited(active: ActiveEvent): void {
    this.consecutiveFaster = 0;
    this.score -= 150;
    this.soundEngine.play("baited");
    this.cameras.main.shake(120, 0.005);
    this.flash(RED, 0.2, 110);
    this.showFloat(active.x, active.y - 52, "BAITED -150", "#ff8a72");
    this.recordShot({
      eventId: active.event.id,
      kind: "decoy",
      round: active.event.round,
      label: "BAITED",
      outcome: "baited",
      scoreDelta: -150,
      reactionMs: null,
      ghostMs: null,
      deltaMs: null,
    });
    this.removeActive(active, false);
  }

  private removeActive(active: ActiveEvent, clean: boolean): void {
    this.activeEvents = this.activeEvents.filter((item) => item !== active);
    active.timingRing?.destroy();
    if (active.raceLine) {
      this.tweens.add({
        targets: active.raceLine,
        alpha: 0,
        duration: 130,
        onComplete: () => active.raceLine?.destroy(),
      });
    }
    if (active.ghostReticle) {
      this.tweens.add({
        targets: active.ghostReticle,
        alpha: 0,
        duration: 130,
        onComplete: () => active.ghostReticle?.destroy(),
      });
    }
    this.tweens.killTweensOf(active.container);
    this.tweens.add({
      targets: active.container,
      alpha: 0,
      scale: clean ? 1.12 : 0.82,
      duration: 140,
      ease: "Cubic.easeOut",
      onComplete: () => active.container.destroy(true),
    });
  }

  private recordShot(shot: ShotResult): void {
    this.shots.push(shot);
    this.callbacks.onShot(shot);
    this.emitHud(true);
  }

  private showFloat(x: number, y: number, text: string, color: string): void {
    const label = this.add
      .text(x, y, text, {
        color,
        fontFamily: "Inter, Segoe UI, Arial, sans-serif",
        fontSize: "22px",
        fontStyle: "800",
        stroke: "#000A17",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.tweens.add({
      targets: label,
      y: y - 34,
      alpha: 0,
      duration: 640,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  private burst(x: number, y: number, color: number): void {
    for (let index = 0; index < 14; index += 1) {
      const angle = (Math.PI * 2 * index) / 14;
      const distance = Phaser.Math.Between(30, 82);
      const dot = this.add
        .circle(x, y, Phaser.Math.Between(2, 4), color, 0.86)
        .setDepth(80);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        duration: 380,
        ease: "Cubic.easeOut",
        onComplete: () => dot.destroy(),
      });
    }
  }

  private flash(color: number, alpha: number, durationMs: number): void {
    const rect = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, color, alpha)
      .setOrigin(0)
      .setDepth(90);
    this.tweens.add({
      targets: rect,
      alpha: 0,
      duration: durationMs,
      onComplete: () => rect.destroy(),
    });
  }

  private showRoundBanner(round: number, name: string): void {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const text = this.add
      .text(cx, cy, `ROUND ${round} // ${name.toUpperCase()}`, {
        color: "#eafcff",
        fontFamily: "Inter, Segoe UI, Arial, sans-serif",
        fontSize: "32px",
        fontStyle: "900",
        letterSpacing: 0,
        stroke: "#000A17",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(120)
      .setAlpha(0);
    this.tweens.add({
      targets: text,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.96, to: 1 },
      duration: 120,
      yoyo: true,
      hold: 360,
      ease: "Cubic.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private playCountdownTicks(elapsed: number): void {
    const remaining = RUN_MS - elapsed;
    for (const seconds of [3, 2, 1]) {
      if (remaining <= seconds * 1000 && !this.playedCountdownTicks.has(seconds)) {
        this.playedCountdownTicks.add(seconds);
        this.soundEngine.play("countdown");
      }
    }
  }

  private emitHud(force = false): void {
    const now = this.time.now;
    if (!force && now - this.lastHudAt < 33) {
      return;
    }
    this.lastHudAt = now;
    this.callbacks.onHud({
      roundName: this.currentRoundName,
      countdownMs: Math.max(0, RUN_MS - this.elapsedMs),
      score: this.score,
      streak: this.streak,
      opponentLabel:
        this.opponentMode === "fan" && this.fanGhost
          ? `vs #1 Fan ${this.fanGhost.handle}`
          : "vs Pro Ghost",
    });
  }

  private ghostMsFor(event: ScenarioEvent): number {
    const fanTiming =
      this.opponentMode === "fan" ? this.fanGhost?.ghostTimings[event.id] : null;
    const selected = typeof fanTiming === "number" ? fanTiming : event.proGhostMs;
    return Math.round(Phaser.Math.Clamp(selected, 160, event.windowMs - 120));
  }

  private finishRun(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    this.soundEngine.play("roundEnd");
    this.emitHud(true);

    const targetShots = this.shots.filter((shot) => shot.kind === "target");
    const clickedTargets = targetShots.filter((shot) => shot.reactionMs !== null);
    const reactionAverage = average(
      clickedTargets.map((shot) => shot.reactionMs ?? 0),
    );
    const ghostAverage = average(
      targetShots.map((shot) => shot.ghostMs ?? 0).filter((value) => value > 0),
    );
    const ghostTimings = Object.fromEntries(
      clickedTargets.map((shot) => [shot.eventId, shot.reactionMs ?? 0]),
    );

    this.time.delayedCall(260, () => {
      this.callbacks.onComplete({
        score: this.score,
        avgReactionMs: Math.round(reactionAverage),
        ghostAvgMs: Math.round(ghostAverage),
        duelsWon: this.duelsWon,
        totalTargets: 12,
        shots: [...this.shots],
        ghostTimings,
        beatTopSpot: false,
      });
    });
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
