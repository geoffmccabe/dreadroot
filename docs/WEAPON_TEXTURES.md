# Why several Siege Worlds weapons render bare white

## What is wrong

Nine of the converted SWU weapons show up in the game as featureless white
props: the Basic Pistol, the Revolver, the Plasma Pistol, Shi Yang's Pistol,
Bonnie's Rifle, the Flamethrower, the Crossbow, the Baseball Bat and the Golf
Club.

## Why

They are not textured in Unity either. In the Unity project each of these
weapons is coloured by **eight solid-colour material slots named uv1 … uv8**,
one per part of the model (grip, barrel, trim, and so on):

    ~/siege-worlds/Assets/Content/_weapon/Weapons/Item_models/15_Pistol_Small/
        15.fbx
        Material/Level1/uv1.mat … uv8.mat     <- base tier colours
        Material/Level2 … Level7              <- one palette PER UPGRADE TIER

`Level1/uv3.mat` for the Basic Pistol, for example, is `_BaseColor rgb
(0.774, 0.296, 0)` — burnt orange — and `Level4/uv3.mat` is bright pink. So the
upgrade tiers are not just stat changes: each tier has its own colour scheme.

**The FBX to glb conversion collapsed all eight slots into one white material.**
The geometry and UVs survived; the per-part material assignment did not. That is
the whole bug.

## Why the shared atlas is not the fix

Some SWU weapons DO use a shared Synty atlas (`PolygonMilitary_Weapons_01`,
embedded in the Musket's glb and extracted to `/siege/weapons/atlas_military.png`).
Painting it onto the white models is tempting and mostly wrong. The UVs say so:

| model | UV range | reading |
|---|---|---|
| Musket (`item_2`) | u 0.073–0.162, v 0.861–0.989 | one small atlas island |
| Shi Yang's (`item_25`) | u 0.073–0.162, v 0.861–0.989 | **identical** — same atlas, certain |
| Basic Pistol (`item_15`) | u 0.013–0.974, v 0.082–0.977 | full-square unwrap, NOT an atlas |
| Revolver (`item_201`) | u 0.013–0.994, v 0.695–0.991 | full-square unwrap |
| Plasma Pistol (`item_0`) | u 0.011–0.994, v 0.694–0.988 | full-square unwrap |

Pasting an atlas over a full-square unwrap smears unrelated swatches across the
gun. So `atlas` in `weaponModels.ts` is set only where the UVs prove it
(currently Shi Yang's Pistol alone). `;` in the lineup cycles it by hand for
experimenting.

## The actual fix

Re-convert the FBXs with Blender (4.4 is installed) preserving the material
slots, then bake each slot's Unity `_BaseColor` onto it:

1. Import `<n>_<name>/<n>.fbx`, keeping material slots.
2. Read `Material/Level1/uv<k>.mat` `_BaseColor` for each slot.
3. Set the Principled BSDF base colour per slot (Unity `_BaseColor` and glTF
   `baseColorFactor` are both linear, so the values copy across directly).
4. Export glb over `public/siege/weapons/item_<n>.glb`.

Worth doing at the same time: the per-tier palettes (Level1..Level7) are the
game's own tier colouring, and exporting them would let a T5 pistol actually
look like a T5 pistol.

## Weapons that are already fine

The AK74, Pickaxe and Flame Glove carry hand-authored per-material colours that
DID survive conversion, and the Muskets, M16, M27, Dragunov, MP5, Shotgun,
Rocket Launcher, ZK-5 and the plasma weapons carry real embedded textures.
`weaponAtlas.ts` never touches any of them.
