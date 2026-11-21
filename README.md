# Studies in Mantling

A touch-first editor and generator for heraldic mantling, the foliate cloth that issues from the helm. It is built with Vite and TypeScript and renders to SVG.

- **Editor:** https://cooperbpage.github.io/Heraldry-Program/
- **Proofs:** https://cooperbpage.github.io/Heraldry-Program/proofs.html shows each preset beside its reference, round by round, with the critic's ranked defects and the fixes made after each review.

## Using it on a phone
One finger draws and edits; two fingers pan and zoom. Tools are in the bottom panel:

| Tool | What it does |
| --- | --- |
| Edit | Tap a strip to show its spine handles. Tap foliage to select its cluster. Drag any handle. |
| Sweep | Draw a stem. The Smoothing slider refits the last stroke live over the raw gesture. Draw a closed loop around the shield to get an envelope, which becomes 2–3 sweeps per side. |
| Lobes | Tap a strip edge to bracket a cluster. Drag the two end handles and the outward size handle. The bare percentage is shown live, and the program won't let a strip drop below 40% bare. |
| Fork | Tap a station to branch. Drag the tip handle, the angle arm, or the root handle (dragging it toward an edge chooses the side). |
| Width | Tap a station, then drag the crossbar ends to set a width knot. |
| Volute | Tap a station. Drag the eye circle and its rim, set Turns, use Flip to change handedness, and switch between Terminal and Branching. |
| Fold | Tap the edge that rolls over. Drag the crease handle across the strip to set its angle, or along the strip to move it. The trailing handle sets the foreshortening length. |

**Compose** decorates your sweeps with clusters, branches, volutes, folds and lining fans. **Reseed** changes the generated ornament but keeps your sweeps and anything you edited by hand. **Mirror** is on by default; select a strip and tap **Linked** to break the mirror for that stroke. **More…** opens the sliders (lobe sharpness, recurve, lobe depth, cluster frequency, taper), the render toggles (flat colour, outline, midrib, shading, hatching), the presets, Reset (undoable) and Export SVG.

## Model
A tree of tapered strips. Each strip has a cubic Bézier spine (G2 at internal joins), width knots, and ordered events at normalised arc length: `cluster`, `turnover`, `branch` and `volute`. Every rendered surface is a region of a track in its own (s, v) coordinates, so outline, shading, midrib and hatching are all generated from one mapping and cannot drift apart. See `src/model/types.ts`.

## Development
```
npm install
npm run dev        # local server
npm run check      # geometry checks (G2 joins, rising volute curvature, 40% bare rule, all 32 render toggles)
npm run presets    # regenerate src/presets/*.json from scripts/author-presets.ts
npm run proofs -- round-05   # render presets beside their references into public/proofs/
node scripts/test-editor.mjs <outdir>   # headless phone-size editor test (needs `npx vite preview` running when NOSERVE=1)
```
