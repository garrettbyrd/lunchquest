# Lunchquest

A tiny 2D RPG that plays itself. No dependencies, no build step, no assets on disk —
every tile texture and sprite is drawn procedurally at boot.

    python3 serve.py 8765     # → http://127.0.0.1:8765/

Localhost only. Refresh for a fresh seed.

## Worldgen

fBm value noise (5 octaves) for elevation, a second noise field for moisture, and a
radial falloff, giving water / sand / grass / meadow / forest / rock biomes on an island.
A connected-component flood fill picks the main landmass (dud seeds are rejected and
re-rolled), drunken-walk trails are carved between random landmarks, and entities only
spawn on the reachable component — so the hero can always path to everything.

## The hero

Re-decides every 145 ms turn: heal if wounded → hit an adjacent foe → hunt anything
within 16 tiles → loot the nearest chest → pick up a potion (only when actually hurt) →
otherwise explore. Pathing is BFS over walkable tiles with a stamped visit buffer,
treating other entities as obstacles. Monsters take their own aggro/chase/attack turns
at per-type speeds.

## Always-on

The simulation runs on `setInterval`, decoupled from `requestAnimationFrame`, so it keeps
playing while the tab is hidden; the camera and sprites snap rather than lerp if they fall
behind, so the view never lies. Clear a region → next depth. Die → new hero, new world.
Stuck for 700 turns → new lands. Unexpected exceptions are caught and the world reforms.

`window.LQ` exposes `hero()`, `mobs()`, `stats()`, and `tick()` for poking at a live run.
