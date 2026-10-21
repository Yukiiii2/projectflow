# ProjectFlow Stage 1 — Design Notes

## Design authority

The prototype follows the existing ProjectFlow planning files and local exports in the parent folder. The approved direction is **Concept A — Modern Professional**. No Figma MCP calls were made. The dashboard keeps the approved dark-first structure: a persistent workspace sidebar, restrained top bar, clear metric hierarchy, project progress, task completion, upcoming work, and team activity.

The prototype uses Inter Variable locally, Lucide icons, subtle 1 px borders, quiet elevation, and purple accents. Surfaces remain mostly flat and functional; color is reserved for selection, status, progress, and primary actions.

## Implemented tokens

### Dark theme

| Role | Value |
| --- | --- |
| Canvas | `#0B0E14` |
| Sidebar | `#111621` |
| Surface | `#151B27` |
| Raised surface | `#1B2332` |
| Hover surface | `#222C3D` |
| Border | `#293244` |
| Primary text | `#F7F8FB` |
| Secondary text | `#B8C1D1` |
| Tertiary text | `#8D98AB` |
| Purple accent | `#8B6BE8` / `#6D4ED6` |
| Success | `#3CCB93` |
| Warning | `#E8B64E` |
| Danger | `#F27485` |
| Information | `#6EA8FE` |

### Light theme

| Role | Value |
| --- | --- |
| Canvas | `#F7F8FB` |
| Surface | `#FFFFFF` |
| Muted surface | `#F4F6FA` |
| Border | `#D9DEE8` |
| Primary text | `#151B27` |
| Secondary text | `#505C70` |
| Tertiary text | `#5F6B7F` |
| Purple accent | `#6D4ED6` / `#5D3FC3` |
| Success | `#0D7852` |
| Warning | `#81500A` |
| Danger | `#B7354C` |
| Information | `#245CAF` |

The light-theme tertiary and semantic colors are slightly darker than the draft foundation values. Automated contrast testing found the draft values too light for 9–12 px supporting text, badges, and initials. The adjusted values pass the tested WCAG 2.2 AA rules while preserving the intended palette.

### Typography and geometry

- Font: Inter Variable, shipped locally through `@fontsource-variable/inter`.
- Page title: 26–30 px, 710 weight, tight tracking.
- Section heading: 15 px, 680 weight.
- Body: 14 px with 1.55 line height.
- Labels and supporting copy: 10–13 px with higher weight where needed for contrast and scanning.
- Core spacing increments: 4, 8, 12, 16, 18, 24, 32, and 48 px.
- Radii: 8 px controls, 10–12 px cards and panels, 16 px large state surfaces.
- Elevation: restrained ambient shadows on raised controls and panels.

## Responsive behavior

### Desktop — 1440 px

- 224 px expanded sidebar, with a user-controlled 72 px collapsed state.
- 72 px sticky top bar.
- Four-column metric row.
- Active projects and upcoming tasks receive the wider content column; completion and activity use the supporting column.

### Tablet — 768 px

- Sidebar becomes a fixed 72 px icon rail.
- Workspace selector displays the current workspace initials and retains its native selector behavior.
- Metrics use two columns.
- Project, chart, task, and activity panels stack into one content column.
- Page padding reduces to 24 px.

### Mobile — 390 px

- Desktop sidebar is replaced by a modal navigation drawer and a five-item bottom navigation bar.
- Metrics become a single column.
- Heading actions remain side by side where they fit.
- Project owners move out of project rows; task due dates and assignees yield to task title, priority, and action controls.
- Touch controls meet or exceed the 44 px target where they are primary mobile actions.

### Narrow mobile — 320 px

- Heading actions stack.
- Preview-state controls wrap to two columns.
- Task priority badges are removed from the narrow row while task titles and actions remain available.
- The document has no horizontal overflow.

## Mock-data consistency

Northstar Studio preserves the documented dataset:

- 4 active projects.
- 128 total project tasks.
- 96 completed tasks, producing a 75% completion rate.
- 8 tasks due this week.
- 3 overdue tasks.
- Project progress: 36/48, 28/36, 24/32, and 8/12.

The reporting-period selector changes the chart series for 7, 30, and 90 days while every series ends at the current 75% completion rate. Local task completion increments the completed count and decrements due-this-week count without persisting data.

Harbor Labs is a second mock workspace used to prove selector behavior. Its three projects total 72 tasks with 54 complete, also 75%.

## Interaction decisions

- Native selects are used for workspace and reporting-period controls for dependable keyboard and screen-reader behavior.
- Profile actions open a real menu; selecting an unavailable destination produces a visible status message.
- Navigation, search, notifications, creation actions, and other Stage 2/V1.1 destinations report their availability instead of simulating completed workflows.
- The error-state retry briefly displays the loading state, then returns to the populated dashboard.
- Motion is short and purposeful. `prefers-reduced-motion` reduces transitions and skeleton animation to near-zero duration.

## Accessibility implementation

- Semantic header, main, aside, navigation, section, time, button, select, and form controls.
- Keyboard-accessible controls with visible focus rings.
- Skip link to the dashboard heading.
- Explicit labels for icon controls and responsive icon-only navigation.
- Live status messaging for deferred interactions and workspace changes.
- Accessible SVG chart summary.
- WCAG 2.2 AA-tagged axe checks for all captured visual states.
- No measured horizontal overflow, out-of-bounds controls, or unexpected text clipping at 1440, 768, 390, or 320 px.

## Differences and assumptions

- The local screenshots and specifications were used because Figma MCP access was explicitly unavailable. Exact Figma auto-layout metadata, component identifiers, and prototype transitions could not be inspected.
- The chart is an editable SVG implementation using the documented purple accent rather than an exported Figma asset.
- The mobile bottom navigation and navigation drawer follow the documented responsive rules; these layouts were not visible in the supplied desktop reference.
- Light-theme semantic colors were contrast-corrected during browser verification.
- The prototype is intentionally client-only and disposable. It does not establish production routing, data models, authentication, or API contracts.

## Design lint exception

The Impeccable detector reports Inter as an overused font. Inter is retained because the authoritative ProjectFlow design specification explicitly requires it. The detector's layout-transition warning was resolved by removing sidebar width animation.
