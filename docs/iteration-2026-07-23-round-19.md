# Iteration 19 - Settings capture integrity

1. [Function] Settings capture could occur before layout flush; the probe now forces a body layout read.
2. [Function] Chromium could reuse a stale compositor surface; the probe now invalidates web contents.
3. [Function] One frame was insufficient after invalidation; capture now waits two animation frames.
4. [Function] The invalidation wait had no settling margin; a post-invalidation delay is now explicit.
5. [Function] The dialog could close between DOM check and capture; the probe confirms it remains mounted.
6. [Design] Capture order was implicit; the dialog confirmation now precedes the image call.
7. [Function] Wrong-width screenshots could pass semantic checks; live content width is now gated.
8. [Function] Wrong-height screenshots could pass semantic checks; live content height is now gated.
9. [Function] Pixel validity was not exposed in the result; it is now recorded explicitly.
10. [Function] Settings success ignored image validity; the aggregate result now requires valid pixels.
