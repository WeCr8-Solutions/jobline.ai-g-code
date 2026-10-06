# JobLine development and release checks

Applies to the **0.3.12** working tree, updated **2026-10-06**. For installation and product features, see [README.md](README.md).

## Environment

- VS Code 1.85 or newer for the extension.
- Node.js and npm for development. Current local verification used Node **24.14.0**.
- A graphical desktop for VS Code/Electron smoke tests.
- Chrome/Edge or a Playwright Chromium installation for packaged rendering checks.

## Install and build

From the repository root:

```sh
npm ci
npm run compile
```

Compile runs ESLint first, then TypeScript. Output is under `out/`. Dependencies include the Fusion Zstandard decoder and STEP OpenCascade runtime; neither requires a separate user installation.

Open the repository in VS Code, select **Run Extension** in Run and Debug, and press **F5**. In the Extension Development Host, open a file from `samples/` or `test/fixtures/`.

## Verification

| Command | Coverage |
| --- | --- |
| `npm test` | Core parser, formatter, tool, workholding, and turning tests |
| `npm run test:feedback-matrix` | 75 motion regressions across units, planes, and coordinate modes |
| `npm run test:all` | Core plus diagnostics, review, STEP/geometry, simulation, pipeline, UI, and hover suites |
| `npm run test:typecheck` | TypeScript without emitting files |
| `npm run test:smoke` | Rendered VS Code extension tests |
| `npm run test:e2e:visual` | Separate visual end-to-end runner |
| `npm run test:ci` | Compile, full unit/regression suite, and fixture review |
| `npm run check:package` | Extracted VSIX STEP runtime and browser-rendered visualizer |

Run `npm run compile` before `npm run test:smoke`; the smoke runner does not compile automatically. It downloads/caches VS Code **1.96.4** by default, overridable with `JOBLINE_VSCODE_TEST_VERSION`. This is the tested host version, not a claim that every supported VS Code version was exercised.

The packaged check detects installed Chrome/Edge on Windows. If unavailable, install the test browser with `npx playwright install chromium`, or set `PLAYWRIGHT_EXECUTABLE_PATH`.

See [the feedback matrix](docs/testing/USER_FEEDBACK_MATRIX.md) for dated results and unresolved scenarios. A passing parser test does not establish smooth playback or correct rendered cutting state.

## Build and check a VSIX

```sh
npm run compile
npm run test:all
npm run test:smoke
npm run package
npm run check:package
```

The package command runs compilation again through the VS Code prepublish hook and writes `jobline-gcode-<version>.vsix`. The package checker selects the version in `package.json` by default. Rendering screenshots are saved in `reports/`.

The VSIX must include:

- `fzstd` for compressed Fusion archives.
- `occt-import-js` JavaScript, WebAssembly, package metadata, and license notices for STEP imports.

The package checker loads STEP geometry from the extracted extension to catch missing runtime files. Tests resolving dependencies from the development checkout do not establish package completeness.

Install locally using **Extensions: Install from VSIX...**. Packaging does not publish to the Marketplace or create a Git tag. For a future patch release, `npm version patch --no-git-tag-version` updates the manifest and lockfile; update the changelog and repeat the release checks.

## Troubleshooting

- **Tests use stale behavior:** compile again before extension-host tests.
- **STEP fails only after installation:** inspect the VSIX runtime files and run `npm run check:package`.
- **Unexpected diagnostics:** check the selected control/machine profile and provide a minimal controller-specific fixture.
- **Validate Program shows a phase message:** that command remains a placeholder; use live diagnostics and repository test/review tooling.
- **A visual issue passes unit tests:** reproduce it in the rendered smoke/visual suite and retain an assertion for the actual rendered behavior.
