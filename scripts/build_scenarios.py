"""Generate GhostPeek scenario data.

The default path is deterministic and uses fixed pacing windows that match a
30-second booth run. When a local GRID-style event export is supplied, the file
is used only as a timing source; all values are clamped back into the same
playable arcade bounds.
"""

import argparse
import json
import math
import random
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "src" / "data" / "scenarios.json"
MIN_GHOST_MS = 490
MAX_GHOST_MS = 740
TARGET_WINDOW_MS = 1_650
DECOY_WINDOW_MS = 1_050


ROUND_DEFS = [
    {
        "round": 1,
        "name": "Pistol Rush",
        "start": 0,
        "end": 10_000,
        "targets": 5,
        "decoys": 1,
        "paceOffset": 36,
    },
    {
        "round": 2,
        "name": "Site Retake",
        "start": 10_000,
        "end": 20_000,
        "targets": 4,
        "decoys": 2,
        "paceOffset": 14,
    },
    {
        "round": 3,
        "name": "1v2 Clutch",
        "start": 20_000,
        "end": 30_000,
        "targets": 3,
        "decoys": 1,
        "paceOffset": -10,
    },
]


SPAWN_TEMPLATES = {
    1: [760, 2_280, 3_900, 5_560, 7_260, 8_770],
    2: [10_620, 12_210, 13_820, 15_560, 17_140, 18_710],
    3: [20_850, 23_050, 25_280, 27_640],
}


COORD_TEMPLATES = [
    (0.18, 0.26),
    (0.49, 0.22),
    (0.78, 0.31),
    (0.27, 0.53),
    (0.63, 0.49),
    (0.84, 0.67),
    (0.38, 0.74),
    (0.16, 0.79),
    (0.57, 0.78),
    (0.86, 0.20),
    (0.31, 0.34),
    (0.69, 0.62),
    (0.46, 0.43),
    (0.14, 0.62),
    (0.82, 0.80),
    (0.60, 0.35),
]


KIND_TEMPLATES = {
    1: ["target", "target", "decoy", "target", "target", "target"],
    2: ["target", "decoy", "target", "target", "decoy", "target"],
    3: ["target", "decoy", "target", "target"],
}


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def numeric_timestamp_ms(item):
    """Return one timestamp-like number in milliseconds from an event object."""

    if not isinstance(item, dict):
        return None

    preferred = [
        "timestampMs",
        "timeMs",
        "gameTimeMs",
        "roundTimeMs",
        "occurredAtMs",
        "timestamp",
        "time",
        "gameTime",
        "roundTime",
        "occurredAt",
    ]
    for key in preferred:
        if key in item and isinstance(item[key], (int, float)):
            value = float(item[key])
            if value < 10_000:
                value *= 1000
            return int(value)
    return None


def event_mentions_duel(item):
    if not isinstance(item, dict):
        return False
    text = json.dumps(item, sort_keys=True).lower()
    markers = ("kill", "duel", "elimination", "frag", "damage")
    return any(marker in text for marker in markers)


