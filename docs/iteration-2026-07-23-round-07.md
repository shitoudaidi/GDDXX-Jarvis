# Iteration 07 - Settings continuity

1. [Conversation] Esc could close settings during a save; it now leaves the dialog open until the request settles.
2. [Function] Clicking the backdrop could interrupt a save; backdrop close is now guarded by both save states.
3. [Function] The close icon could interrupt model or AI HOT saves; it is now disabled while either request runs.
4. [Function] Model settings had no form label or busy state; the form now exposes both.
5. [Function] Settings provider select had no stable name; it now has a form key.
6. [Function] Settings model select had no stable name; it now has a form key.
7. [Function] Settings Base URL lacked URL keyboard and autocomplete semantics; it now declares both.
8. [Design] AI HOT settings had no named region; it now has a distinct accessible region.
9. [Function] AI HOT endpoint lacked a stable field name and mobile URL hints; it now declares them.
10. [Function] AI HOT API key lacked a stable field name; password managers and test tooling can now identify it safely.
