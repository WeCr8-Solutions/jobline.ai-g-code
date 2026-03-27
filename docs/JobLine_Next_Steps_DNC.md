# JobLine — Next Steps: From Phase 1 to Live Machine Connectivity

**Current State:** Phase 1 COMPLETE — 56/56 tests, tokenizer, block parser, program model, modal state, macro evaluator, hover provider, syntax highlighting, 5 dialects  
**What's Next:** Phase 2 (trees + diagnostics) → Phase 3 (cycle validation) → Phase 4 (dialects) → Phase 5-6 (DNC/FTP/machine connectivity + live monitoring)

---

## Phase 2 — Program Model & Tree Views (Weeks 4-7)

This phase makes the parser output visible in VS Code's sidebar. The program model already works (verified on 5 fixture files), so the work is wiring it to VS Code TreeDataProviders.

### Week 4: Document Symbols + Folding

**What to build:**
- `src/providers/symbolProvider.ts` — Implements `DocumentSymbolProvider`. Walks the program model and emits symbols for each operation (tool change block), subprogram call, and canned cycle. This gives you the **Outline view** in VS Code's sidebar and **breadcrumbs** in the editor.
- `src/providers/foldingProvider.ts` — Folds operations (from one T/M06 to the next), comment-delimited sections, and subprogram blocks (M98 to M99).

**Test:** Open `sample.nc` → Outline panel shows "Op 1: CENTER DRILL", "Op 2: 0.250 DRILL", "Op 3: CHAMFER MILL". Click any to jump to that line.

### Week 5: Operations Tree

**What to build:**
- `src/views/operationsTree.ts` — `TreeDataProvider` that groups blocks by tool change boundaries. Each operation node expands to show: tool number, work offset, spindle speed, feed range, canned cycles used.
- Register the tree in `package.json` under `contributes.views` in a new "JOBLINE" view container (sidebar icon).

**Test:** Sidebar shows the JobLine icon. Under "Operations", expanding an op shows T1, G54, S3500, F15.0, G83 (6 holes).

### Week 6: Tools Tree + Offsets Tree

**What to build:**
- `src/views/toolsTree.ts` — Lists every unique tool with description (from nearby comments), H/D offsets, max speed, feed range, line numbers.
- `src/views/offsetsTree.ts` — Two sections: Work Offsets (G54-G59) showing where each is called, and Tool Offsets (H/D) showing where they're activated.

### Week 7: Diagnostics Provider (Safety Warnings)

**What to build:**
- `src/providers/diagnosticProvider.ts` — Wired to the program model. On every document change (debounced 150ms), re-parse and check for basic safety issues:
  - Missing G80 after canned cycle before next motion
  - No F active when feed move is commanded
  - Spindle not on before cutting move
  - G43 without matching H offset
- Squiggly underlines appear in the editor (red for errors, yellow for warnings).

**Test:** Open `test/fixtures/crash-scenarios/multiple-violations.nc` → see red/yellow squiggles on the bad lines.

---

## Phase 3 — Canned Cycles Validation Engine (Weeks 8-10)

### What to build:
- `src/canned-cycles/types.ts` — CycleDefinition, CycleParam, CycleCondition interfaces
- `src/canned-cycles/conditionsEngine.ts` — Evaluates conditions against resolved params + modal state
- `src/canned-cycles/definitions/drilling.ts` — G73, G81, G82, G83 with conditions (missing Q, Q negative, Z above R, no feed, peck too large)
- `src/canned-cycles/definitions/tapping.ts` — G84, G74 with F=S×pitch check, spindle direction check
- `src/canned-cycles/definitions/boring.ts` — G85-G89 with orient spindle checks
- `src/views/cannedCyclesTree.ts` — Each cycle instance with pass/fail icons, clicking jumps to line

---

## Phase 4 — Multi-Dialect Support (Weeks 11-13)

