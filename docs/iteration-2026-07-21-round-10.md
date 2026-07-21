# Jarvis Iteration 10 - First-Run Configuration

Time: 2026-07-21 19:54-20:05 (Asia/Shanghai)

## Ten problems found and fixed

1. **Reliability:** Fast double submission could start two activation flows. A synchronous lock now guards the full setup transaction.
2. **Validation:** Missing fields showed errors but left focus behind. Model, model key, Base URL, and cloud voice key errors now focus the exact field.
3. **Validation:** Custom providers accepted an empty or malformed Base URL. Setup now requires a complete URL before network calls.
4. **Configuration:** Switching providers retained incompatible model and URL defaults. Provider changes now reset both deliberately.
5. **Security UX:** Password fields could not be inspected for paste mistakes. Both credentials now have explicit show/hide icon controls.
6. **Security UX:** Credential inputs used generic autofill behavior. They now use new-password semantics to avoid unintended ordinary form fills.
7. **Atomicity:** Model activation happened before voice save, allowing a failed voice step to be bypassed after restart. Voice is now saved first; activation remains the final gate.
8. **Reliability:** Setup requests could wait indefinitely. Voice save has a 15-second timeout and model validation a 20-second timeout.
9. **Error clarity:** Timeout messages did not identify the failed stage. A synchronous step reference now reports voice-save or model-validation timeout accurately.
10. **Feedback:** The user saw only a spinner during multi-step setup. The active step is now announced visually and through a polite live region.

## Verification

- Expanded `scripts/probe-first-run-setup.cjs`; all original and ten new setup assertions passed.
- Added a sixth `first-run` layout scenario with its own screenshot.
- `npm run probe:layout` passed all six scenarios; the setup form and controls remain inside the viewport.
- `npm run check` passed.

