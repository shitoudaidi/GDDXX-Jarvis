# Iteration 17 - Render-ready visual evidence

1. [Function] Minimum-window capture could run during wake-up; the probe now waits for active stage state.
2. [Function] A missing news node was not a capture blocker; node presence is now required.
3. [Design] A `display:none` news rail could pass geometry checks; displayed state is now required.
4. [Design] A hidden news rail could pass geometry checks; computed visibility is now required.
5. [Aesthetic] A transparent news rail produced a false screenshot; opacity must now reach 0.95.
6. [Aesthetic] A blurred transitioning rail produced unreadable evidence; the filter must now settle.
7. [Aesthetic] A translated rail could be captured off-position; transform completion is now required.
8. [Function] Loading news could be captured before content arrived; `aria-busy` must now clear.
9. [Function] An empty shell could count as rendered; a news item or explicit empty state is now required.
10. [Function] Viewport success previously ignored render readiness; the final result now gates on all conditions.