### What to build:
- `src/dialects/base.ts` — Abstract `GCodeDialect` class
- `src/dialects/fanuc.ts`, `haas.ts`, `siemens.ts`, `mazak.ts`, `okuma.ts`
- `src/dialects/dialectRegistry.ts` — Loads correct dialect from settings
- Each dialect defines: comment patterns, cycle names, parameter mappings, M-code descriptions, default transport type, file naming conventions
- Siemens CYCLE83/84/85 positional parameter mapping to named params

---

## Phase 5 — DNC Core: FTP & Machine File Management (Weeks 14-17)

**This is where the machine connectivity starts.** The goal is to connect to any CNC on your shop network, browse its programs, upload/download, and compare versions.

### Week 14: Machine Profile & Registry

**What to build:**
- `src/machine-connect/types.ts`:

```typescript
interface MachineProfile {
  id: string;                    // UUID
  name: string;                  // "Haas VF-2SS - Cell 1"
  controlType: ControlType;      // fanuc | haas | siemens | mazak | okuma
  machineType: MachineType;      // mill | lathe | mill-turn | wire-edm
  transport: TransportConfig;
  autoConnect: boolean;
  healthCheckInterval: number;   // seconds, 0 = disabled
  remoteProgramDir: string;      // default dir on the CNC
  localMirrorDir?: string;       // optional local sync folder
  fileNamingConvention: NamingRule;
}

type TransportConfig =
  | { type: "ftp";    host: string; port: number; 
      username: string; password: string;
      useTLS: boolean; passive: boolean; }
  | { type: "serial"; port: string; baudRate: number; 
      dataBits: 7 | 8; stopBits: 1 | 2;
      parity: "none" | "even" | "odd";
      flowControl: "xon/xoff" | "rts/cts" | "none"; }
  | { type: "cifs";   uncPath: string; 
      username?: string; password?: string; }
  | { type: "focas";  host: string; port: number; 
      timeout: number; }
  | { type: "mtconnect"; agentUrl: string; 
      deviceId: string; }
```

- `src/machine-connect/machineRegistry.ts` — CRUD for machine profiles. Passwords go in VS Code's `SecretStorage` (OS keychain), everything else in workspace settings JSON.

**How the user adds a machine:**
1. Command palette → "JobLine: Add Machine"
2. Webview wizard asks: Name, Control Type, IP/hostname, Transport type
3. Based on control type, pre-fills defaults:
   - **Fanuc**: FTP, port 21, anonymous, passive mode, programs in `/`
   - **Haas**: FTP, port 21, or CIFS `\\10.0.1.51\DNC`, Net Share enabled
   - **Siemens**: CIFS, `\\10.0.1.53\Sinumerik\Programs`, `.MPF/.SPF` files
   - **Mazak**: FTP, port 21, or CIFS share
   - **Okuma**: FTP, port 21, THINC API option

### Week 15: FTP Transport & Connection Manager

**What to build:**
- `src/machine-connect/transports/base.ts`:

```typescript
interface IMachineTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  healthCheck(): Promise<HealthStatus>;
  
  listFiles(remotePath: string): Promise<RemoteFile[]>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  deleteFile(remotePath: string): Promise<void>;
  
  onStatusChange: vscode.Event<ConnectionStatus>;
  onTransferProgress: vscode.Event<TransferProgress>;
}
```

