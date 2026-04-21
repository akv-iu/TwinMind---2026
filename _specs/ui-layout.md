# Spec for UI Layout

branch: claude/feature/ui-layout
figma_component (if used): N/A — no Figma reference

## Summary

The shell of the application: a desktop-first, full-viewport, 3-column CSS Grid layout with `TranscriptPanel`, `SuggestionsPanel`, and `ChatPanel` as three independently-scrolling containers separated by vertical borders. In this slice the panels are empty placeholder components — real behavior is delivered by the downstream slices. The outcome is a visual skeleton that lets a developer verify column proportions, borders, and independent scroll without any business logic.

## Functional Requirements

- Root layout uses CSS Grid with 3 equal columns and 100% viewport height.
- Each column is its own scroll container (`overflow-y-auto`); the page itself does not scroll.
- Vertical border divider between columns (Tailwind `border-r border-gray-200` on the first two).
- `TranscriptPanel`, `SuggestionsPanel`, `ChatPanel` are rendered as empty placeholder components that accept `className` for container styling.
- Tailwind utility classes only — no custom CSS files, no CSS modules.
- Desktop-only: no mobile collapse, no hamburger, no responsive single-column stack.

## Possible Edge Cases

- Long content in one panel (e.g. a thousand transcript lines) causes that panel to scroll internally without moving the other two panels or the outer page.
- Scrollbar appearing in one column must not horizontally shift the other columns' content. Use `overflow-y: auto` with a consistent gutter, or a stable scrollbar style.
- At narrow viewport widths (< ~1024px) the layout is intentionally broken — document the minimum supported width and/or render a "desktop only" notice.
- Dynamic content height shifts (e.g. new chat messages) must not reset the scroll position of a sibling panel.

## Acceptance Criteria

- At desktop widths (≥1280px), three equal columns are visible side-by-side with clear border dividers.
- Scrolling one panel leaves the other two panels' scroll positions untouched.
- The outer document has no scroll — only the panels scroll.
- No custom CSS files are introduced; the layout is expressed purely in Tailwind utilities.
- Placeholder components import cleanly into the root page without TypeScript errors.

## Open Questions

- What is the minimum supported viewport width — 1024px, 1280px, or 1440px? 1280px
- Below the minimum, show a "please use a wider window" notice, force horizontal scroll, or let it degrade? show comment.
- Any header/footer (brand, record toggle, settings) that should sit outside the grid, or does the grid take the full viewport? Grid takes full viewport
- Should column widths be equal forever, or does one panel deserve more horizontal space (e.g. chat wider than suggestions)? Equal

## Testing Guidelines

Create a test file(s) in the ./tests folder for the new feature, and create meaningful tests for the following cases, without going too heavy:

- Screenshot / visual regression test of the empty 3-column layout at 1280px and 1920px widths.
- Programmatic test: scrolling column A does not change `scrollTop` of columns B and C.
- Render test that all three placeholder panels mount without errors.
- DOM test that the outer root element has `overflow: hidden` (no page scroll).
