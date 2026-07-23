# Iteration 09 - Motion continuity

1. [Aesthetic] Message rows always started transparent; reduced-motion users now see them immediately.
2. [Conversation] Message row entrance duration ignored the user preference; it now becomes zero when reduced motion is requested.
3. [Aesthetic] Message rows still retained an animated target under reduced motion; their static initial path now owns the state.
4. [Aesthetic] ACUI result cards always triggered layout animation; layout animation is disabled for reduced motion.
5. [Conversation] ACUI cards always entered from the side; reduced-motion users now receive an immediate result.
6. [Conversation] ACUI cards always exited with a transform; the exit animation is removed for reduced motion.
7. [Aesthetic] ACUI card transitions ignored the motion preference; their duration is now zero when reduced motion is requested.
8. [Function] Live result cards could shift neighboring content through layout animation; the reduced path keeps the surrounding layout stable.
9. [Design] Message and live-result motion now use the same explicit preference vocabulary as the central entity.
10. [Function] The visual probe retains stable initial states, preventing screenshots from depending on an animation frame.