- `src/machine-connect/transports/ftp.ts` — Uses `basic-ftp` npm package. Handles:
  - Active and passive mode (passive required for NAT'd shop networks)
  - TLS/FTPS when the control supports it
  - Connection pooling (reuse the FTP connection, don't reconnect per operation)
  - Timeout and retry on network glitches

- `src/machine-connect/connectionManager.ts`:
  - Manages all active connections in a `Map<machineId, transport>`
  - Auto-connect on extension activation for machines with `autoConnect: true`
  - Reconnect with exponential backoff: 2s → 4s → 8s → 16s → max 60s
  - Health check polling on configurable interval

**Per-control FTP setup on the machine side:**

**Fanuc 30i/31i:**
- Go to SYSTEM → PARAM → write parameter 20 = 1 on the Ethernet board
- The control starts an FTP server on port 21
- Default: anonymous login, programs in root `/` or `/PROG/`
- File names follow O-number convention: `O0001` or `O0001.NC`
- Some firmware versions require passive mode — JobLine defaults to passive

**Haas NGC:**
- Setting 143 (Net Share) must be ON
- Go to Settings → Networking → set the machine's IP, subnet, gateway
- FTP server activates on port 21
- Programs in root directory
- Alternative: Enable CIFS sharing and use `\\<machine-ip>\DNC` UNC path

**Siemens 840D/828D:**
- FTP is not the primary method — Siemens uses CIFS/Put-Get
- Programs stored as `.MPF` (main) and `.SPF` (sub) files
- Access via `\\<machine-ip>\Sinumerik\FileSystem\Part Program\`
- Or use the HMI → Setup → Network → enable Put/Get over PROFINET

**Mazak Smooth:**
- Go to SETUP → COMMUNICATION → enable Ethernet
- Set IP address, subnet mask, gateway
- FTP server on port 21 when network option is enabled
- Alternative: CIFS share mapping through Smooth Cam-RS

**Okuma OSP-P300/P200:**
- Network setup in MAINTENANCE → NETWORK SETTING
- FTP available through the THINC API option (requires license)
- Programs stored in the NC card or CF card directories
- FTP root maps to the active storage device

### Week 16: Machine Selector & Machine Files Trees

**What to build:**
- `src/views/machineSelectorTree.ts` — Fleet view:
```
▸ Haas VF-2SS (10.0.1.51)       🟢 Connected — Idle
▸ Fanuc Robodrill (10.0.1.52)   🟢 Connected — Running O01234
▸ Okuma LB3000 (10.0.1.50)      🟡 Connected — Alarm
▸ Siemens 840D (10.0.1.53)      🔴 Disconnected
```
  - Click a machine → sets it as active for the Machine Files tree
  - Gear icon → opens machine config editor
  - Right-click → Connect / Disconnect / Edit / Remove

- `src/views/machineFilesTree.ts` — Remote file browser:
```
📂 / (root)
  📄 O01234.NC    4.2 KB   2026-03-01
  📄 O05678.NC    12.1 KB  2026-02-28
  📄 O09100.NC    2.8 KB   2026-03-03
  📂 SUB/
    📄 O09001.NC  1.1 KB   2026-01-15
```
  - Context menu: Download to Editor, Upload Current File, Delete, Rename, Compare with Local
  - Double-click a file → downloads to temp dir → opens in editor with full G-code intelligence

### Week 17: Transfer Queue & Compare Engine

**What to build:**
- `src/machine-connect/transferQueue.ts`:
```typescript
interface TransferJob {
  id: string;
  machineId: string;
  direction: "upload" | "download";
  localPath: string;
  remotePath: string;
  status: "queued" | "active" | "complete" | "failed" | "cancelled";
  progress: number;        // 0-100
  bytesTransferred: number;
  totalBytes: number;
  error?: string;
  retryCount: number;
  maxRetries: number;      // default 3
}
```
  - One transfer per machine at a time, parallel across machines
  - Retry with backoff on failure (network glitch, busy control)

- `src/views/transferQueueTree.ts` — Shows:
```
↑ O01234.NC → Haas VF-2SS    [████████░░] 78%
↓ O05678.NC ← Fanuc Robodrill ✅ Complete (2.1s)
↑ O09100.NC → Okuma LB3000   ❌ Failed: Connection refused (retry 2/3)
```

- `src/machine-connect/compareEngine.ts`:
  - Before upload: Download machine version to temp, diff against local
  - Opens VS Code's built-in diff editor with G-code highlighting on both sides
  - Catches the #1 shop problem: someone edited at MDI and local copy is stale
  - Command: "JobLine: Compare with Machine"

**Upload safety gate (optional per machine):**
Before uploading, run the conditions engine on the file. If there are errors, block the upload and show:
```
⚠ Upload blocked: O01234.NC has 2 errors
  Line 15: G83 missing Q (peck depth)
  Line 28: No feed rate active for G01
Fix these before sending to the machine.
```
Configurable as "warn" (show but allow) or "block" (must fix first).

---

## Phase 6 — DNC Extended: Serial, CIFS, Live Monitoring (Weeks 18-22)

### Week 18-19: Serial Transport + Drip Feed

**What to build:**
- `src/machine-connect/transports/serial.ts` — Uses `serialport` npm package
- `src/machine-connect/dripFeed.ts` — Line-by-line streaming for memory-limited controls

**Serial defaults by control:**

| Control | Baud | Data | Parity | Stop | Flow |
|---------|------|------|--------|------|------|
| Fanuc (default) | 9600 | 7 | Even | 2 | XON/XOFF |
| Haas | 115200 | 8 | None | 1 | XON/XOFF |
| Okuma | 9600 | 7 | Even | 2 | XON/XOFF |
| Mazak | 9600 | 8 | None | 1 | XON/XOFF |

**Drip feed flow:**
1. User command: "JobLine: Start Drip Feed"
2. Extension sends `%` (start of tape)
3. Sends O-number header line
4. Waits for XON (DC1, 0x11) from machine
5. Streams lines in blocks, pauses on XOFF (DC3, 0x13)
6. Sends `%` (end of tape)
7. Status bar shows: `⏵ Drip Feed O01234 | Line 142/480 | 00:03:22`

**When to use drip feed:** Old Fanuc 18i/21i controls with 512KB-2MB program memory. Large programs (surfacing, 3D contouring) won't fit. Drip feed streams line-by-line so the program size is unlimited.

### Week 19-20: CIFS Transport

**What to build:**
- `src/machine-connect/transports/cifs.ts`
- Maps network shares for Haas Net Share, Siemens Put/Get, Mazak shares
- Uses OS-level mount commands or Node.js SMB client

### Week 20-22: Live Machine Monitoring

**This is the "watch live G-code" feature.** Two protocols provide it:

#### FOCAS2 (Fanuc machines only)

**What it gives you:**
- Currently running program number (`cnc_rdprgnum`)
- Current N-line being executed (`cnc_rdseqnum`)
- Machine mode: AUTO / MDI / EDIT / JOG / HANDLE / REF (`cnc_statinfo`)
- Execution state: RUNNING / STOPPED / PAUSED / FEED HOLD (`cnc_statinfo`)
- Active alarms with codes and messages (`cnc_rdalminfo`)
- Override percentages: feed, spindle, rapid (`cnc_rdopnl`)
- Actual spindle speed (`cnc_rdspeed`)
- Actual feed rate (`cnc_acts`)
- Current axis positions: X, Y, Z, A, B, C (`cnc_absolute`)
- Part count (`cnc_rdparam`)
- Macro variable values (`cnc_rdmacro`)

**Setup on Fanuc:**
- FOCAS2 uses TCP on port 8193 (default)
- Must have the Ethernet board with FOCAS option enabled
- The FOCAS2 SDK is a C library — wrapped via `ffi-napi` in Node.js or a compiled native addon

**What it looks like in VS Code:**

Status bar:
```
[Fanuc] ⚡ Robodrill | ▶ Running O01234 | N150 | Feed: 85% | S3500 RPM
```

Machine Selector tree expands to show:
```
▾ Fanuc Robodrill (10.0.1.52)     🟢 Running
    Program: O01234
    Sequence: N150
    Mode: AUTO
    Feed Override: 85%
    Spindle: 3500 RPM (actual)
    Feed Rate: 12.75 IPM (actual)
    Position: X1.500 Y2.000 Z-0.850
    Part Count: 47
```

**Live G-code cursor (the killer feature):**
When the machine is running a program that you have open in the editor, FOCAS2 reports the current N-line sequence number. The extension highlights that line in the editor with a green gutter icon and scrolls to keep it visible. You literally watch the program execute line by line.

```typescript
// In machineMonitor.ts
async function highlightActiveLine(status: MachineStatus) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  // Find the line with matching N-number
  const doc = editor.document;
  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i);
    const nMatch = line.text.match(/N(\d+)/);
    if (nMatch && parseInt(nMatch[1]) === status.currentSequence) {
      // Highlight this line
      editor.setDecorations(activeLineDecoration, [
        { range: line.range }
      ]);
      // Scroll to keep visible
      editor.revealRange(line.range, vscode.TextEditorRevealType.InCenter);
      break;
    }
  }
}
```

#### MTConnect (Haas, Mazak, any compliant machine)

**What it gives you:**
- Execution state: ACTIVE / INTERRUPTED / STOPPED / READY
- Controller mode: AUTOMATIC / MANUAL / MDI / EDIT
- Currently loaded program name
- Part count
- Actual spindle speed and feed rate
- Condition: FAULT / WARNING / NORMAL
- Override values (some agents)

**Setup on Haas:**
- MTConnect agent runs on port 5000 by default
- No setup needed — it's on by default on NGC controls with Ethernet
- Access via HTTP: `http://10.0.1.51:5000/current`
- Returns XML with all data items

