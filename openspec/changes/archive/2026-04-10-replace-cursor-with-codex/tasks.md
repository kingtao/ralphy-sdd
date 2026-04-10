# Tasks: replace-cursor-with-codex

- [ ] 1. Create `src/core/backends/codex.ts` — Codex backend adapter
- [ ] 2. Update `src/types.ts` — ToolId: cursor → codex
- [ ] 3. Update `src/cli/run.ts` — Import/case: cursor → codex
- [ ] 4. Update `src/cli/init.ts`, `validate.ts`, `update.ts` — cursor → codex
- [ ] 5. Update `src/utils/detector.ts` — Detect codex
- [ ] 6. Update `src/utils/installer.ts` — Remove cursor templates, update default
- [ ] 7. Update `src/utils/validator.ts` — cursor → codex
- [ ] 8. Update `src/core/spec/schemas.ts` — Default backend: opencode
- [ ] 9. Delete `src/core/backends/cursor.ts`
- [ ] 10. Delete `src/templates/cursor/` (if exists)
- [ ] 11. Update docs (README etc.) — cursor → codex references
- [ ] 12. Verify: typecheck + test + validate
