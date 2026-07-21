# Iteration 13 - Credential-safe settings

1. The settings API returned the full chat API key; it now returns only a configured flag.
2. The UI could not intentionally reveal a newly entered key; it now has an explicit eye control.
3. The reveal control lacked an accessible state label; its label now changes between show and hide.
4. Password managers could overwrite the model API credential; it now uses new-password semantics.
5. Spellcheck could inspect or alter the model credential; it is now disabled.
6. Closing settings retained model and AI HOT secrets in state; both are now cleared.
7. Invalid Base URLs reached the backend before feedback; HTTP(S) validation now happens locally.
8. A model settings save could hang indefinitely; it now uses the shared ten-second timeout.
9. Save remained enabled without a provider or model; incomplete submissions are now blocked.
10. The reveal button could resize the field row; a stable 40-pixel control track preserves layout.