**Setup on Mazak:**
- Smooth controls have MTConnect built in
- Enable in SETUP → COMMUNICATION → MTConnect
- Default port 5000
- Same HTTP/XML interface as Haas

**How JobLine polls MTConnect:**
```typescript
// In transports/mtconnect.ts
async pollStatus(agentUrl: string): Promise<MachineStatus> {
  const response = await axios.get(`${agentUrl}/current`);
  const xml = parseXml(response.data);
  
  return {
    executionState: xml.find('//Execution').text,   // "ACTIVE"
    mode: xml.find('//ControllerMode').text,         // "AUTOMATIC"
    currentProgram: xml.find('//Program').text,       // "O01234"
    partCount: parseInt(xml.find('//PartCount').text),
    actualSpindleSpeed: parseFloat(xml.find('//SpindleSpeed').text),
    actualFeedRate: parseFloat(xml.find('//PathFeedrate').text),
    condition: xml.find('//Condition/*').name,        // "Normal" or "Fault"
  };
}
```

**Polling interval:** Default 1 second for MTConnect, 500ms for FOCAS2. Configurable per machine.

#### What DOESN'T give live monitoring:

- **FTP:** File transfer only. No status, no running program, no position. Use FTP to get programs on/off the machine, use FOCAS2 or MTConnect to watch what it's doing.
- **Serial RS-232:** File transfer + drip feed. No monitoring capability.
- **CIFS:** File transfer only. Same as FTP — move files, can't watch status.

