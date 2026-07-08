# Design Systems Reference

Common UI patterns, layouts, and component conventions for reference during specification creation.

<common_layouts>

## Page Layouts

### Centered Card
Best for: Login, signup, single-action pages
```
┌─────────────────────────────────────────────────────┐
│                    [Background]                      │
│                                                      │
│              ┌─────────────────────┐                │
│              │                     │                │
│              │    [Card Content]   │                │
│              │                     │                │
│              └─────────────────────┘                │
│                                                      │
└─────────────────────────────────────────────────────┘
```
- Card: max-width 400-500px, centered
- Background: subtle gray or gradient
- Padding: 24-32px inside card

### Sidebar Layout
Best for: Dashboards, admin panels, apps with navigation
```
┌────────┬────────────────────────────────────────────┐
│        │  [Header]                                   │
│        ├────────────────────────────────────────────┤
│ [Side] │                                            │
│ [bar]  │  [Main Content Area]                       │
│        │                                            │
│        │                                            │
│        │                                            │
└────────┴────────────────────────────────────────────┘
```
- Sidebar: 240-280px width, fixed
- Collapsible on mobile
- Header: 56-64px height

### Full-Width with Header
Best for: Marketing pages, content-heavy sites
```
┌─────────────────────────────────────────────────────┐
│  [Navbar]                                           │
├─────────────────────────────────────────────────────┤
│                                                      │
│  [Hero Section]                                      │
│                                                      │
├─────────────────────────────────────────────────────┤
│  [Content Sections]                                  │
│                                                      │
└─────────────────────────────────────────────────────┘
```
- Content max-width: 1200-1440px, centered
- Full-width backgrounds for sections
- Responsive padding

### Split Layout
Best for: Onboarding, feature showcases
```
┌────────────────────────┬────────────────────────────┐
│                        │                            │
│  [Image/Illustration]  │  [Form/Content]            │
│                        │                            │
│                        │                            │
└────────────────────────┴────────────────────────────┘
```
- 50/50 or 40/60 split
- Stack vertically on mobile
- One side often has brand imagery

</common_layouts>

<screen_patterns>

## Authentication Screens

### Login
Essential elements:
- Logo/brand
- Email input
- Password input
- Submit button
- "Forgot password" link
- Sign up link
- Social login options (optional)

### Signup
Essential elements:
- Logo/brand
- Name inputs (first/last or full)
- Email input
- Password input (with strength indicator)
- Terms acceptance checkbox
- Submit button
- Login link

### Forgot Password
Essential elements:
- Explanation text
- Email input
- Submit button
- Back to login link

## Dashboard Screens

### Overview Dashboard
Essential elements:
- Welcome/greeting
- Key metrics (cards or stats)
- Recent activity list
- Quick actions
- Charts/graphs (if data-driven)

### List/Table View
Essential elements:
- Page title
- Search/filter controls
- Data table or card grid
- Pagination
- Bulk actions (if applicable)
- "Add new" button

### Detail View
Essential elements:
- Back navigation
- Item title/header
- Key information
- Action buttons (Edit, Delete)
- Related items
- Activity/history

## Settings Screens

### Settings Overview
Essential elements:
- Section navigation (tabs or sidebar)
- Grouped settings
- Save/cancel buttons (or auto-save indicators)

### Profile Settings
Essential elements:
- Avatar upload
- Name fields
- Email (with verification status)
- Password change
- Delete account (with confirmation)

</screen_patterns>

<component_conventions>

## Buttons

**Hierarchy:**
1. Primary - Main action, filled background
2. Secondary - Supporting action, outlined or subtle
3. Ghost/Text - Tertiary action, text only
4. Destructive - Dangerous actions, red

**Sizes:**
- sm: 32px height, 12px padding, 14px font
- md: 40px height, 16px padding, 16px font
- lg: 48px height, 24px padding, 18px font

**States:**
- Default, Hover, Active, Focus, Disabled, Loading

## Form Inputs

**Anatomy:**
- Label (above or beside)
- Input field
- Helper text (optional, below)
- Error message (replaces helper on error)

**States:**
- Default, Focus, Filled, Error, Disabled

