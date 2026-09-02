# Lunchquest

A self-playing roguelike that runs unattended in a browser tab. No dependencies, no build
step, no assets on disk — every tile texture and sprite is drawn procedurally at boot,
and the fourteen bosses are hand-pixelled bitmaps kept as text in the source, coloured
from each boss's palette and cached to offscreen canvases the first time they're seen.

    python3 serve.py 8765     # → http://127.0.0.1:8765/

Localhost only. Refresh for a fresh seed.

## A run

Five floors. Floors 1–4 each get a boss — three drawn from the land pool and one from the
sea, in random order; floor 5 is always Xanthemar, the Undying — the lich. Clear a floor and the hero descends with its
gear and levels intact. Die and the run ends: `YOU DIED`, a title card, then a new hero
starts over at floor 1. Each floor has its own palette (Verdant Shore → Amber Reach →
Ashen Waste → Frostmarch → The Black Vault), applied as hue/saturation blend passes over
the shared tilesheet.

The land boss pool: Vermathrax the Ember, The Broodmother, Grond Bull of the Deep,
Sablecoil the Basilisk, Aurex Stone Warden, Skarn the Wyvern, The Chimera, Malzeth the
Necromancer, The Hollow Wraith. Three of the four floor bosses come from there and one
always comes from the water (see below). Each has one trick — ranged breath,
minion summoning, a three-tile charge, life drain, or just a lot of armor. The lich does
most of them at once and heals itself.

## Gear

Blades, shields, and armor spawn on the ground in an iron → steel → electrum →
orichalcum ladder, with tiers weighted toward the current floor. The hero picks up an
upgrade and ignores anything worse than what it's carrying. Potions go in a pouch (max
four) rather than being drunk on the spot, and get quaffed at 45% health.

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

## Stamina

Everything that breathes — hero, trash, bosses, the lich — is a `Being`: a place on the
map, health, stamina, and the animation counters the renderer wants. `Hero` and `Mob` hang
their own bookkeeping off that one prototype, so the stamina rules below are written once
and apply to all of them.

Actions cost wind, Morrowind-style. A sword swing costs four (five for a heavy blade), a
bow shot three, a boss's blow six, a boss charge twelve, a summoning eight. Chopping and
boat-building take a little every turn. Running out doesn't stop anyone: a winded
creature still fights, but its blows land at 60% strength, scaling back up to full at half
stamina. A winded archer can't draw and closes to melee instead; a boss that can't afford
its trick walks up and hits you like anything else.

Stamina comes back at the end of a turn based on what the body did: nothing → a full
breath (three a turn for a fresh hero, more as its pool grows; two for trash, three for
bosses, four for the lich); a walk → one; a fight or a sprint → none. Gear can carry a
*vigorous* enchantment that widens the pool, level-ups widen it and refill it, potions
restore some, and a new floor starts fresh.

**Walk or run.** Anyone with wind to spare can take a second step in a turn for three
stamina, never on water. The hero sprints when fleeing, when badly hurt and heading for a
potion, when closing on a foe while above half stamina, and otherwise only when well
rested and it just wants to get somewhere. Melee monsters sprint to run down a hero who is
shooting at them, as long as they can afford it. The HUD marks a running turn with `»` and
a sprinting body kicks up dust behind it.

**Catching breath.** With nothing threatening within seven tiles and stamina under a
fifth, the hero stands still until it is back over 70%. It won't start a boss fight below
half stamina either, though once engaged the damage race decides things as before.

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

## The water

The sea is no longer a safe corridor. Eels, jellies and nixies (which cast from five
tiles) live in the shallows and can only move through water; crabs are amphibious and
harpies fly, so both will come ashore after you. Something that only swims cannot touch a
hero standing inland, which makes backing away from the water's edge and shooting a real
tactic — and it is what the hero does.

A boat has a hull worth three hits. Sea creatures strike harder at a hero who is afloat,
and every hit they land has a good chance of taking a plank with it. When the hull goes,
the hero is in the water: it swims, every stroke costs stamina and none comes back, it
cannot use the bow, and once the stamina is gone it starts to drown — a point of health
every other turn until it drags itself ashore.

Every archipelago has a few islets too small to be called islands. Each holds a guard or
two and something worth the crossing — often an ornate chest, sometimes a mimic, which is
a chest with teeth.

## The deep bosses

Four of them, and every run draws exactly one: the Kraken of Still Water (summons its own
shoal), Grandfather Sturgeon (an armoured bulk that charges), the Siren of Salt Harbour
(sings from a distance), and Nessa of the Long Loch (a charging long-neck). They hold the
water rather than an island, so the hero either sails out to meet one or stands on the
beach and empties a quiver into it.

## Loot

Five material tiers — iron, steel, elven, glass, ebony (bows: ash, yew, elven, glass,
dragonbone) — weighted toward the current floor, so what a floor can even offer is part
of the run's shape.

Loot can carry one enchantment, which is where most of the run-to-run variance lives:
*keen* and *cruel* add damage, *vampiric* leeches a quarter of melee damage back,
*burning* sets fire to what it hits, *sturdy* and *warded* harden the hero, *vigorous*
deepens its stamina pool, *swift* adds bow range. The hero values a piece by tier and enchantment together, so a keen steel blade
can beat a plain elven one.

Chests roll real contents rather than a pile of gold: coin, potions, arrows, wood, gear,
and the occasional elemental arrow. The hero equips what beats its kit and drops the rest
on the ground. Ornate chests — the ones across the water — roll more, roll richer, and
always contain a piece of gear.

## What the hero knows

The hero is not given the map. It sees about 11 tiles (16 from a boat), a ridge of rock
blocks the view behind it, and everything else is dark. Terrain, once glimpsed, is
remembered; monsters are remembered for about 45 turns after they leave sight and then
forgotten. The view renders exactly this — black where the hero has never been, dimmed
where it is working from memory, lit where it can currently see — and monsters it only
half-remembers are drawn as faint ghosts at their last known position. The minimap fills
in as the run goes, and the HUD shows how much of the floor has been walked.

Every decision runs off that partial picture. It cannot path to a chest it hasn't found or
hunt a boss it hasn't laid eyes on. With nothing pressing it heads for the nearest
*frontier* — a tile it has seen that borders somewhere it hasn't — and it will break off
now and then just to go look at the dark. A boss that stays unfound long enough starts to
roar, which gives the hero a rough bearing rather than a map pin; if the roar came from
across the water, that is what sends it looking for an axe.

## The brain

Priority loop, re-decided every 145 ms turn, over known things only: hit an adjacent foe →
swim for shore → quaff if wounded → catch breath if winded and unthreatened → run from a
boss it isn't ready for → claim a gear upgrade → fight the boss if the math works → hunt
trash → loot → chase a roar → explore the frontier → put to sea. Pathing is BFS over walkable tiles with a stamped
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
ebony, a dragonbone bow, elemental arrows and a boat, `?seed=hex` replays a run, and `?parade=1`
lines up the whole bestiary next to a frozen hero.
