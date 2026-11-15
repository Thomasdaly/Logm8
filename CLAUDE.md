# Project instructions for Claude Code

- The source of truth is `docs/SPEC.md`. Read it before any work.
- This is safety- and compliance-critical software. Never invent a fatigue limit or counting rule: verify it against official NHVR / legislation sources and record it in `docs/RULES_SOURCES.md`.
- Record every judgement call or deviation from the spec in `docs/DECISIONS.md` (date, decision, reason).
- `packages/rules-engine` stays pure: no runtime dependencies, no I/O, no clock reads.
- The event store is append-only. Never write code that updates or deletes a recorded event.
- Never weaken a test's expected outcome to make it pass without an official source, recorded in DECISIONS.md.
- Before finishing any turn that claims progress, run and show `pnpm test`, `pnpm typecheck` and `pnpm lint`.
- Package manager: pnpm. Language: TypeScript strict. Tests: Vitest (packages), Jest + RNTL (mobile).
