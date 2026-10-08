# The JobLine platform: three repositories, one product

This file is identical in all three repositories (the G-Code extension's
`test/machine-presets.test.ts` fails when the copies differ). Read it before
changing anything listed under **Shared contracts**: a change there is not
finished until the other repositories have it too.

| Repository | What it is | Agent guide |
| --- | --- | --- |
| [`shift-handover-hub`](https://github.com/WeCr8-Solutions/shift-handover-hub) | JobLine.ai shop app (React + Supabase): shift handoffs, work orders, stations and machines, setup sheets, the public `/tools` calculators and reference charts, the SEO site | `CLAUDE.md`, `AGENTS.md` |
| [`jobline.ai-g-code`](https://github.com/WeCr8-Solutions/jobline.ai-g-code) | JobLine G-Code VS Code extension: parsing, diagnostics, program review, 3D visualizer, machine presets | `CLAUDE.md`, `AGENTS.md` |
| [`jobline.ai-CAM`](https://github.com/WeCr8-Solutions/jobline.ai-CAM) | JobLine CAM (Electron + React + Three.js): toolpaths, posts, the Haas VF-2 / Lang test bench | `CLAUDE.md`, `AGENTS.md` |

How the products meet a machinist: the shop app knows the machines, jobs and
handoffs; CAM programs a job for a machine; the extension checks and
visualizes the program against the same machine; the handoff records which
program ran.

## Shared contracts

| Contract | Source of truth | Copies | Kept equal by |
| --- | --- | --- | --- |
| `.jblmachine` codec (machine setup file) | g-code `src/presets/jblMachine.ts` | CAM `src/core/persistence/jblMachine.ts`, hub `src/lib/jobline/jblMachine.ts` | g-code `test/machine-presets.test.ts` (byte-equal) |
| `.jblmachine` JSON Schema | g-code `schemas/jblmachine.schema.json` | CAM and hub `schemas/jblmachine.schema.json` | same test |
| Sample machines | g-code `samples/machines/*.jblmachine` | hub `src/lib/jobline/__fixtures__/` | same test |
| Shop reference (tap drills, threads, drill sizes, NPT, cutting speeds) | hub `src/lib/reference/shopReference.ts` → `public/reference/jobline-shop-reference.json` (published at `https://jobline.ai/reference/jobline-shop-reference.json`) | g-code `data/reference/`, CAM `src/core/reference/` | hub `shopReference.test.ts` (file is current), g-code test (copies equal) |
| CAM test bench outputs (Haas VF-2 + Lang Makro-Grip program, setup, summary) | CAM `samples/testbench/` | g-code `test/fixtures/cam-bench/` | g-code test |
| Agent loop harness | `tools/agent-loop/` (any repo; copy to the others) | all three | g-code test |
| This file | `PLATFORM.md` | all three | g-code test |

The sync test only compares when the repositories are checked out side by side
(`../jobline.ai-CAM`, `../shift-handover-hub`); otherwise those cases skip.

## When a change needs work in another repository

| You change… | Also do… |
| --- | --- |
| a field or meaning in `.jblmachine` | copy the codec and schema to the other two; bump `JBL_MACHINE_FORMAT_VERSION` if a field changes meaning; hub: `stationMachinePreset.ts` mapping; CAM: preset import/export |
| hub machine profile columns (`station_manual_machine_profiles`) | hub `stationMachinePreset.ts` and its tests |
| thread, tap drill, drill or cutting data in the hub | regenerate with `UPDATE_REFERENCE=1 npx vitest run src/lib/reference`, copy the JSON to g-code and CAM; extension tap drill review uses it |
| CAM post or test bench program | refresh CAM goldens (`UPDATE_GOLDEN=1`), copy `samples/testbench/haas-vf2-lang-makrogrip.*` to g-code `test/fixtures/cam-bench/`, run g-code `npm test` |
| extension parsing of tools, stock or cycles | run g-code `test/cam-bench.test.ts` against CAM's program |
| setup sheet types or handoff `linked_files` (hub) | keep `src/lib/shopFiles.ts` kinds in step with what CAM and the extension write (`.nc`, `.jblmachine`, CAD) |
| `tools/agent-loop/` | copy to the other two repositories and run `npm run test:agent-loop` in each |

When a task in one repository needs a change in another, finish your own part
and file a task in the other repository's `agent-tasks/` (or note it in your
PR) naming the contract above. Never leave the copies different.

## Product documents (PRDs)

- Hub: [`docs/prd/`](https://github.com/WeCr8-Solutions/shift-handover-hub/tree/main/docs/prd) (production, ITAR, manufacturing platform, local LLM repair workflow) and `.lovable/prd/` (feature PRDs: handoffs `05`, operator tools `17`, machine profiles `19`, developer tooling `09`); cross-repo work is tracked in `docs/prd/11-jobline-platform-integration-prd.md`.
- CAM: `docs/07_phased_build_plan.md`, `docs/02_master_requirements_checklist.md`, `docs/TESTBENCH.md`, `docs/MACHINE_PRESETS.md`.
- Extension: `docs/Improvement_Plans.md`, `docs/JOBLINE_INTEGRATION_REVIEW.md`, `docs/JobLine_Next_Steps_DNC.md`.

Update the PRD that owns a feature when you change its behavior, and the
platform integration PRD when the change crosses repositories.

## Agents and the loop

Every repository has the same agent loop (`tools/agent-loop/`, see its
`README.md` and `OVERNIGHT.md`) with its own `agent-loop.config.json`. Each
config sends this file with every prompt (`context.alwaysInclude`), so local
models (LM Studio, Ollama) and Claude see the shared contracts. Each repository
keeps its own task queue, claims and heartbeats; one computer can work all
three. Agents never edit another repository from a worktree: they file a
follow-up task there.
