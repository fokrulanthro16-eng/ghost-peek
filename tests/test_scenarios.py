import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCENARIO_PATH = ROOT / "src" / "data" / "scenarios.json"


class ScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.events = json.loads(SCENARIO_PATH.read_text(encoding="utf-8"))

    def test_schema_and_counts(self):
        self.assertEqual(len(self.events), 16)
        self.assertEqual(sum(event["kind"] == "target" for event in self.events), 12)
        self.assertEqual(sum(event["kind"] == "decoy" for event in self.events), 4)

        required = {
            "id",
            "round",
            "roundName",
            "spawnTimeMs",
            "windowMs",
            "xNorm",
            "yNorm",
            "kind",
            "proGhostMs",
        }
        ids = set()
        for event in self.events:
            self.assertEqual(set(event), required)
            self.assertNotIn(event["id"], ids)
            ids.add(event["id"])
            self.assertIn(event["round"], (1, 2, 3))
            self.assertIsInstance(event["roundName"], str)
            self.assertIn(event["kind"], ("target", "decoy"))

    def test_timing_bounds(self):
        previous_spawn = None
        for event in self.events:
            self.assertGreaterEqual(event["spawnTimeMs"], 0)
            self.assertLess(event["spawnTimeMs"], 30_000)
            self.assertGreaterEqual(event["proGhostMs"], 450)
            self.assertLessEqual(event["proGhostMs"], 780)

            if event["kind"] == "target":
                self.assertEqual(event["windowMs"], 1_650)
            else:
                self.assertEqual(event["windowMs"], 1_050)

            if previous_spawn is not None:
                self.assertGreaterEqual(event["spawnTimeMs"] - previous_spawn, 1_450)
            previous_spawn = event["spawnTimeMs"]

    def test_round_profiles(self):
        expected = {
            1: ("Pistol Rush", 5, 1),
            2: ("Site Retake", 4, 2),
            3: ("1v2 Clutch", 3, 1),
        }
        for round_no, (name, target_count, decoy_count) in expected.items():
            events = [event for event in self.events if event["round"] == round_no]
            self.assertTrue(events)
            self.assertTrue(all(event["roundName"] == name for event in events))
            self.assertEqual(sum(event["kind"] == "target" for event in events), target_count)
            self.assertEqual(sum(event["kind"] == "decoy" for event in events), decoy_count)
            self.assertTrue(all(450 <= event["proGhostMs"] <= 780 for event in events))

    def test_distance_scales_ghost_timings(self):
        prev = (0.5, 0.5)
        nearby = []
        far = []
        for event in self.events:
            dist = math.dist(prev, (event["xNorm"], event["yNorm"]))
            if dist <= 0.30:
                nearby.append(event["proGhostMs"])
            elif dist >= 0.55:
                far.append(event["proGhostMs"])
            prev = (event["xNorm"], event["yNorm"])
        self.assertTrue(nearby)
        self.assertTrue(far)
        self.assertLess(max(nearby), min(far))

    def test_coordinates_are_valid_and_non_overlapping(self):
        for event in self.events:
            self.assertGreaterEqual(event["xNorm"], 0.14)
            self.assertLessEqual(event["xNorm"], 0.86)
            self.assertGreaterEqual(event["yNorm"], 0.20)
            self.assertLessEqual(event["yNorm"], 0.82)

        for index, first in enumerate(self.events):
            for second in self.events[index + 1 :]:
                distance = math.dist(
                    (first["xNorm"], first["yNorm"]),
                    (second["xNorm"], second["yNorm"]),
                )
                self.assertGreaterEqual(distance, 0.13)


if __name__ == "__main__":
    unittest.main()
