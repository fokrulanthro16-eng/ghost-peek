export type ScenarioKind = "target" | "decoy";
export type OpponentMode = "pro" | "fan";
export type ScreenName = "start" | "arena" | "end";

export interface ScenarioEvent {
  id: string;
  round: 1 | 2 | 3;
  roundName: string;
  spawnTimeMs: number;
  windowMs: number;
  xNorm: number;
  yNorm: number;
  kind: ScenarioKind;
  proGhostMs: number;
}

export type ShotOutcome =
  | "faster"
  | "slower"
  | "miss"
  | "held"
  | "baited";

export interface ShotResult {
  eventId: string;
  kind: ScenarioKind;
  round: 1 | 2 | 3;
  label: string;
  outcome: ShotOutcome;
  scoreDelta: number;
  reactionMs: number | null;
  ghostMs: number | null;
  deltaMs: number | null;
}

export interface GhostTimingMap {
  [eventId: string]: number;
}

export interface LeaderboardEntry {
  handle: string;
  score: number;
  avgReactionMs: number;
  duelsWon: number;
  totalTargets: number;
  createdAt: string;
  ghostTimings: GhostTimingMap;
}

export interface GhostRunSummary {
  score: number;
  avgReactionMs: number;
  ghostAvgMs: number;
  duelsWon: number;
  totalTargets: number;
  shots: ShotResult[];
  ghostTimings: GhostTimingMap;
  beatTopSpot: boolean;
}

export interface HudState {
  roundName: string;
  countdownMs: number;
  score: number;
  streak: number;
  opponentLabel: string;
}
