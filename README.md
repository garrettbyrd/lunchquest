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
fifth, the hero stands still until it is back over 70% — or walks to a campfire if it has
built one, which gives back health too. What it is carrying changes all of these numbers;
see [The pack](#the-pack). It won't start a boss fight below
half stamina either, though once engaged the damage race decides things as before.

## The pack

Everything the hero carries has a weight, and weight is paid in wind. Wood is heavy (2
apiece, so a boat's worth of timber is a real burden), potions and arrows less so, scrap
barely anything. Carrying capacity starts at 34, grows with level, and grows again with
the armour on its back — good armour is a harness as well as protection.

Past capacity the hero is **burdened**: sprinting costs double and its breath comes back a
point slower. Past 1.4x it is **overloaded** and cannot run at all. Nothing is ever
forbidden outright; it just gets expensive, which is the same rule stamina already plays by.

Gear it isn't wearing rides in a six-slot pack — including the piece it just replaced,
which used to be dropped on the floor and forgotten. A piece can be **broken down for
scrap** instead: 2 plus twice its tier, and 3 more if it was enchanted. That is what a
run's rejected loot is actually worth, and it is nearly weightless, which makes smashing
an ebony shield you can't use a genuine choice rather than a shrug.

Before the hero has a camp it still ignores junk on the ground — there is nowhere to put
it and nothing to spend scrap on. Build one and it starts scavenging.

## The camp

Three structures, each a pile of wood and a few turns of work, raised on whatever inland
tile is nearest and clear of the boss:

- **campfire** (3 wood) — resting beside it restores 5 stamina and 2 health a turn instead
  of the usual trickle. It burns fuel to do it: 30 turns' worth from the wood it was built
  with, 10 more per log fed in afterwards. Let it go out and it is a ring of embers until
  the hero brings more timber.
- **stash** (4 wood) — somewhere to put the pack down.
- **workbench** (5 wood) — where scrap becomes gear.

At the bench the hero **reforges** a worn piece up a tier for `4 + 5×tier` scrap and 2
wood, **tempers** an unenchanted piece with a random affix for 14 scrap, or **fletches**
6 arrows from a single log. Reforging is the only gear progression in the game that isn't
luck, which gives a floor full of disappointing drops somewhere to go.

None of it survives the descent — but **whatever is in the stash is hauled down and set
out as a supply cache** on the next floor, and that is the point. A floor's camp is spent
timber; a floor's stash is a head start on the floor below. Timber travels badly, so only
a boat's worth comes with it; worked metal and spare gear all do.

This puts wood in tension with itself. Six wood is a boat, which is how the hero reaches
an island boss or an ornate chest. Twelve is a full camp. Both matter, and a floor rarely
has time for everything — so the hero holds back exactly what it has a use for and stows
the rest.

## The moral compass

Two axes, `good` and `law`, each in [-1, 1] and carried for the length of a run. A hero
starts with a small random lean — near the origin, but no two alike — and moves from there
only by what it actually does. Every nudge is scaled by `1 - |value|`, so the first step
away from neutral is easy and the last is nearly impossible: a hero can be pushed to the
edge but never nailed there, and can always be argued back. A very slow decay means one bad
afternoon doesn't define a run while a habit does.

### What moves it

Almost all of these are events the game already fired; the compass just reads them. The
weights were set against **measured** per-run frequencies — `road` fires 66 times a run and
`raider` 0.2 times, so they cannot be worth the same — with the aim that a run's worth of
one habit is about a third of an axis: enough to cross a band, not enough to pin it.

| deed | good | law |
|---|---|---|
| cut down a raider inside the fence | +0.12 | +0.02 |
| kill something menacing a frightened villager | +0.10 | · |
| pay the asking price | +0.038 | +0.010 |
| watch a raid through and do nothing | −0.055 | · |
| lead a chase in through the gate | −0.030 | · |
| rob a stall | −0.10 | −0.13 |
| kill a villager | −0.24 | −0.07 |
| kill one that was already running | −0.36 | −0.07 |
| raise a camp structure | · | +0.022 |
| fell a tree inside the village | · | −0.060 |
| keep to the road | · | +0.0020 |
| walk away from its own plan | · | −0.020 |

Indifference is the important one. Standing by while a raid runs its course is the only
ungated road to evil, and a hero busy looting drifts there without ever deciding to.

### What it changes

**Good and evil decide who counts as prey.** Past −0.18 the hero starts robbing stalls; past
−0.45 it hunts the stallholders, who turn out to be carrying the day's takings. Past +0.10 it
goes looking for whatever is troubling the village and puts that above ordinary hunting.

**Lawful and chaotic decide how it moves.** Commitment to a target scales with `law` — 60
turns lawful, 30 chaotic — so a chaotic hero literally re-decides more, and the flip-flopping
the anti-dither code was built to suppress becomes character instead of a bug. Curiosity
runs the other way. A chaotic foot goes its own way on up to a tenth of its steps.

And a lawful hero **follows roads**. That one is a real shortest path, not a nudge: a second
pathfinder using Dial's buckets, where a made road costs one and open ground costs three, so
it will take a road up to three times longer rather than cut across a field. Small integer
weights mean the priority queue is four rotating buckets and it stays linear.

### What it costs to be a villain

Robbing and murder would otherwise be free loot, and every run would slide there. So each
village keeps a **grudge**. Wary at 0.4, it stops dealing with the hero; angry at 0.7, the
guards come for it on sight and everyone else runs. The grudge is per village and so resets
with the floor, while the alignment that earned it does not — which is what keeps an evil run
moving instead of ending in one dead village.

### Does it actually diverge?

The thing worth testing is whether runs differ, or whether every hero ends in the same
corner. Over eight headless sessions (about 45 runs):

| | share |
|---|---|
| True Neutral | 58% |
| Chaotic / Lawful Neutral | 18% |
| evil of some stripe | 15% |
| good of some stripe | 9% |

Seven of the nine alignments turn up. Most heroes are unremarkable, which is right; the ones
that aren't got there by a run's worth of small decisions.

## Seeds

Every run is one seed. It decides the island layout of all five floors, which four bosses
you draw and in what order, where the hero starts, and every item and chest roll — the
things a run's success actually hangs on. The seed shows in the HUD and on the death and
victory cards, and `?seed=1a2b3c` replays it exactly. Combat rolls stay unseeded, so a
replayed seed gives you the same world and the same kit, not the same fight.

## Worldgen

A 160x160 archipelago. Three or four island centres are scattered with a channel kept
between them — fewer and larger than they used to be, because a village needs somewhere to
stand — and land is the union of their falloffs, so the water between islands is
genuinely deep. On top of that: fBm value noise (5 octaves) for elevation and a second
field for moisture, giving water / sand / grass / meadow / forest / rock biomes. A
connected-component flood fill catalogues every island (seeds that produce only one are
rejected and re-rolled), and trails are carved within each.

The boss holds a different island about two thirds of the time, and every island past the
first has an ornate chest on it. That is what the boat is for.

## The village

Every floor puts a village on the home island, far enough from where the hero lands that it
has to be found. It is **carved into the tile map**, not drawn on top of it: log walls,
plank floors, a door apiece, tilled plots with crops coming up, a well in the middle, and a
fence with gateways left open. Seven tile types went in for it (farmland, crop, floor,
wall, door, fence, well), which means sight, arrows and pathfinding all understand a
village for free — a wall stops an eye and an arrow because it *is* a wall, not because
anything was written about houses.

Living in it are five kinds of villager, each with a trade and a tool: a **smith** with a
hammer, a **fletcher** with a bow, a **herbalist** with a flask, **farmers** with hoes, and
**guards** with spear and shield, a pair of whom stand at the gates. They are kept in their
own list, so nothing that loops over the monsters ever has to ask whether the thing it
found wants to kill you.

### Why it doesn't all just die

The obvious failure of putting friendlies and monsters on one island is that the island
resolves — everything walks toward everything else and in five minutes there is one winner
and a lot of corpses. Three rules stop that, and none of them is a wall:

- **Villagers are anchored.** Each has a home tile and will not willingly cross the fence.
  Frightened, they back away from the threat along whichever tile puts the most ground
  between them without leaving the village; cornered, they swing.
- **Guards hold a line rather than a grudge.** They close on anything that has come inside
  the fence and stop dead at its edge. A guard will never chase a fleeing monster across
  the island, which is what would otherwise strip the village of its defenders.
- **Monsters aren't interested.** They have no aggro on villagers at all, and while idling
  they specifically won't drift toward the huts. A monster only ever arrives because the
  hero led it there, or because the floor rolled a **raider** — a single monster, rarely,
  that goes for the villagers until something stops it.

Measured over 12,000 turns: 13–19 raids, 0–1 villagers lost, population steady at five to
eight. The village bleeds slowly if at all, and the hero can come back to it.

## Trade

Gold had sat in the HUD doing nothing since the first commit. Now a villager carries one
thing it will part with and a price, and the hero buys when the thing is worth having and
it has the coin:

| who | sells | roughly |
|---|---|---|
| smith | blades, shields, armour near the floor's tier, sometimes enchanted | 60–400g |
| fletcher | arrows, bows, the occasional elemental arrow | 38–400g |
| herbalist | potions | 45g |
| farmer | wood, scrap | 32–42g |

The hero only buys what it would actually use — gear that beats its kit, arrows it has room
for, wood it is short of, scrap only if it has a workbench to spend it at. Sell something
and the stall is bare for 140 turns, so a village is a place to come back to rather than a
shop to strip in one visit.

Villagers sit in the same line-of-fire model as everything else, so an arrow that finds one
hits it. What the hero does around a village is most of what shapes its character — see
[The moral compass](#the-moral-compass).

## Boats and woodcraft

The hero cannot swim. To reach another island it has to find an axe, fell trees for wood
(each tree takes a few turns and the tile really does become grass), carry six wood to a
shore tile, and spend five turns building a boat. Driftwood on the beaches is a shortcut
when no axe has turned up. Boats don't survive the descent to the next floor — the axe
does — so each floor poses the problem again with a better kit.

Monsters can't follow onto water, but archers and boss breath still reach you out there.
Anything afloat — the hero's boat, an eel, a kraken — rides the actual surface height
under it, so the whole sea bobs together.

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

## The sea itself

The ocean is a solved fluid, not a scrolling texture. Every floor bakes a
linear shallow-water problem over its own coastline and steps it four times a
game turn:

    dn/dt = -div(H u)     du/dt = -g grad(n)
    =>  d2n/dt2 = g div(H grad n) - y dn/dt

Leapfrog in time, five-point stencil in space, two cells to the tile — a
320x320 grid, about 90,000 of them wet. It is kept in **divergence form** rather
than collapsed to `c^2 lap(n)`, which is the whole trick: the wave speed is then
`c = sqrt(gH)`, so depth is a real parameter and three behaviours fall out of the
solver instead of being animated.

**Refraction.** Swell runs faster over the deeps than the shallows, so a wavefront
approaching a beach at an angle swings round to meet it square, exactly as real
surf does.

**Shoaling.** As `H` falls the same energy is carried by a slower, shorter wave, so
it stands up and steepens on the way in.

**Reflection.** A cell face that looks at land gets a coefficient of zero, which is
precisely a no-flux wall. Coastlines bounce waves back without a line of code
that knows what a coastline is.

The face coefficients are baked once per floor, so the inner loop is nine array
reads and a dozen flops with no branches at all: **2.8 ms per 145 ms turn, about
2% of one core**, measured, with the whole sea live rather than a window around
the camera.

### What makes the wake

A hull under way is a moving pressure source, laid down along the path it
actually took during the turn so the track stays smooth however many frames were
drawn. Everything else that disturbs water is the same call with different
numbers: an arrow landing, a boat launching or splintering, something surfacing,
anything that swims.

The shape of the wake is then not art direction but arithmetic. The boat makes
6.9 tiles/s; the sea is tuned to about 4.5 tiles/s over the deeps and 2.8 in the
shallows, so the **Froude number** `Fr = v/sqrt(gH)` is 1.5 offshore and 2.5 inshore.
Both are supercritical, and a supercritical source drags a Mach wedge behind it
with half-angle `asin(1/Fr)` — 41 degrees out deep, 24 close in. Choosing a depth
is choosing a wake angle.

(Being *linear* shallow water, the model is non-dispersive: every wavelength
travels at the same `c`. That is why this is a Mach wedge and not the constant
19.5-degree Kelvin wedge a real deep-water hull leaves. It is the right trade —
the honest version needs `w^2 = gk tanh(kH)` and a much more expensive solver,
and at this resolution nobody could tell.)

### Turning a height field into pixels

Three quantities come out of the solver, and each one is already a shading term:

- the **slope** is the surface normal, and the normal against a fixed light is the
  glitter on the wave faces;
- the **Laplacian** says whether the surface is focusing or spreading the light
  passing through it, which is what a caustic is;
- the **height** sets the length of the water column, and a longer column eats the
  long wavelengths first — so troughs slide toward indigo and crests toward a
  pale cyan. That is Beer-Lambert doing the hue work.

A fourth, **steepness**, is the breaking criterion: past a threshold the crest goes
to foam, which is roughly how real whitecaps are parameterised.

All four collapse into one scalar per cell, and one scalar is an index into a
ramp baked per floor — so the per-frame colour maths is a table lookup. There are
two ramps, one per water type, each centred on the colour that tile already has,
so a sea at rest looks exactly as it always did and the solver only ever pushes
colour *away* from its own rest value.

The whole layer is written into a 64x50 `ImageData` — one cell per twelve screen
pixels — and blitted up with smoothing off: one `putImageData` and one
`drawImage` a frame, 0.15 ms. Quantising a height field to 48 steps would be a
compromise at high resolution. At twelve pixels a cell it is just what the game
already looks like, and the chunky banding reads as water rather than as a
shortcut.

### Coming back to rest

Damping is per tile type and the sea is genuinely dissipative: a unit impulse
falls five orders of magnitude in half a minute, e-folding in about two seconds.
The shallows eat energy faster than the deeps, which is what a surf zone does. A
seven-tile sponge around the map edge absorbs whatever escapes, so the ocean
never rings like a bathtub.

Left alone the sea would therefore go to glass, which is dull and hides the
refraction. `SEA_SWELL` drips a little wind chop in — three tiny random impulses
a turn. Set it to zero for a dead-flat, perfectly settling ocean.

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
and the occasional elemental arrow. The hero equips what beats its kit and — once it has
somewhere to put things — packs or breaks down the rest instead of leaving it lying. Ornate chests — the ones across the water — roll more, roll richer, and
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
swim for shore → quaff if wounded → fall back to the fire if winded or hurt → run from a
boss it isn't ready for → claim a gear upgrade → stow a full pack → craft at the bench →
raise a structure it has the wood for → fight the boss if the math works → hunt trash →
loot → fell timber for the camp → scavenge for scrap → chase a roar → explore the
frontier → put to sea. Pathing is BFS over walkable tiles with a stamped
visit buffer, and it routes *around* a boss's aggro radius until the hero means to fight
it — waking a boss early is how runs used to end at level 1.

Whether to fight the boss is an actual damage race: turns-to-kill (including its armor)
against turns-to-live (including pouched potions), with the margin relaxing if the floor
drags on. Wandering monsters trickle in so there's always something to grind.

Two failsafes stop the dithering that plain priority loops fall into: a chosen target is
**committed to** for up to 45 turns, and if the hero still ping-pongs across three tiles
for 16 turns without progress, that target gets banned for 90 turns and the hero walks
away. A floor with no progress for 900 turns regenerates.

Anything the hero commits to is decided again on arrival rather than trusted: a plan to
reforge a blade is several turns old by the time it reaches the bench, and acting on the
stale version of it is how the hero ended up with a sixth-tier sword that didn't exist.

## Always-on

The simulation runs on `setInterval`, decoupled from `requestAnimationFrame`, so it keeps
playing while the tab is hidden; the camera and sprites snap rather than lerp if they fall
behind, so the view never lies. Unexpected exceptions are caught and the floor reforms.

## Poking at it

`window.LQ` exposes `hero()`, `mobs()`, `items()`, `stats()`, `run()`, `phase()`, and
`boss()` for a live run. URL params for development: `?card=died|cleared|victory|title`
freezes a transition card, `?floor=N` starts on floor N, `?kit=1` hands the hero full
ebony, a dragonbone bow, elemental arrows and a boat, `?seed=hex` replays a run, `?camp=1`
starts with a camp already standing, `?seatest=1` sails a straight line across open water so
the wake can be looked at, `?vill=1` drops the hero in the village square, and `?parade=1`
lines up the whole bestiary next to a frozen hero.

`LQ.sea()` hands back the live height field, and `LQ.splash(x, y, amp, radius)` drops a
stone in it. `LQ.npcs()` and `LQ.village()` expose the village.
