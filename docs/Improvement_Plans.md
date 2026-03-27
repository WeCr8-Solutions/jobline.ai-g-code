# JobLine Improvement Plans

## Plan A: Incremental Improvements (Small Changes, Fast Wins)

Objective: deliver low-risk quality and usability improvements in short cycles while preserving current behavior.

### Sprint 1 (1-2 weeks): Reliability and Clarity

- Add an ESLint config so `npm run compile` is stable for all contributors.
- Add smoke tests for sidebar parsing on active editor changes.
- Improve empty/error states in trees (no file open, unsupported file, parse failure).
- Add one command: `JobLine: Refresh Sidebar Model`.
- Document known constraints and troubleshooting in README.

Success criteria:

- Build and test commands are deterministic on clean checkout.
- Sidebar refresh behavior is predictable and test-covered.

### Sprint 2 (1-2 weeks): Better Cycle and Tool Insight

- Expand canned-cycle display details by machine profile (mill, lathe, mill-turn, grinder).
- Add cycle counts grouped by code (for example G81 x12, G83 x6).
- Show operation summaries with tool, work offset, feed range, spindle speed.
- Add quick navigation links from tree items to source lines.

Success criteria:

- Common production files are understandable from sidebar alone.
- G81/G83 and repeat lines are clearly represented.

### Sprint 3 (1-2 weeks): Safety Diagnostics MVP

- Implement baseline diagnostics provider.
- Diagnostic rule: Missing `G80` before non-cycle motion.
- Diagnostic rule: Feed missing for feed moves.
- Diagnostic rule: Spindle state mismatch before cutting moves.
- Diagnostic rule: Missing/invalid cycle parameters where required.
- Mirror diagnostics in Alarms tree with severity badges.

Success criteria:

- Fixture-based crash scenarios produce clear editor diagnostics.
- Diagnostics reduce common setup/runtime mistakes.

### Sprint 4 (1-2 weeks): User Workflow Polish

- Add document symbols/folding for operations and subprogram regions.
- Add commands for switching control/machine profile quickly.
- Add optional status bar summary (active tool, active offset, active cycle).
- Collect user feedback from pilot users and log top 10 friction points.

Success criteria:

- Faster daily workflow for programmers and setup operators.
- Documented feedback backlog prioritized by impact.

## Plan B: Strategic Growth (Large Goals + JobLine Dashboard Monitoring)

Objective: evolve JobLine from editor intelligence into operational visibility across stations and work centers.

## Target Outcome

JobLine becomes a connected CNC intelligence platform that links G-code readiness, machine transfer activity, and shop-floor station/work-center health in one dashboard.

### Phase 1: Connected Machine Data Foundation (4-8 weeks)

- Define canonical entities.
- Entity: Station (cell or machine location).
- Entity: Work center (grouping by process/cell).
- Entity: Machine profile (control, transport, capabilities).
- Entity: Program revision (local, remote, approved).
- Entity: Transfer event (upload/download/compare).
- Build transport abstraction and initial connectors (FTP/CIFS first).
- Implement secure credential handling and connection health monitoring.
- Capture machine and transfer telemetry events in a normalized schema.

Success criteria:

- Operators can see machine connectivity and transfer history per station.
- Program revisions are traceable from local to machine destination.

### Phase 2: JobLine Dashboard Service (6-10 weeks)

- Build a dashboard backend (API + event ingestion + storage).
- Create station/work-center dashboards.
- Dashboard metric: Machine online/offline status.
- Dashboard metric: Current loaded/running program.
- Dashboard metric: Last transfer result and timestamp.
- Dashboard metric: Alarm/diagnostic summaries.
- Dashboard metric: Program validation health score.
- Add filtering by control type, line, shift, and work center.
- Add role-aware views for programmer, setup tech, supervisor.

Success criteria:

- Supervisors have real-time visibility across work centers.
- Teams can detect and respond to machine/program issues faster.

### Phase 3: Closed-Loop Validation and Release Gates (6-10 weeks)

- Add release gates before upload.
- Gate: Parser/model pass.
- Gate: Diagnostics threshold pass.
- Gate: Optional approval workflow for high-risk jobs.
- Add compare-before-upload and drift detection against machine copy.
- Add station-level policy controls (block/warn/allow by condition).
- Add alerting integrations (email/Teams/webhooks).

Success criteria:

- Reduced bad uploads and preventable machine stoppages.
- Clear audit trail from program edit to machine execution.

### Phase 4: Operational Intelligence and Optimization (ongoing)

- Add trend analytics by station/work center.
- Trend: Frequent alarm patterns.
- Trend: Cycle-type risk hotspots.
- Trend: Program transfer failure rates.
- Trend: Validation failure categories.
- Integrate with job scheduling/MES or ERP where available.
- Add workload and readiness views for upcoming jobs.

Success criteria:

- Data-driven process improvement across cells.
- Measurable reduction in downtime and setup risk.

## Architecture Direction for Dashboard Tie-In

- VS Code extension remains the authoring and local validation client.
- A JobLine backend stores machine telemetry, transfer logs, and validation outcomes.
- Stations/work centers are first-class objects for aggregation and reporting.
- Event schema is versioned to keep extension and dashboard evolution safe.

## KPI Framework (For Both Plans)

- Validation quality: false-positive and false-negative rates.
- Validation quality: mean time to fix diagnostics.
- Operational safety: blocked high-risk uploads (count and trend).
- Operational safety: incident rate linked to program issues.
- Productivity: time from program ready to machine loaded.
- Productivity: transfer success rate by control type.
- Monitoring: station uptime visibility coverage.
- Monitoring: work-center issue detection time.

## Recommended Execution Model

- Run Plan A continuously as quality hardening.
- Start Plan B Phase 1 in parallel once diagnostics MVP is stable.
- Gate dashboard rollout to pilot stations first, then scale by work center.
