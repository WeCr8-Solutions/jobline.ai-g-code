#!/usr/bin/env python3
"""
Build the public RevPacks' target (finished part) models from what each pack's
program actually cuts, as real B-rep solids (CadQuery / OpenCascade).

    pip install cadquery==2.8.0
    python scripts/revpack-targets/generate_targets.py [out_root]

out_root defaults to test/fixtures/revpack-public. For every pack it writes
  target.step  B-rep solid, STEP AP214, in the pack's units (inch packs are
               written with an INCH unit, so OpenCascade readers convert)
  target.stl   binary STL of the same solid, numbers in the pack's units
               (STL has no unit; the RevPack's "units" says which)
and prints volume and bounds, which test/revpack-targets.test.ts checks.

Coordinates are the program's PART (work) coordinates, the same frame the
RevPack stock, workholding and revpackCorrelation segments use: X right,
Y away, Z up (spindle axis; the lathe's turning axis).

CAM has no geometry kernel to generate these (geometryKernelService and the
material-removal services are stubs), so this script is the generator. Each
feature below names the program lines that cut it.
"""
import json
import math
import os
import sys

import cadquery as cq
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.IFSelect import IFSelect_RetDone

IN = 25.4  # OpenCascade works in mm; inch packs are built in mm and written as INCH.

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'test', 'fixtures', 'revpack-public')


def box(x0, y0, z0, x1, y1, z1):
    return cq.Workplane('XY').box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def cone_down(tip, radius, height):
    """Cone with its point at `tip`, opening upward (+Z) to `radius` at tip+height."""
    return cq.Workplane('XY').add(cq.Solid.makeCone(0, radius, height, cq.Vector(*tip), cq.Vector(0, 0, 1)))


def v_prism_along_x(x0, x1, y, z_tip, height):
    """Swept volume of a vertical 90 deg cone (tip at z_tip) moved along X at fixed Y: a V prism."""
    tri = cq.Workplane('YZ', origin=(x0, 0, 0)).polyline([(y, z_tip), (y + height, z_tip + height), (y - height, z_tip + height)]).close()
    return tri.extrude(x1 - x0)


def v_prism_along_y(y0, y1, x, z_tip, height):
    tri = cq.Workplane('XZ', origin=(0, y0, 0)).polyline([(x, z_tip), (x + height, z_tip + height), (x - height, z_tip + height)]).close()
    # XZ workplane normal is -Y: extrude a negative distance to go toward +Y.
    return tri.extrude(-(y1 - y0))


def drill_x(x_face_outside, x_tip, y, z, dia):
    """Drilled hole along +X from outside the part to a 118 deg point at x_tip."""
    r = dia / 2
    point = r / math.tan(math.radians(59))
    body = cq.Workplane('YZ', origin=(x_face_outside, 0, 0)).center(y, z).circle(r).extrude(x_tip - point - x_face_outside)
    tip = cq.Workplane('XY').add(cq.Solid.makeCone(r, 0, point, cq.Vector(x_tip - point, y, z), cq.Vector(1, 0, 0)))
    return body.union(tip)


def drill_z(x, y, z_top_outside, z_tip, dia):
    r = dia / 2
    point = r / math.tan(math.radians(59))
    body = cq.Workplane('XY', origin=(0, 0, z_tip + point)).center(x, y).circle(r).extrude(z_top_outside - (z_tip + point))
    tip = cq.Workplane('XY').add(cq.Solid.makeCone(0, r, point, cq.Vector(x, y, z_tip), cq.Vector(0, 0, 1)))
    return body.union(tip)


# ---------------------------------------------------------------------------
# UMC-750 bracket (inch). Program O05001.
# ---------------------------------------------------------------------------
def umc750():
    s = IN
    part = box(-1.5 * s, -1.0 * s, -1.5 * s, 1.5 * s, 1.0 * s, -0.05 * s)  # face to Z-0.05 (T1, lines 15-24)
    # Pocket (T1 D0.5 at Z-0.3, lines 27-34): the path is a 0.5 x 0.1 rectangle,
    # the 0.25 cutter radius makes it a 1.0 x 0.6 slot with R0.25 corners.
    pocket = (cq.Workplane('XY', origin=(0, 0, -0.3 * s)).rect(0.5 * s, 0.1 * s).offset2D(0.25 * s).extrude(0.4 * s))
    part = part.cut(pocket)
    # Side holes (T3 #7 drill, B90 with DWO G254): revpackCorrelation puts the
    # tip on part X-1.6 -> X-1.0 at Z-0.75, Y-0.5 and Y+0.5.
    for y in (-0.5, 0.5):
        part = part.cut(drill_x(-1.7 * s, -1.0 * s, y * s, -0.75 * s, 0.201 * s))
    # Edge chamfer (T2 90 deg chamfer mill D0.25 under G234 TCPC): tip at Z-0.17,
    # 0.03 outside the -Y edge (X-1.7 -> X1.53) and the +X edge (Y-1.03 -> Y1.15).
    # The swept 45 deg cone leaves a 0.09 x 45 deg chamfer on both top edges with
    # a conical blend where the legs meet. Modelled with a vertical tool axis;
    # the 5-10 deg TCPC tilt changes the flank angle by under half a degree.
    h = 0.125 * s  # cone height = cutter radius (90 deg included)
    zt = -0.17 * s
    cut = v_prism_along_x(-1.7 * s, 1.53 * s, -1.03 * s, zt, h)
    cut = cut.union(v_prism_along_y(-1.03 * s, 1.15 * s, 1.53 * s, zt, h))
    for tip in ((-1.7 * s, -1.03 * s, zt), (1.53 * s, -1.03 * s, zt), (1.53 * s, 1.15 * s, zt)):
        cut = cut.union(cone_down(tip, h, h))
    part = part.cut(cut)
    return part, 'in'


