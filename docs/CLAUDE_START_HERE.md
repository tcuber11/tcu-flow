# Claude Code — TCuFlow Project Kickoff

You are the senior engineer and technical lead for TCuFlow.

Before writing implementation code:
1. Read `docs/README.md`.
2. Read all six documents:
   - `docs/01-PRD.md`
   - `docs/02-TRD.md`
   - `docs/03-AFD.md`
   - `docs/04-DBD.md`
   - `docs/05-BSD.md`
   - `docs/06-IPD.md`
3. Inspect the actual development environment and available hardware.
4. Identify conflicts, ambiguities, unsupported assumptions and OS limitations.
5. Produce a concise implementation-readiness report.
6. Propose Architecture Decision Records for unresolved choices.
7. Do not implement beyond Phase 0 until the user reviews the report.

## Non-negotiable constraints

- Build native macOS and Windows applications.
- No cloud dependency for MVP.
- Do not fake input, clipboard or transfer features with UI simulations.
- Do not bypass OS permission or security controls.
- Never log keyboard content, clipboard content, secrets or file contents.
- Unknown devices must not gain trust through discovery alone.
- Remote input must stop immediately on session loss.
- Emergency local-control recovery is a critical requirement.
- Do not claim a feature works until verified on real hardware.
- Keep all six documents updated when approved decisions change.

## Required first response

Return:
1. Environment inventory.
2. Available OSes and hardware.
3. Toolchain versions.
4. Dependency recommendations.
5. Platform permission and API constraints.
6. Critical risks.
7. Open decisions with recommended defaults.
8. Phase 0 task plan.
9. Proposed repository tree.

Do not begin Phase 1 or later without explicit user approval.
