# Iteration 14 - Recoverable conversation connectivity

1. Unsent text vanished after reload; drafts now restore from local storage.
2. Draft edits were not persisted; they now save after a short debounce.
3. Successfully sent drafts could remain in storage; empty state now removes them.
4. A transient GET failure immediately surfaced as an error; safe reads retry once.
5. API failures did not update the connection instrument; they now mark the core degraded.
6. Timeout errors were generic; they now explain that the core service timed out and can be retried.
7. Successful API traffic did not heal stale status; it now marks the core online.
8. Browser online recovery was passive; it now reconnects events and refreshes state.
9. Browser offline state was indistinguishable from server failure; it now has a dedicated label.
10. Returning from the background showed stale data; foreground activation now resynchronizes.