# ---------------------------------------------------------------------------
# VF-2 vise plate (inch). Program O01001.
# ---------------------------------------------------------------------------
def vf2():
    s = IN
    part = box(-2.0 * s, -1.5 * s, -0.75 * s, 2.0 * s, 1.5 * s, -0.02 * s)  # face mill to Z-0.02
    for x in (-1.25, 1.25):
        for y in (-0.75, 0.75):
            # #7 drill to Z-0.9 tip: through the 0.75 plate. The 3/8 spot drill
            # (Z-0.12) leaves a 0.20 spot, inside the 0.201 hole. The 1/4-20 tap
            # (Z-0.6) is a cosmetic thread: the solid keeps the tap-drill bore,
            # as CAD models usually do.
            part = part.cut(drill_z(x * s, y * s, 0.1 * s, -0.9 * s, 0.201 * s))
    return part, 'in'


# ---------------------------------------------------------------------------
# LB3000 stepped shaft (mm). Program O1000.min. Z is the turning axis.
# ---------------------------------------------------------------------------
def lb3000():
    # Radius profile (r, z) from the finish pass (T03, lines 30-35) and the
    # grooves (T05 3.0 wide, reference corner on the +Z side): face Z0, 2x45
    # chamfer to dia 50, dia 50 to Z-30 with a dia 44 groove Z-12..-15, dia 70
    # to Z-60 with a dia 64 groove Z-42..-45, then the uncut dia 80 bar to Z-120.
    pts = [
        (0, 0), (23, 0), (25, -2), (25, -12), (22, -12), (22, -15), (25, -15), (25, -30),
        (35, -30), (35, -42), (32, -42), (32, -45), (35, -45), (35, -60),
        (40, -60), (40, -120), (0, -120),
    ]
    prof = cq.Workplane('XZ').polyline(pts).close()
    part = prof.revolve(360, (0, 0, 0), (0, 1, 0))
    return part, 'mm'


# ---------------------------------------------------------------------------
# TruLaser 3030 bracket nest (mm). Program LASER01.MPF.
# ---------------------------------------------------------------------------
def trulaser():
    kerf = 0.2  # tool diameter in the pack; the program cuts on the line (no G41)
    half = kerf / 2
    part = None
    for y0, y1 in ((50, 200), (300, 450)):
        for x0, x1 in ((50, 250), (300, 500), (550, 750)):
            b = box(x0 + half, y0 + half, -3, x1 - half, y1 - half, 0)
            part = b if part is None else part.union(b)
    return part, 'mm'


PACKS = {
    'haas-umc750-5axis': umc750,
    'haas-vf2-vise': vf2,
    'okuma-lb3000-lathe': lb3000,
    'trumpf-trulaser3030': trulaser,
}


def write(pack, part, units):
    folder = os.path.join(OUT, pack)
    os.makedirs(folder, exist_ok=True)
    shape = part.val() if len(part.vals()) == 1 else cq.Compound.makeCompound(part.vals())
    # STEP: inch packs carry an INCH unit so readers convert correctly.
    step_path = os.path.join(folder, 'target.step')
    writer = STEPControl_Writer()
    Interface_Static.SetCVal_s('write.step.schema', 'AP214IS')
    Interface_Static.SetCVal_s('write.step.unit', 'INCH' if units == 'in' else 'MM')
    Interface_Static.SetCVal_s('write.step.product.name', f'{pack} target')
    writer.Transfer(shape.wrapped, STEPControl_AsIs)
    assert writer.Write(step_path) == IFSelect_RetDone, f'STEP write failed for {pack}'
    # Strip the timestamp so regenerating gives the same bytes.
    text = open(step_path, encoding='utf-8').read()
    import re
    text = re.sub(r"FILE_NAME\('[^']*','[^']*'", "FILE_NAME('target.step','2026-10-15T00:00:00'", text, count=1)
    open(step_path, 'w', encoding='utf-8', newline='\n').write(text)
    # STL in the pack's numbers (inch packs scaled back from mm).
    k = 1 / IN if units == 'in' else 1.0
    scaled = shape.scale(k) if k != 1.0 else shape
    stl_path = os.path.join(folder, 'target.stl')
    scaled.exportStl(stl_path, tolerance=0.0005 if units == 'in' else 0.01, angularTolerance=0.15, ascii=False)
    bb = scaled.BoundingBox(tolerance=1e-7)
    info = {
        'pack': pack,
        'units': units,
        'volume': round(scaled.Volume(), 6 if units == 'in' else 3),
        'min': [round(v, 4) for v in (bb.xmin, bb.ymin, bb.zmin)],
        'max': [round(v, 4) for v in (bb.xmax, bb.ymax, bb.zmax)],
        'faces': len(shape.Faces()),
        'solids': len(shape.Solids()),
        'stepBytes': os.path.getsize(step_path),
        'stlBytes': os.path.getsize(stl_path),
    }
    return info


def main():
    manifest = []
    for pack, build in PACKS.items():
        part, units = build()
        manifest.append(write(pack, part, units))
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
