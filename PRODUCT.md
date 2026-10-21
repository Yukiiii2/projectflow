# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript, Vite, React Router, Tailwind CSS, Lucide icons, and Motion. Authentication and workspace membership connect to the local Express and PostgreSQL backend; dashboard project and task data remains client-side mock state.

## Users

Freelancers, small development teams, project managers, and team contributors who need a clear view of project health and near-term work.

## Product Purpose

ProjectFlow helps small teams organize projects, assign and complete tasks, and understand progress without enterprise-level complexity. Stage B adds real workspace onboarding, creation, switching, and membership-scoped access to the approved application shell and dashboard.

## Positioning

ProjectFlow combines a calm, dark-first command center with enough operational density for daily team work while remaining approachable to freelancers and small teams.

## Operating Context

Users move between workspaces, scan active projects, review completion and overdue work, inspect upcoming tasks and activity, and adapt the interface across desktop, tablet, and mobile.

## Capabilities and Constraints

- The implemented frontend includes authentication, workspace onboarding and selection, the application shell, and dashboard states.
- Registration, login, logout, and session restoration use the local Express and PostgreSQL backend.
- Workspace identities and roles use the local Express and PostgreSQL backend.
- Project, task, activity, chart, and dashboard summary data remains local and illustrative.
- There is no production deployment or Figma MCP access.
- Later-stage destinations remain visible for information architecture but explain that they are unavailable.
- The prototype remains isolated under the prototype directory.

## Brand Commitments

- Name: ProjectFlow.
- Approved direction: Concept A — Modern Professional.
- Dark-first surfaces with refined purple accents, Inter typography, subtle borders, restrained shadows, consistent spacing, and optional light mode.
- Preserve the approved dashboard composition and Northstar Studio sample data.

## Evidence on Hand

- ../Concept-A.png
- ../projectflow-foundations-phase2a.png
- ../Phase2A-Recovery.md
- ../Phase2B-MVP-Plan.md
- ../Phase2B-Screen-Checklist.md
- ../design-state.json

All names, metrics, projects, tasks, and activity entries are synthetic portfolio data.

## Product Principles

1. Make status and next actions clear at a glance.
2. Keep dense information calm through typography, spacing, and alignment.
3. Give every visible control an honest behavior.
4. Treat loading, emptiness, and failure as designed product states.
5. Adapt interaction models intentionally for smaller screens.

## Accessibility & Inclusion

Target WCAG 2.2 AA, visible focus, keyboard-operable controls, reduced-motion support, semantic landmarks, status cues beyond color, and 44px mobile touch targets.

## Assumptions

- The approved local screenshots and written specifications are the visual authority because Figma MCP access is unavailable.
- Inter may be loaded from a web font during local development; the CSS stack includes a system fallback.
- Stage 1 navigation destinations outside Dashboard display an explicit prototype notice and do not simulate unfinished screens.
