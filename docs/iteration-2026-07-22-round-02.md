# Iteration 02 - Resilient AI news states

1. [Function] Pause was enabled without rotatable content; it is disabled until at least two items exist.
2. [Aesthetic] Loading used a vague sentence; it now uses a stable three-row content skeleton.
3. [Function] Empty failures had no direct recovery; the panel now provides an inline reload action.
4. [Function] Cached stories looked current after refresh failure; retained content is now marked STALE in amber.
5. [Function] Invalid timestamps could render as Invalid Date; malformed values now fall back safely.
6. [Function] Provider errors could fill the panel; whitespace is normalized and text is capped at 120 characters.
7. [Function] Rotation had no position context; the header now reports current and total item counts.
8. [Aesthetic] External stories looked like inert rows; a restrained external-link affordance is now visible.
9. [Function] Duplicate provider IDs could destabilize React rendering; visible keys now include slot identity.
10. [Function] JavaScript entrance motion ignored reduced-motion preference; it now renders immediately when requested.
