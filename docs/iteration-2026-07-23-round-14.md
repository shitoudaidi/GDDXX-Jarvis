# Iteration 14 - Minimum-window cockpit

1. [Design] Header tracks were too wide for the supported minimum viewport; compact tracks now reserve predictable space.
2. [Aesthetic] Brand and clock spacing collided at 1060px; the compact gap is now 10px.
3. [Aesthetic] The full-size wordmark crowded the compact header; it now scales to 21px.
4. [Design] The clock divider consumed scarce header width; its inset is now reduced.
5. [Design] The date wrapped beneath the clock at minimum width; compact mode now keeps only the time.
6. [Aesthetic] Three system states looked uneven in narrow tracks; compact states are now centered.
7. [Function] The live turn owner could overflow the conversation header; it now truncates within 76px.
8. [Function] The capability panel collapsed and clipped rows in a shallow window; it now preserves its content height.
9. [Design] Capability rows were too tall for a 720px window; shallow mode uses 40px rows and tighter headings.
10. [Aesthetic] The central entity collided with the dock in shallow windows; the vortex now scales to 72 percent.
