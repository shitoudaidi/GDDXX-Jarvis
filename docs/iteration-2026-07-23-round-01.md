# Iteration 01 - Conversation continuity guardrails

1. [Conversation] Local music confirmations had no timestamp; local system messages now use a shared timestamped message factory.
2. [Conversation] Local music message IDs could collide during rapid actions; the shared factory adds a short entropy suffix.
3. [Conversation] Cancel failures exposed unbounded backend text; cancellation feedback is now bounded.
4. [Conversation] Three consecutive conversation poll failures were silent; the terminal now announces that it is still waiting.
5. [Conversation] Poll failure counters survived into later turns; clearing a poll resets the counter.
6. [Conversation] Engineering acceptance was a hand-built system message without consistent metadata; it now uses the shared factory.
7. [Conversation] Engineering submission errors could expose raw internal text; they now use bounded feedback.
8. [Conversation] Generic send failures used a hand-built error row without a timestamp; they now use the shared factory and bounded text.
9. [Conversation] TTS failures could expose raw provider errors; the visible error is now bounded with a stable fallback.
10. [Design] Initial core connection errors could overflow the compact status rail; connection detail and alert text now share bounded feedback.
