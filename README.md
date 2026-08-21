# Lunchquest

A self-playing roguelike that runs unattended in a browser tab. No dependencies, no build
step, no assets on disk — every tile texture and sprite is drawn procedurally at boot.

    python3 serve.py 8765     # → http://127.0.0.1:8765/

Localhost only. Refresh for a fresh seed.

## A run

Five floors. Floors 1–4 each get a boss drawn at random from a pool of ten; floor 5 is
always Xanthemar, the Undying — the lich. Clear a floor and the hero descends with its
gear and levels intact. Die and the run ends: `YOU DIED`, a title card, then a new hero
starts over at floor 1. Each floor has its own palette (Verdant Shore → Amber Reach →
Ashen Waste → Frostmarch → The Black Vault), applied as hue/saturation blend passes over
the shared tilesheet.

The boss pool: Vermathrax the Ember, The Broodmother, Grond Bull of the Deep, Sablecoil
the Basilisk, The Kraken of Still Water, Aurex Stone Warden, Skarn the Wyvern, The
Chimera, Malzeth the Necromancer, The Hollow Wraith. Each has one trick — ranged breath,
minion summoning, a three-tile charge, life drain, or just a lot of armor. The lich does
most of them at once and heals itself.

## Gear

Blades, shields, and armor spawn on the ground in an iron → steel → electrum →
orichalcum ladder, with tiers weighted toward the current floor. The hero picks up an
upgrade and ignores anything worse than what it's carrying. Potions go in a pouch (max
three) rather than being drunk on the spot, and get quaffed at 45% health.

## Worldgen

fBm value noise (5 octaves) for elevation, a second noise field for moisture, and a
radial falloff, giving water / sand / grass / meadow / forest / rock biomes on an island.
A connected-component flood fill picks the main landmass (dud seeds are rejected and
re-rolled), drunken-walk trails are carved between landmarks, and everything spawns on
the reachable component — so the hero can always path to what it wants.

## The brain

Priority loop, re-decided every 145 ms turn: quaff if wounded → hit an adjacent foe →
run from a boss it isn't ready for → claim a gear upgrade → fight the boss if the math
works → hunt trash → loot → explore. Pathing is BFS over walkable tiles with a stamped
visit buffer, and it routes *around* a boss's aggro radius until the hero means to fight
it — waking a boss early is how runs used to end at level 1.

Whether to fight the boss is an actual damage race: turns-to-kill (including its armor)
against turns-to-live (including pouched potions), with the margin relaxing if the floor
drags on. Wandering monsters trickle in so there's always something to grind.

Two failsafes stop the dithering that plain priority loops fall into: a chosen target is
**committed to** for up to 45 turns, and if the hero still ping-pongs across three tiles
for 16 turns without progress, that target gets banned for 90 turns and the hero walks
away. A floor with no progress for 900 turns regenerates.

## Always-on

The simulation runs on `setInterval`, decoupled from `requestAnimationFrame`, so it keeps
playing while the tab is hidden; the camera and sprites snap rather than lerp if they fall
behind, so the view never lies. Unexpected exceptions are caught and the floor reforms.

## Poking at it

`window.LQ` exposes `hero()`, `mobs()`, `items()`, `stats()`, `run()`, `phase()`, and
`boss()` for a live run. URL params for development: `?card=died|cleared|victory|title`
freezes a transition card, `?floor=N` starts on floor N, `?parade=1` lines up the whole
bestiary next to a frozen hero.
