# GhostPeek

[AI showcase notes](AI_SHOWCASE.md)

GhostPeek is a 30-second booth reaction mini game for the Cloud9 x JetBrains Hackathon, Category 3: Event Mini Game. It runs fully in the browser with Phaser 3, TypeScript, localStorage, and procedural Web Audio.

Click blue targets before the Ghost. Hold fire on red decoys.

## Run

Generate the scenario data:

```powershell
python scripts/build_scenarios.py
```

Optionally build timings from a local GRID-style JSON or JSONL export:

```powershell
python scripts/build_scenarios.py --grid-file path\to\events.jsonl
```

Install and start the game:

```powershell
npm install
npm run dev
```

Build for release:

```powershell
npm run build
```

Run the Python tests:

```powershell
python -m unittest discover -s tests
```

All artwork and audio are 100% original. The arena visuals are drawn in Phaser, and every sound is generated with the Web Audio API. The project does not use third-party game names, character names, location names, or copyrighted assets.
