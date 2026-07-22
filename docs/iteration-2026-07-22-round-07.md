# Iteration 07 - Bounded engineering work

1. [Function] Cached engineering history trusted arbitrary JSON; only a validated bounded array is now loaded.
2. [Function] Cached task prompts could be enormous; history labels are capped at 240 characters.
3. [Function] New engineering prompts had no hard limit; input is capped at 4,000 characters.
4. [Aesthetic] Prompt capacity was invisible; a quiet counter warns near the limit.
5. [Function] Quick actions could submit repeatedly before status updated; they now share the submission lock.
6. [Function] Engineering submission errors were unbounded; both paths now use safe feedback.
7. [Function] Stop could fire repeatedly; cancellation is now single-flight with progress feedback.
8. [Function] Permission decisions could fire repeatedly; answers are now single-flight and disabled while pending.
9. [Function] View buttons looked like tabs without tab semantics; roles and selection state now match.
10. [Function] Huge agent output could freeze the workbench; rendering is capped to the latest 50,000 characters.
