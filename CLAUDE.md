# CLAUDE.md

Guidance for Claude Code (and other agents; `AGENTS.md` points here) in this repository.

## What this is

JobLine G-Code: the VS Code extension that parses, checks, reviews and visualizes CNC programs (Fanuc, Haas, Siemens, Okuma, Mazak, Heidenhain, robots). It is one of three JobLine repositories; **read `PLATFORM.md` first** — it lists the files shared with jobline.ai-CAM and the JobLine.ai shop app (shift-handover-hub) and what a change to them requires in the other repositories.

## Commands

```sh
npm run compile          # lint + tsc to out/
npm test                 # unit tests (node:test via ts-node); includes the cross-repo sync test
npm run test:all         # every non-VS-Code suite
npm run test:e2e:visual  # visualizer screenshots in a real VS Code (CI: Quality / vscode-visual-matrix)
npm run lint             # eslint src
npm run test:agent-loop  # agent loop harness tests
npm run agent:gate       # repo checks through the agent loop; failures become agent-tasks/
```

New test files must be added to the `test` script in `package.json`. CI (`.github/workflows/quality.yml`) runs on Windows with Node 22.

## Layout

- `src/parser/` tokenizer, block parser, program model (tools, stock, cycles from comments)
- `src/diagnostics/` safety and syntax rules; `src/providers/visualizer/` 3D view, fixture harness, program review
- `src/presets/` machine presets; `jblMachine.ts` is the **shared** `.jblmachine` codec — change it here, then copy to CAM and the hub
- `src/reference/` + `data/reference/` the **shared** shop reference (tap drills, threads, drills, NPT, speeds), generated in the hub — never edit the JSON here
- `test/fixtures/cam-bench/` CAM's test bench outputs (copied from CAM `samples/testbench/`)
- `tools/agent-loop/` the shared agent loop (copy changes to the other repositories)

## Conventions

- TypeScript strict. Match the surrounding code's naming and comment style.
- Never weaken a safety diagnostic to make a test pass.
- `test/fixtures/revpack/` and `test/fixtures/external-local/` are private shop programs: never publish or quote them.
- When work touches a shared contract, finish this side and file a task in the other repository (see `PLATFORM.md`).