def walk_events(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_events(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_events(child)


def load_json_or_jsonl(path):
    raw = Path(path).read_text(encoding="utf-8")
    stripped = raw.strip()
    if not stripped:
        return []
    try:
        parsed = json.loads(stripped)
        return list(walk_events(parsed))
    except json.JSONDecodeError:
        events = []
        for line in stripped.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            events.extend(walk_events(parsed))
        return events


def extract_grid_timings(path):
    timestamps = []
    for item in load_json_or_jsonl(path):
        if not event_mentions_duel(item):
            continue
        timestamp = numeric_timestamp_ms(item)
        if timestamp is not None:
            timestamps.append(timestamp)

    timestamps = sorted(set(timestamps))
    timings = []
    for prev, current in zip(timestamps, timestamps[1:]):
        delta = current - prev
        if 75 <= delta <= 3_000:
            scaled = MIN_GHOST_MS + int(
                (min(delta, 1_000) / 1_000) * (MAX_GHOST_MS - MIN_GHOST_MS)
            )
            timings.append(clamp(scaled, MIN_GHOST_MS, MAX_GHOST_MS))
    return timings


def next_ghost_ms(rng, timing_pool, distance, pace_offset, index):
    # Scale reaction baseline smoothly from ~490-550ms for nearby peeks
    # to ~620-740ms for cross-screen flicks, modulated by round pace.
    dist_factor = clamp((distance - 0.20) / 0.50, 0.0, 1.0)
    base_ms = 492 + dist_factor * 212 + pace_offset
    if timing_pool:
        source = timing_pool[index % len(timing_pool)]
        blended = int(round(base_ms * 0.7 + source * 0.3))
        return int(clamp(blended, MIN_GHOST_MS, MAX_GHOST_MS))
    jitter = rng.randint(-12, 12)
    return int(clamp(round(base_ms + jitter), MIN_GHOST_MS, MAX_GHOST_MS))


def build_scenarios(timing_pool=None):
    rng = random.Random(9_017)
    timing_pool = timing_pool or []
    events = []
    coord_index = 0
    timing_index = 0
    prev_x, prev_y = 0.5, 0.5

    for round_def in ROUND_DEFS:
        round_no = round_def["round"]
        kinds = KIND_TEMPLATES[round_no]
        spawns = SPAWN_TEMPLATES[round_no]
        pace_offset = round_def["paceOffset"]

        for local_index, (kind, spawn_ms) in enumerate(zip(kinds, spawns), start=1):
            x_norm, y_norm = COORD_TEMPLATES[coord_index]
            coord_index += 1
            distance = math.dist((prev_x, prev_y), (x_norm, y_norm))
            ghost_ms = next_ghost_ms(
                rng, timing_pool, distance, pace_offset, timing_index
            )
            timing_index += 1
            prev_x, prev_y = x_norm, y_norm

            events.append(
                {
                    "id": f"r{round_no}-e{local_index}",
                    "round": round_no,
                    "roundName": round_def["name"],
                    "spawnTimeMs": spawn_ms,
                    "windowMs": (
                        DECOY_WINDOW_MS if kind == "decoy" else TARGET_WINDOW_MS
                    ),
                    "xNorm": x_norm,
                    "yNorm": y_norm,
                    "kind": kind,
                    "proGhostMs": ghost_ms,
                }
            )

    return events


def validate(events):
    if len(events) != 16:
        raise ValueError("expected exactly 16 events")
    if sum(1 for event in events if event["kind"] == "target") != 12:
        raise ValueError("expected exactly 12 targets")
    if sum(1 for event in events if event["kind"] == "decoy") != 4:
        raise ValueError("expected exactly 4 decoys")

    previous_spawn = None
    for event in events:
        if not 0 <= event["spawnTimeMs"] < 30_000:
            raise ValueError(f"{event['id']} spawn is outside the 30s run")
        if previous_spawn is not None and event["spawnTimeMs"] - previous_spawn < 1_450:
            raise ValueError(f"{event['id']} spawns too close to the previous event")
        previous_spawn = event["spawnTimeMs"]
        if not 0.14 <= event["xNorm"] <= 0.86:
            raise ValueError(f"{event['id']} xNorm is out of bounds")
        if not 0.20 <= event["yNorm"] <= 0.82:
            raise ValueError(f"{event['id']} yNorm is out of bounds")
        if not MIN_GHOST_MS <= event["proGhostMs"] <= MAX_GHOST_MS:
            raise ValueError(f"{event['id']} ghost timing is out of bounds")
        expected_window = (
            DECOY_WINDOW_MS if event["kind"] == "decoy" else TARGET_WINDOW_MS
        )
        if event["windowMs"] != expected_window:
            raise ValueError(f"{event['id']} windowMs mismatch")


def main():
    parser = argparse.ArgumentParser(description="Build GhostPeek scenario data.")
    parser.add_argument(
        "--grid-file",
        type=Path,
        help="Optional local GRID-style JSON or JSONL file used as a timing source.",
    )
    args = parser.parse_args()

    timing_pool = extract_grid_timings(args.grid_file) if args.grid_file else []
    events = build_scenarios(timing_pool)
    validate(events)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(events, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(events)} events to {OUT_PATH}")


if __name__ == "__main__":
    main()