### Summary: Transport vs. Monitoring Matrix

| Transport | File Transfer | Live Status | Running Program | Position | Alarms |
|-----------|:---:|:---:|:---:|:---:|:---:|
| **FTP** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Serial** | ✅ + drip feed | ❌ | ❌ | ❌ | ❌ |
| **CIFS** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **FOCAS2** | ✅ | ✅ | ✅ + N-line | ✅ | ✅ |
| **MTConnect** | ❌ | ✅ | ✅ (name only) | ⚠️ (some) | ✅ |

**Best combo per control:**
- **Fanuc:** FTP (file transfer) + FOCAS2 (monitoring + live cursor)
- **Haas:** FTP (file transfer) + MTConnect (monitoring)
- **Siemens:** CIFS (file transfer) + OPC UA (monitoring, future)
- **Mazak:** FTP (file transfer) + MTConnect (monitoring)
- **Okuma:** FTP/THINC (file transfer) + THINC API (monitoring, future)

---

## Phase 7 — Advanced Features & Polish (Weeks 23-26)

- Lathe canned cycles (G70-G76 two-line format)
- Probe cycle detection (G65 P9xxx, CYCLE977/978)
- Siemens CYCLE signature help (parameter hints as you type)
- Rich hover tooltips with cycle motion diagrams (SVG)
- CodeLens on tool change lines showing tool info inline
- Go-to-definition for M98/CALL subprogram references
- Estimated cycle time per operation (feed distance ÷ feed rate + rapid time)
- Full test suite with per-dialect fixture files
- VS Code Marketplace packaging (.vsix) and publish

---

## What You Need on the Network Side

Before Phase 5 starts, make sure your shop network is ready:

