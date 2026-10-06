# External CAD fixture sources for local visualizer testing

Use this note when sourcing real target, vise, jaw, holder, and tooling models for JobLine.ai G-code visual tests.

## Safe default

- Keep downloaded vendor/customer CAD in `test/fixtures/external-local/`.
- That directory is gitignored on purpose.
- Do not bundle external CAD in the VSIX unless the license is explicitly reviewed for redistribution.
- Prefer committed synthetic fixtures under `test/fixtures/scene/` for automated CI so screenshots remain deterministic and publishable.

## Useful sources

- Titans of CNC Academy has excellent training parts and workholding downloads, but its Academy pages state restrictive non-commercial/no-derivatives terms. Use only for local review unless we obtain clearer permission.
- MachiningCloud is a strong source for tooling/vendor CAD catalogs and is useful for local realism checks, but model access and redistribution are controlled by the catalog providers.
- 5th Axis, Kurt Workholding, LANG Technik, Tombstone City, TraceParts, 3Dfindit, McMaster, and similar suppliers are useful for real vise/jaw/toolholding geometry. Treat their downloads as local-only until license terms are reviewed.
- NIST public CAD/STEP test cases are good candidates for neutral geometry parser tests, but they are not machining-workholding scenes by themselves.

## Local testing pattern

1. Download/export the model manually from the source site.
2. Put it in `test/fixtures/external-local/<source>/<part-name>.<stl|stp|step|x_t>`.
3. Add or temporarily edit a visual E2E case to point at that local path.
4. Capture targeted screenshots for:
   - `visualizer`
   - `target-panel`
   - `view-cube`
5. Do not commit the downloaded model unless redistribution is explicitly permitted.
