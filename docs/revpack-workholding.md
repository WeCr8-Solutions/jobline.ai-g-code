# RevPack workholding: the UMC-750 Makro-Grip setup

The public UMC-750 packs (`test/fixtures/revpack-public/haas-umc750-5axis*`) hold the
bracket in a LANG Makro-Grip 77 5-axis vise on a Quick-Point 52 zero-point plate.
The vise is built **parametrically from LANG's published numbers**; no LANG CAD file
was downloaded or used. Every number below is in the pack's `workholdingSpec`.

## Published specs used

| What | Value | Source |
| --- | --- | --- |
| Makro-Grip 77 5-axis vise, item 48120-77 | 130 x 77 x 65 mm, jaw width 77 mm, clamping range 0-120 mm | LANG product page 48120-77 [1] |
| Clamping force | 14,000 N at the maximum 60 Nm | [1] |
| Clamping depth | 3 mm, form-fit in the serration on a pre-stamped blank | [1], operating instructions §1.7.3 "standard clamping depth / support height ... is 3 mm" [3] |
| Serration | holding teeth every 6 mm (Makro-Grip), 3 mm (Makro-Grip FS) | operating instructions §1.4 [3] |
| Pre-stamping | blank stamped outside the machine on a LANG stamping unit, up to 20 t, < 5 s per part; the jaw serration engages the stamped contour | LANG raw-part machining page [4], operating instructions §1.1 [3] |
| Heights | base body 38 mm, jaw top 62 mm above the vise's bottom face, clamping studs 22 mm below; jaws forward 6-70 mm, reversed 52-120 mm | published drawing 48120-77 pages 2-3 [2] |
| Quick-Point 52 single plate 45150 | 150 x 116 x 27 mm | LANG product listing [5] |
| Larger sizes (reference) | Makro-Grip 125 (48155-77): 160 x 125 x 89 mm, 20,000 N at 100 Nm | LANG product page 48155-77 [6] |
| Generic self-centering 5-axis vise (reference) | 5th Axis V562X: 125.7 x 152.4 x 73.6 mm, 125.7 mm jaws, 25.0 kN at 75 Nm, 8.3-78 mm forward; serrated teeth for stock < 35 HRC, built-in 45 deg dovetail | 5th Axis product page [7] |

Not published, and therefore modelled (stated in the pack's `workholdingSpec.notes`):
jaw thickness 12 mm (scaled from the drawing), and the riser that keeps the C-table at
the pack's Z-5.5.

## How the pack uses them (inches, part coordinates, G54 at the part's top centre)

- Stock: target bounds grown by the setup offsets: 0 on the sides, 0.05 on top, 0.15 below
  (3 mm = 0.1181 grip + cut-off allowance): 3.0 x 2.0 x 1.65 in, Z-1.65..0.
- Jaws: clamp the Y faces (Y +/-1.0), width 77 mm in X, top at stock bottom + 3 mm
  (Z-1.5319: the blank rests on the jaws' 3 mm step), down to the body top.
- Base body Z-3.9728..-2.4767 (38 mm), 130 mm along Y; zero-point plate 27 mm below it;
  riser to Z-5.5.
- Gripped region: the bottom 3 mm of the stock, drawn magenta.

## Checks

- `rapid-into-jaw`, `feed-into-vise-body`, `rapid-into-zero-point`, `rapid-into-riser` ...: a move
  into a solid, named by its role and with the solid's name.
- `grip-depth-below-recommended`: setup grip depth below `workholdingSpec.recommendedGripDepth`.
- `feed-into-grip-zone`: a feed into the gripped stock within the grip depth of a clamped face.
- `tilted-tool-hits-jaw` (and `-vise-body`, ...): with the tool tilted, its shank (to the
  stick-out) or holder reaches a workholding solid.

## Sources

1. https://lang-technik-usa.com/en/products/48120-77-makro-grip-77-5-axis-vise-jaw-width-77-mm-clamping-range-0-120-mm
2. https://lang-technik-usa.com/sites/default/files/zeichnungen/48120-77_Seite_2.jpg and _Seite_3.jpg (published drawing)
3. https://lang-technik.de/sites/default/files/anleitung/02-2024_Makro-Grip_EN.pdf
4. https://lang-technik.de/en/solutions/workholding-milling
5. https://lang-technik-usa.com/en/products/45150-quick-point-52-single-plate-150-x-116-x-27-mm-bores-100-x-50-mm-and-clamping-edge
6. https://lang-technik-usa.com/en/products/48155-77-makro-grip-125-5-axis-vise-jaw-width-77-mm-clamping-range-0-155-mm
7. https://5thaxis.com/product/v562x
