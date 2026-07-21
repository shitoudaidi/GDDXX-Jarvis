# Iteration 12 - TTS reliability and Chinese speech routing

1. Cloud TTS calls could wait forever; all five providers now share a 30-second abort timeout.
2. A provider could return no response body; conversion now rejects it explicitly.
3. MiniMax or Volcano could decode empty audio; buffered streams now reject zero-byte output.
4. Windows System Speech had no timeout; its process is stopped after 45 seconds.
5. Windows System Speech children were not tracked at shutdown; they now share the active child registry.
6. The backend trusted every caller's text size; all synthesis paths now enforce 800 characters.
7. OpenAI TTS accepted malformed or unsafe URL schemes; its Base URL now requires HTTP(S).
8. OpenAI and ElevenLabs streams lacked explicit MIME metadata; both now report audio/mpeg.
9. Chinese text was discarded for every provider; only the English-only Piper route now applies that constraint.
10. Reliability rules were implicit; a ten-assertion contract probe now runs in the main quality gate.
