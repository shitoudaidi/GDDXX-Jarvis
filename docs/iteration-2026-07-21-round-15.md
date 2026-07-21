# Iteration 15 - Chinese-safe command composer

1. Enter could submit while a Chinese IME candidate was being confirmed; composition state now blocks submission.
2. Some browsers only expose composition on the native event; that signal is now checked too.
3. The Enter behavior was not described to assistive technology; a linked keyboard hint now explains send and newline.
4. Input had no hard size boundary; commands are now capped at 4,000 characters.
5. Users received no warning near the boundary; a counter appears at 3,600 characters.
6. The counter was not announced; it now uses a polite live region.
7. Reaching the limit had no semantic state; the field now exposes aria-invalid.
8. Reaching the limit had no visual state; a restrained amber focus outline now appears.
9. A restored draft could remain hidden behind the keyboard toggle; non-empty drafts now open the composer.
10. Restored or pasted multiline text did not recalculate height; draft changes now resize the field consistently.
