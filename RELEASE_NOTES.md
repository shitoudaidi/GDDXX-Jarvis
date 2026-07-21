# GDDXX-Jarvis 0.3.0

This release focuses on dependable voice entry, clean Windows deployment, and a calmer conversation cockpit.

- Adds a permanent arrow-only manual entrance on the standby screen.
- Improves quiet-microphone wake recognition and preserves audio during local Whisper warmup.
- Adds first-run model, credential, and voice setup with bounded validation.
- Makes conversation turns cancellable, searchable, recoverable after connection loss, and safe for Chinese IME input.
- Improves local and cloud TTS timeout handling, Chinese routing, and playback recovery.
- Adds adaptive rendering and reduced-motion behavior for lower-power Windows computers.
- Hardens clean Windows source installation and GitHub installer checksum publishing.
- Removes plaintext credentials from settings responses and redacts secrets from public errors.

Normal users only need the Windows x64 installer. Node.js, Python, Git, and build tools are not required.