1. **Every CNC needs a static IP** on the shop floor network (e.g., 10.0.1.50-10.0.1.99)
2. **Your PC running VS Code needs to be on the same subnet** or have a route to the shop VLAN
3. **FTP enabled on each machine** (see per-control setup above)
4. **For live monitoring:** FOCAS2 option on Fanuc, MTConnect on by default for Haas/Mazak
5. **Firewall:** Allow ports 21 (FTP), 5000 (MTConnect), 8193 (FOCAS2) between your PC and the machines
6. **For serial:** USB-to-RS232 adapter on your PC, serial cable to each legacy machine

---

## Quick Reference: Machine Setup Checklist

### Adding a Fanuc 30i/31i
- [ ] Set IP address: SYSTEM → PARAM → Ethernet settings
- [ ] Enable FTP: Parameter 20 = 1 on Ethernet board
- [ ] Test: `ftp 10.0.1.52` from your PC → should connect
- [ ] Optional: FOCAS2 port 8193 for live monitoring
- [ ] In JobLine: Add Machine → Fanuc → FTP → host: 10.0.1.52, passive: true

### Adding a Haas NGC
- [ ] Set IP: Settings → Networking → IP, Subnet, Gateway
- [ ] Enable Net Share: Setting 143 = ON
- [ ] Test: `ftp 10.0.1.51` from your PC
- [ ] MTConnect auto-available: `http://10.0.1.51:5000/current`
- [ ] In JobLine: Add Machine → Haas → FTP → host: 10.0.1.51 + MTConnect agent URL

### Adding a Siemens 840D
- [ ] Set IP: HMI → Setup → Network
- [ ] Enable Put/Get or CIFS share
- [ ] Test: `\\10.0.1.53\Sinumerik\FileSystem\` from Windows Explorer
- [ ] In JobLine: Add Machine → Siemens → CIFS → uncPath: \\10.0.1.53\Sinumerik\Programs

### Adding a Mazak Smooth
- [ ] Set IP: SETUP → COMMUNICATION → Ethernet
- [ ] Enable FTP in communication settings
- [ ] Test: `ftp 10.0.1.54` from your PC
- [ ] MTConnect: `http://10.0.1.54:5000/current`
- [ ] In JobLine: Add Machine → Mazak → FTP → host: 10.0.1.54 + MTConnect agent URL

### Adding an Okuma OSP-P300
- [ ] Set IP: MAINTENANCE → NETWORK SETTING
- [ ] Enable FTP through THINC option
- [ ] Test: `ftp 10.0.1.50` from your PC
- [ ] In JobLine: Add Machine → Okuma → FTP → host: 10.0.1.50

### Adding a Legacy Machine (Serial Only)
- [ ] Connect USB-to-RS232 adapter → serial cable → machine's RS-232 port
- [ ] Check machine's I/O parameters for baud rate, data bits, parity, stop bits
- [ ] Test: Use PuTTY or CoolTerm to verify serial connection at correct settings
- [ ] In JobLine: Add Machine → [control] → Serial → port: COM3 (or /dev/ttyUSB0)
- [ ] For drip feed: Set machine to TAPE/EXT mode before starting feed

---

## Build Order Summary

| Phase | Weeks | Focus | Key Deliverable |
|-------|-------|-------|-----------------|
| 2 | 4-7 | Trees + Diagnostics | Sidebar panels, squiggly warnings |
| 3 | 8-10 | Cycle Validation | G83/G84/G85-89 conditions engine |
| 4 | 11-13 | Multi-Dialect | Fanuc/Haas/Siemens/Mazak/Okuma rules |
| 5 | 14-17 | **FTP + File Mgmt** | **Connect to machines, browse/upload/download** |
| 6 | 18-22 | **Serial + Monitoring** | **Drip feed, FOCAS2, MTConnect, live cursor** |
| 7 | 23-26 | Polish & Ship | Lathe cycles, probing, marketplace publish |

**Total: 26 weeks from Phase 1 complete to marketplace-ready.**

The DNC system (Phases 5-6) is what turns JobLine from "a nice G-code editor" into "the thing that replaces Predator/CIMCO/Refresh Your Memory." File transfer is table stakes — live monitoring with the in-editor cursor following the running program is what no VS Code extension does today.
