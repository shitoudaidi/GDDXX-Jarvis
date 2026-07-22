# Iteration 10 - Keyboard-efficient engineering

1. [Function] Opening Engineering did not focus its primary input; idle workbench entry now does.
2. [Function] Escape could not leave Engineering; the standard close key now works.
3. [Function] The task editor lacked a keyboard submit command; Ctrl/Cmd+Enter now runs the task.
4. [Function] New Task did not return focus to the editor; it now clears and focuses in one action.
5. [Function] Loading a historical prompt did not return focus; the restored task is immediately editable.
6. [Function] Engineering tabs did not support arrow navigation; left and right arrows now cycle views.
7. [Function] Every tab remained in the tab order; selected-tab roving focus is now implemented.
8. [Function] Streaming output always stole the user's reading position; auto-follow now pauses when scrolled away.
9. [Function] Paused output had no recovery action; a compact Latest output control now returns to the stream.
10. [Function] Running output and form failures lacked complete semantics; busy and alert states are now explicit.