**Types:**
- Text, Email, Password, Number
- Search (with icon)
- Textarea (multiline)

## Cards

**Anatomy:**
- Header (optional: title, subtitle, actions)
- Content area
- Footer (optional: actions, metadata)

**Variants:**
- Default (elevated with shadow)
- Outlined (border, no shadow)
- Filled (background color, no shadow)

## Navigation

**Top Navigation:**
- Logo on left
- Links in center or right
- User menu on right
- Mobile: hamburger menu

**Sidebar Navigation:**
- Logo at top
- Navigation links (with icons)
- Grouped sections
- User info at bottom
- Collapse toggle

**Tabs:**
- Horizontal row of options
- Active state indicator
- Content changes below

</component_conventions>

<spacing_system>

## Base Unit: 4px

```
spacing.0.5 =  2px   (0.125rem)
spacing.1   =  4px   (0.25rem)
spacing.2   =  8px   (0.5rem)
spacing.3   = 12px   (0.75rem)
spacing.4   = 16px   (1rem)
spacing.5   = 20px   (1.25rem)
spacing.6   = 24px   (1.5rem)
spacing.8   = 32px   (2rem)
spacing.10  = 40px   (2.5rem)
spacing.12  = 48px   (3rem)
spacing.16  = 64px   (4rem)
```

## Common Applications

| Context | Recommended Spacing |
|---------|---------------------|
| Between form fields | spacing.4 (16px) |
| Card padding | spacing.6 (24px) |
| Section padding | spacing.8-12 (32-48px) |
| Page padding | spacing.4-6 (16-24px) |
| Button internal | spacing.2-4 x spacing.3-6 |
| Icon + text gap | spacing.2 (8px) |

</spacing_system>

<typography_scale>

## Size Scale

```
xs:   12px / 0.75rem   - Captions, badges
sm:   14px / 0.875rem  - Helper text, small labels
base: 16px / 1rem      - Body text (default)
lg:   18px / 1.125rem  - Large body, lead text
xl:   20px / 1.25rem   - H4, small headings
2xl:  24px / 1.5rem    - H3
3xl:  30px / 1.875rem  - H2
4xl:  36px / 2.25rem   - H1
5xl:  48px / 3rem      - Display, hero
```

## Line Heights

- Headings: 1.25 (tight)
- Body: 1.5 (normal)
- Relaxed: 1.75

## Font Weights

- 400: Normal body text
- 500: Medium, emphasis
- 600: Semibold, headings
- 700: Bold, strong emphasis

</typography_scale>

<color_patterns>

## Semantic Colors

| Purpose | Usage |
|---------|-------|
| Primary | Main brand, primary actions |
| Secondary | Supporting actions, less emphasis |
| Accent | Highlights, focus states |
| Success | Positive feedback, confirmations |
| Warning | Caution states, attention needed |
| Error | Errors, destructive actions |
| Info | Informational, neutral feedback |

## Neutral Scale

Typically 10-12 shades from white to near-black:
- 50: Backgrounds, subtle fills
- 100-200: Borders, dividers
- 300-400: Disabled states, placeholders
- 500-600: Secondary text, icons
- 700-800: Primary text
- 900: Headings, emphasis

## Dark Mode Considerations

- Invert neutral scale
- Reduce saturation of colors
- Adjust shadows (lighter, more diffuse)
- Maintain WCAG contrast ratios

</color_patterns>

<responsive_breakpoints>

## Standard Breakpoints

```
sm:  640px   - Large phones, small tablets
md:  768px   - Tablets
lg:  1024px  - Small laptops
xl:  1280px  - Laptops, desktops
2xl: 1536px  - Large screens
```

## Common Patterns

| Layout | Mobile | Tablet | Desktop |
|--------|--------|--------|---------|
| Sidebar | Hidden/drawer | Collapsed | Expanded |
| Cards | 1 column | 2 columns | 3-4 columns |
| Tables | Card view | Horizontal scroll | Full table |
| Nav | Hamburger | Hamburger or tabs | Full links |
| Forms | Stacked | Stacked | 2-column possible |

</responsive_breakpoints>
