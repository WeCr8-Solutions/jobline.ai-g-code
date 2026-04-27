# Operator Verification Report

**Date:** 2026-04-26T20:44:51.247Z

## Fixture
- Program: REVGRIPS STEM 50-35 PRO
- G-code: test/fixtures/revpack/stem umc sample.nc
- Fixture mode: none
- Machine type: 5-Axis Mill (Trunnion)
- Work offsets: G254, G54
- Tools extracted: 17
- Goal models: Goal model (.x_t bounds), Goal model (.stl bounds)
- G-code units: in
- Cut moves: 19329
- Diagnostic severity: error
- Diagnostics: 5 total (5 error, 0 warning, 0 info)

## Output
- Verification artifact: test\fixtures\revpack\revpack.visual-verification.json

## Result
- Solid-model verification completed against available goal models.
- Goal model (.x_t bounds): FAIL (test\fixtures\revpack\REVGRIPS STEM-50-35-PRO.x_t)
- Goal model (.stl bounds): missing (test\fixtures\revpack\REVGRIPS STEM-50-35-PRO.stl)

## Operator Risk Summary
- [ERROR] L1211: G83 peck cycle requires Q (peck depth)
- [ERROR] L1226: G83 peck cycle requires Q (peck depth)
- [ERROR] L1242: G83 peck cycle requires Q (peck depth)
- [ERROR] L1295: G83 peck cycle requires Q (peck depth)
- [ERROR] L1349: G83 peck cycle requires Q (peck depth)
