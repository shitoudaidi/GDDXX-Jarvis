# Iteration 18 - Settings scroll flow

1. [Function] Five settings blocks were forced into four grid rows; the drawer now uses natural flex flow.
2. [Design] Settings blocks could compete horizontally; the flow is explicitly vertical.
3. [Function] Long endpoint values could create horizontal scrolling; overflow is now clipped on the x-axis.
4. [Function] The compressed AI HOT block overlapped following content; the drawer now scrolls vertically.
5. [Design] Wheel scrolling could escape into the dimmed workbench; overscroll is now contained.
6. [Function] Focused controls could land beneath the sticky header; the drawer now reserves scroll padding.
7. [Aesthetic] The modal used an oversized 14px radius; its operational surface now uses a restrained 6px radius.
8. [Design] The close action disappeared during long-form scrolling; the drawer header is now sticky.
9. [Function] Individual settings sections could collapse below their content; each now keeps max-content height.
10. [Aesthetic] Inputs and buttons used inconsistent pill-like corners; settings controls now use a 4px radius.
