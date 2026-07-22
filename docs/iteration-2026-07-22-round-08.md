# Iteration 08 - Efficient central entity

1. [Function] Reduced-motion preference reached CSS only; the React entity now reads it directly.
2. [Aesthetic] The entity frame still shifted and scaled under reduced motion; it now stays geometrically fixed.
3. [Aesthetic] Video state changes still blurred and zoomed under reduced motion; they now switch without choreography.
4. [Function] Reduced-motion mode still looped video; it now holds a stable early frame.
5. [Function] Hidden windows did not explicitly pause video decoding; visibility changes now pause playback.
6. [Function] Returning to the window had no controlled resume path; playback now resumes only when appropriate.
7. [Function] State videos could preload their full payload; metadata-only preload reduces startup pressure.
8. [Function] Decorative video could expose picture-in-picture controls; that unrelated affordance is disabled.
9. [Function] Failed video elements remained mounted; the broken element is now removed while particles remain.
10. [Aesthetic] Video failure had no explicit visual state; the frame now uses a restrained particle-first fallback treatment.
