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

Bows are a gear slot with their own ladder — ash → yew → elven → glass → dragonbone —
raising both damage and range (6–9 tiles). Arrows are finite: quivers lie on the ground,
archers and imps drop what they were carrying, and the hero tops up at 24. It keeps the
last couple of arrows in reserve for bosses and closes to melee otherwise.

Elemental arrows are rare — roughly one cache a floor, occasionally out of a chest — and
the hero saves them for targets that deserve them: **fire** explodes for splash damage
(used on bosses or a cluster of three), **shock** chains to two more enemies nearby, and
**frost** freezes a target for three turns (also used when the hero is hurt and needs
distance). Melee monsters now break into a run when they're being shot at, so kiting
isn't free.

## Seeds

Every run is one seed. It decides the island layout of all five floors, which four bosses
you draw and in what order, where the hero starts, and every item and chest roll — the
things a run's success actually hangs on. The seed shows in the HUD and on the death and
victory cards, and `?seed=1a2b3c` replays it exactly. Combat rolls stay unseeded, so a
replayed seed gives you the same world and the same kit, not the same fight.

## Worldgen

A 160x160 archipelago. Three to six island centres are scattered with a channel kept
between them, and land is the union of their falloffs, so the water between islands is
genuinely deep. On top of that: fBm value noise (5 octaves) for elevation and a second
field for moisture, giving water / sand / grass / meadow / forest / rock biomes. A
connected-component flood fill catalogues every island (seeds that produce only one are
rejected and re-rolled), and trails are carved within each.

The boss holds a different island about two thirds of the time, and every island past the
first has an ornate chest on it. That is what the boat is for.

## Boats and woodcraft

The hero cannot swim. To reach another island it has to find an axe, fell trees for wood
(each tree takes a few turns and the tile really does become grass), carry six wood to a
shore tile, and spend five turns building a boat. Driftwood on the beaches is a shortcut
when no axe has turned up. Boats don't survive the descent to the next floor — the axe
does — so each floor poses the problem again with a better kit.

Monsters can't follow onto water, but archers and boss breath still reach you out there.

## Loot

Five material tiers — iron, steel, elven, glass, ebony (bows: ash, yew, elven, glass,
dragonbone) — weighted toward the current floor, so what a floor can even offer is part
of the run's shape.

Loot can carry one enchantment, which is where most of the run-to-run variance lives:
*keen* and *cruel* add damage, *vampiric* leeches a quarter of melee damage back,
*burning* sets fire to what it hits, *sturdy* and *warded* harden the hero, *swift* adds
bow range. The hero values a piece by tier and enchantment together, so a keen steel blade
can beat a plain elven one.

Chests roll real contents rather than a pile of gold: coin, potions, arrows, wood, gear,
and the occasional elemental arrow. The hero equips what beats its kit and drops the rest
on the ground. Ornate chests — the ones across the water — roll more, roll richer, and
always contain a piece of gear.

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
ebony, a dragonbone bow and elemental arrows, `?seed=hex` replays a run, and `?parade=1`
lines up the whole bestiary next to a frozen hero.
