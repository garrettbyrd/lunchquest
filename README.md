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

## Ranged combat

One model covers every arrow and bolt in the game: trace a line from the shooter, stop at
the first wall or body, apply damage there, and draw a tracer along the path. Trees and
rock block a shot; water doesn't. Archers and imps use it, boss breath uses it (so line of
sight now matters), and so does the hero once it finds a bow.

Bows are a fourth gear slot with their own ladder — ash → yew → horn → dragonbone —
raising both damage and range (6–9 tiles). Arrows are finite: quivers lie on the ground,
archers and imps drop what they were carrying, and the hero tops up at 24. It keeps the
last couple of arrows in reserve for bosses and closes to melee otherwise.

Elemental arrows are rare — roughly one cache a floor, occasionally out of a chest — and
the hero saves them for targets that deserve them: **fire** explodes for splash damage
(used on bosses or a cluster of three), **shock** chains to two more enemies nearby, and
**frost** freezes a target for three turns (also used when the hero is hurt and needs
distance). Melee monsters now break into a run when they're being shot at, so kiting
isn't free.

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
freezes a transition card, `?floor=N` starts on floor N, `?kit=1` hands the hero full
orichalcum, a dragonbone bow and elemental arrows, and `?parade=1` lines up the whole
bestiary next to a frozen hero.
