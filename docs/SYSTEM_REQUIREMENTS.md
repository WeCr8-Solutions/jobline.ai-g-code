# System Requirements

## JobLine G-Code for VS Code 0.3.12

A VS Code extension: it runs inside the editor on your own computer and needs no JobLine account, server, or licence key. Program contents are not sent to JobLine.

| Hardware Type | Requirement |
|---|---|
| Host application | Visual Studio Code **1.85 or newer** (desktop)<sup>*</sup> |
| Processor | 1.6 GHz or faster, 64-bit (VS Code recommendation)<sup>**</sup> |
| Memory | 1 GB for VS Code itself<sup>*</sup>\*. STEP import adds the OpenCascade WASM heap: 28.6 MB at start, grows on demand up to 2 GB<sup>†</sup> |
| Graphics | WebGL 2 with hardware acceleration enabled in VS Code (3D toolpath visualizer and tool preview use three.js r183)<sup>‡</sup> |
| Storage | VS Code: under 500 MB on disk<sup>*</sup>\*. Largest extension component: OpenCascade kernel `occt-import-js.wasm`, 7.6 MB |
| Network | None required. Optional links (Marketplace review, G-Code Academy) open only when selected. Since 0.3.14: CAM output-folder watching reads only the local or network folders you add (`jobline.cam.watchFolders`); nothing is uploaded |
| Ports / devices | None. Since 0.3.14 the CAM integrations are file-based: no connection to ESPRIT, Mastercam, Fusion or another CAM session, and no vendor SDK or CAM licence is needed |

| Operating System Requirements |
|---|
| Windows 10 / 11, 64-bit (supported Windows client versions)<sup>**</sup> |
| macOS versions that still receive Apple security updates (usually the latest and two previous)<sup>**</sup> |
| Linux: Ubuntu Desktop 20.04+, Debian 10+, RHEL 8+, Fedora 36+ (GLIBC 2.28+, GLIBCXX 3.4.25+)<sup>**</sup> |
| Not supported: VS Code for the Web (vscode.dev / github.dev). The extension ships only a desktop `main` entry, no `browser` entry |

### Licensing

| Item | Requirement |
|---|---|
| Licence | MIT licence. No licence server, activation, dongle or sign-in |
| Distribution | VS Code Marketplace (WeCr8-Solutions.jobline-gcode) or Install from VSIX |

### Developer Tools (building from source)

| Tool | Requirement |
|---|---|
| Node.js / npm | Node.js 22 (CI `quality.yml`); QA container uses `node:20-slim`; last local check on Node 24.14.0 |
| Build | TypeScript 5.3+, `npm run compile`; packaging with `@vscode/vsce` 2.22 |
| Tests | Mocha + `@vscode/test-electron` (downloads a VS Code build); Playwright 1.63 for visual e2e (downloads Chromium). Since 0.3.14: `test:tool-library`, `test:cam-integrations`, `test:control-rules`, `test:dialect-convert` (Node test runner, no downloads), included in `test:all` |
| Optional | Docker for `docker-compose.qa.yml`; Ollama on the host for the agent QA loop |

### Notes

- <sup>*</sup> `engines.vscode` in package.json requires 1.85.0 or newer. Newer VS Code releases may require a newer OS than 1.85 did.
- <sup>**</sup> VS Code's own hardware and platform requirements (code.visualstudio.com/docs/supporting/requirements, page dated 02/04/2026). JobLine has not published separate benchmark figures.
- <sup>†</sup> Measured from occt-import-js 0.0.23: initial linear memory 457 × 64 KB pages, `getHeapMax` 2 GB. A STEP model is tessellated to at most 300,000 triangles. Memory use on very large assemblies has not been benchmarked.
- <sup>‡</sup> three.js r163 and later render with WebGL 2 only. Remote/virtual desktops without GPU acceleration may draw slowly or show a blank viewport. Not tested.

> ⚠ **The visualizer and diagnostics are a program review aid. They are not machine collision certification.**

---

_JobLine G-Code for VS Code 0.3.12 · WeCr8-Solutions/jobline.ai-g-code main @ 255cd67 · October 15, 2026 · WeCr8 Solutions, LLC_  
_PDF rendering: `SYSTEM_REQUIREMENTS.pdf` in this folder._
