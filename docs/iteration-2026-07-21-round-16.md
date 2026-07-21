# Iteration 16 - Searchable conversation history

1. Long history had no search entry; the terminal now has a compact search control.
2. Search matching was unavailable; text is now matched case-insensitively.
3. Channel/source labels could not be found; they are included in matching.
4. Collapsed history would have hidden older matches; an active search covers all loaded messages.
5. Users could not tell how many results matched; the count is now visible and announced.
6. Search could not be cleared in one action; a dedicated clear control is now shown when needed.
7. Keyboard users could not leave search quickly; Escape closes it and clears the query.
8. The search field did not receive focus when opened; focus now moves there immediately.
9. Zero results looked like an empty conversation; a distinct no-match state explains what to do.
10. Search controls could squeeze the history header; constrained flex sizing preserves the panel.
