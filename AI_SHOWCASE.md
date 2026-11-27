# AI Showcase

GhostPeek was built with PyCharm and JetBrains AI Assistant as the coding environment.

AI assistance was used to draft and refine:

- The standard-library Python scenario generator.
- The unittest schema and timing checks for generated scenario data.
- The Phaser 3 gameplay scene for targets, decoys, ghost timing, scoring, and round transitions.
- The TypeScript UI state machine for the start screen, arena screen, end card, leaderboard, localStorage, and booth reset timer.
- The Vite and TypeScript build setup.

The implementation was kept local and inspectable. The generated game data lives in `src/data/scenarios.json`, browser state is stored only in localStorage, and audio is synthesized at runtime with the Web Audio API.
