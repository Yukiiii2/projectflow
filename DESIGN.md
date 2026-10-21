# ProjectFlow Stage 1 Design Direction

## Mode

Operate. The dashboard supports rapid scanning, prioritization, and navigation.

## Visual authority

Preserve the approved Concept A composition. Its defining element is the balanced command-center view: a compact project list paired with a completion visualization, followed by upcoming work and recent team activity.

## Core palette

- Canvas: #0B0E14
- Sidebar: #111621
- Surface: #151B27
- Raised surface: #1B2332
- Border: #344055
- Primary text: #F7F8FB
- Secondary text: #B8C1D1
- Primary purple: #6D4ED6
- Purple highlight: #A78BFA
- Success: #3CCB93
- Warning: #E8B64E
- Danger: #F27485

Light mode uses #F7F8FB canvas, white surfaces, #151B27 primary text, #505C70 secondary text, and the same semantic purple family with darker interactive states.

## Typography

Inter throughout. Page title 28/36 semi-bold; section title 18/26 semi-bold; body 14/22; label 13/18 medium; caption 12/18; metric 32/36 semi-bold. Use tabular numerals for counts, percentages, and dates.

## Layout

- Desktop: 224px sidebar, 72px top bar, 32px content inset, four metrics, 24px main gaps, 8/4 content split.
- Tablet: 72px icon rail, 24px inset, two-column metrics, stacked content panels.
- Mobile: drawer plus bottom navigation, 16px inset, one-column metrics and panels.
- 320px: preserve one column, wrap top actions, and prevent horizontal scrolling.

## Components

Use one radius language: 10–12px controls and 14–16px cards. Borders define depth; shadows are reserved for menus, drawers, and interactive overlays. Pills are limited to compact statuses and filters.

## Interaction

Use brief Motion transitions for drawers and menus only. Theme, workspace, date filter, preview state, sidebar, and mobile drawer update client-side state. Later-stage navigation opens an explanatory notice.

## Authentication surface

Sign-in and registration extend the same Operate visual world. Desktop pairs a quiet product-progress preview with a constrained form panel; tablet and mobile remove the preview and prioritize the form. Inputs use persistent labels, explicit errors, 46–48px control heights, and the existing purple focus/action hierarchy. Authentication supports dark and light themes without decorative gradients or a separate marketing identity.

## Browser surfaces

Theme focus rings, selection color, scrollbar, caret, and tabular numerals. Respect prefers-reduced-motion.

## Responsive sketch

Desktop:

    [ 224 sidebar ][ top bar                                  ]
    [             ][ title + filters                         ]
    [             ][ metric ][ metric ][ metric ][ metric    ]
    [             ][ projects 8 cols ][ completion 4 cols    ]
    [             ][ tasks    8 cols ][ activity   4 cols    ]

Tablet:

    [72 rail][ top bar                                       ]
    [       ][ title + actions                               ]
    [       ][ metric ][ metric                              ]
    [       ][ metric ][ metric                              ]
    [       ][ projects                                      ]
    [       ][ completion                                    ]
    [       ][ tasks                                         ]
    [       ][ activity                                      ]

Mobile:

    [ top bar + menu ]
    [ title          ]
    [ actions        ]
    [ metric         ]
    [ metric         ]
    [ metric         ]
    [ metric         ]
    [ projects       ]
    [ completion     ]
    [ tasks          ]
    [ activity       ]
    [ bottom nav     ]

## Quality constraints

- No decorative gradients, glass, emoji icons, fake functionality, or nested card stacks.
- No clipped text at realistic content lengths.
- Every control has a tooltip or visible label when its icon alone may be ambiguous.
- Empty, loading, and error previews preserve the application shell and page context.
