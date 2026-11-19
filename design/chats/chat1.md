# Chat

_Started 2026-11-19 16:35 UTC_

---

## User

<system-info comment="Only acknowledge these if relevant">
Project title is now "# DESIGN BRIEF: PREMIUM GLOBAL TECHNOLOGY PRODUCT DATABASE??? Before pasting: re"
Current date is now November 19, 2026
</system-info>

<attached aesthetic_system_instructions>
A design system or theme is attached to this project. That attachment already answers the visual-style question: apply it. Do NOT ask the user which visual style to use — no questions about vibe, colors or palette directions (including color-swatch svg-options questions), typography, mood, or art direction, and skip the "divergent visuals" question from the question-asking tips; offer divergent visual directions only if the user themselves asks for alternatives. This rule bans asking the user to pre-pick a style in the abstract — swatches, mood words, palette pickers. It does not ban asking them to choose among candidates you have already built: putting built candidates on a file-options board for the user to pick from is encouraged. Treat the attachment as the confirmed starting point and product context — the "confirm the starting point" tip is already satisfied, so do not ask the user to confirm or re-pick it. Spend your questions on everything else you need: audience, purpose, content, structure, scope, interactions, tone of copy.
</attached aesthetic_system_instructions>

<pasted_text name="Pasted text (105 lines)">
# DESIGN BRIEF: PREMIUM GLOBAL TECHNOLOGY PRODUCT DATABASE

&gt; Before pasting: replace `[BRAND NAME]` with the real name if you have one. If it's left as is, use the working name **"Specbase"** and design the wordmark so it can be swapped later.

---

## 1. What you're designing

The visual identity, design system and key screens for **[BRAND NAME]**, a global technology product database. Users look up hardware (smartphones, laptops, CPUs, GPUs, monitors, headphones), read structured specifications, compare up to four products side by side, and find retailer offers through affiliate links.

It should feel like a **serious international reference platform**, a blend of a technology encyclopedia and a precise comparison tool. It must not look like an affiliate blog, an ecommerce template or a SaaS dashboard.

**Audience:** informed buyers and enthusiasts worldwide who want facts quickly. They scan tables, compare numbers and distrust marketing.

**Three words:** precise, calm, trustworthy.

**Do not imitate** GSMArena, RTINGS, Versus, PCPartPicker or any other existing site's layout, branding or visual style. Create an original identity.

---

## 2. Visual direction

- **Editorial minimalism with high information density done well.** Generous whitespace around sections; tight, orderly density inside data (tables, spec lists).
- **Palette:** refined neutrals (warm or cool grey, your choice, justified) plus **one restrained accent color**, used for primary actions, focus rings, links and the "better value" highlight in comparisons. Semantic colors (success, warning, danger) are muted and used only for status.
- **Light and dark mode**, both first-class, built from the same tokens.
- **Typography:** a clean, highly legible sans for UI and body with **tabular numerals** (spec values and prices must align in columns). Optionally a monospace or a distinct numeric style for model numbers and part numbers. Fonts must be openly licensed (e.g. Google Fonts). A clear type scale with strong hierarchy.
- **Product imagery** is shown on a quiet, consistent neutral surface so products of different photo quality look uniform. Design a tasteful **placeholder** for products without a licensed image (most will start without one).
- **Avoid:** gradients beyond the very subtle, glassmorphism, neon "gamer" aesthetics, large decorative animations, stock-photo heroes, heavy drop shadows, crowded cards, excessive badges, popups.
- **Motion:** minimal and functional (hover, focus, tray slide-in, expand/collapse).

---

## 3. Honesty rules the design must express

These are product rules, not decoration. They need dedicated, well-designed UI:

1. **No ratings, stars, scores or review counts anywhere.** There is no overall "winner" in comparisons.
2. **Verification status** on every product: `Verified`, `Partially verified`, `Needs review`. Design a quiet badge plus a "Data sources" section explaining where data came from and when it was last verified.
3. **Offer freshness:** every offer shows "Last checked X ago". **Stale offers** (older than 3 days) appear below fresh ones with a visible but calm warning ("Price may have changed").
4. **Market:** every offer shows its market (country flag or code + currency). A **market selector** in the header ("All markets", "Poland", "Germany", "United States", …). Offers outside the selected market are grouped under a collapsed "Other markets" section.
5. **Affiliate disclosure:** a short, honest line near every offer list, plus a footer link.
6. **Honest empty states:** "No current retailer offers for this product yet." "Not available" for missing specs, visually distinct from a "No" value.
7. **Demo data banner:** a slim site-wide banner, "Demonstration data — products, brands and offers on this site are fictional", plus a small "Demo" tag on demo product cards and offers.
8. Prices always show the **original currency**; no converted prices.

---

## 4. Content to use in mockups

Use **fictional** brands and products only, with names that clearly aren't real trademarks (for example brands like "Halden", "Novik", "Corvala"). Make the specs realistic and internally consistent. Retailers are fictional too (e.g. "Demo Retailer PL", "Demo Retailer DE"). Show a mix of in-stock, out-of-stock, stale and refurbished offers in several currencies (PLN, EUR, USD).

---

## 5. Deliverables, in rounds

**Stop at the end of each round and wait for my feedback before continuing.**

### Round 1: Directions
Propose **three distinct visual directions**. For each, show:
- Wordmark/logo concept, palette (light and dark), and type pairing.
- Homepage hero + search, top section only.
- One product card.
- The top of the product detail page (title, image, key specs, first offers).

Add 2–3 sentences per direction on its rationale. I'll pick one or ask for a mix.

### Round 2: Design system + core desktop screens
**Design system:**
- Tokens: color (light/dark), type scale, spacing (4px base), radii, borders, elevation, breakpoints, grid/max widths.
- Components with all states (default, hover, focus, active, disabled, loading, empty, error): header with mega-menu for categories, search with suggestions dropdown (products with thumbnails, brands, categories as separate groups), market selector, buttons, inputs, selects, checkboxes, range slider, chips, tabs, breadcrumbs, pagination, product card, verification badge, spec table (grouped), offer row, stale-offer warning, affiliate disclosure, compare toggle, **compare tray** (floating, max 4, shows thumbnails), variant selector (segmented for storage/color/region), empty states, skeleton loaders, toast, demo banner, footer.

**Desktop screens (1440 px):**
1. **Homepage:** hero + search, categories, featured products, recently added, featured comparisons, brands, latest guides, footer.
2. **Category page** (e.g. Laptops): intro, subcategories, left filter sidebar with **category-specific filters** (RAM, screen size, refresh rate, weight…), sort, results grid, pagination.
3. **Product detail page:** breadcrumbs, gallery, name + model number + release info + status, verification badge, variant selector, key spec highlights, full grouped spec table, offers (selected market first, stale section, other markets collapsed, empty state variant), add-to-compare, predecessor/successor, alternatives, official/support links, data sources, related guides, "Suggest a correction" link.
4. **Comparison page** (3 products): sticky product header row with remove buttons and "Add product" slot, grouped spec rows, **difference highlighting** (rows that differ are emphasized; a subtle "better" marker only where higher/lower is meaningful, e.g. battery capacity), "Not available" cells, best offer per product, a "Show only differences" toggle.
5. **Search results:** query highlighting, exact model-number match shown prominently, grouped results, useful empty state.
6. **Brand page:** logo, overview, categories, latest and discontinued models.

### Round 3: Mobile, edge cases and admin
**Mobile (390 px):** homepage, category page with filters as a bottom sheet, product detail page (sticky "Compare" + "Offers" access), **comparison** (spec label stays visible while horizontally scrolling products, or a stacked alternative: propose the better one), search overlay, mobile navigation.

**Edge cases:** product with no image, no offers, few specs ("Needs review"), very long product names, 4-product comparison, out-of-stock-only offers, dark mode versions of the PDP and comparison.

**Admin (utilitarian, same tokens, denser):** dashboard with stats, product list table with status filters, product edit form (tabs: Details, Variants, Specifications, Images, Offers, Sources, Relationships), **CSV import preview** (row counts by create/update/skip/conflict/error, error rows with messages), and the verification queue (approve / reject / edit). Admin is functional, not decorative.

---

## 6. Technical constraints (for handoff to code)

The site will be built with **Next.js, Tailwind CSS, shadcn/ui and Lucide icons**. Design with that in mind:

- Map colors to shadcn-style CSS variables: `--background, --foreground, --card, --card-foreground, --popover, --muted, --muted-foreground, --primary, --primary-foreground, --secondary, --accent, --border, --input, --ring, --destructive`, plus custom `--success, --warning, --verified, --stale`. Provide values for light and dark.
- Use Lucide icons only.
- Components should be achievable by restyling shadcn/ui primitives; avoid bespoke widgets that would need heavy custom code unless they clearly earn it (the compare tray and spec table may).
- **Accessibility:** WCAG 2.2 AA contrast in both modes, visible focus states, minimum 44 px touch targets on mobile, status never conveyed by color alone (always icon or text too).
- Breakpoints: 390 / 768 / 1024 / 1440. Content max width around 1280 px; readable line length for guides.

## 7. Handoff (end of Round 3)

Deliver a short design notes page with: token table (light/dark), type scale, spacing and radius scales, component inventory with usage rules, layout grid, and any interaction details (tray behavior, sticky headers, filter sheet) a developer needs to implement it faithfully.

---

**Start with Round 1 now.**
</pasted_text>

<!-- The user explicitly selected the following skills for this project, as attachments to their message. These are not optional context — they define how you work. Use them. -->
<attached-skill name="Design Components">
This project uses Design Components: every design is a single streaming `Name.dc.html` file. The full authoring spec is in your system prompt under "Writing code — Design Components" — follow it. Author and edit `.dc.html` content with the `dc_write`, `dc_html_str_replace`, `dc_js_str_replace`, and `dc_set_props` tools (not `write_file`; `str_replace_edit` works but won't stream); template edits stream into the live preview as you type.
</attached-skill>

<attached-skill name="Industry (design system)">
[Design System] This project uses the **Industry** design system. This is a binding choice for visual style — every visual must follow it. Don't invent colors, type, spacing, or components not grounded here.

Scope: the design system is a visual style reference only. Its guide may describe example products, brands, or people that are unrelated to the user and unrelated to the subject of this conversation. Never treat anything in the design system as a fact about the user, their work, or the topic they asked about.

This project has the **Industry_indust** design system bound at `_ds/industry-4241ba5b-d6f7-4db9-9b11-1c4ec44daada/`. If anything under that path is missing or fails to load, the folder name may differ — `list_files` `_ds/` and use the folder whose name ends with 4241ba5b-d6f7-4db9-9b11-1c4ec44daada instead, including in the <link>/<script> paths below.

**Loading the bundle is how you use this design system.** Every Design Component you build must load `_ds/industry-4241ba5b-d6f7-4db9-9b11-1c4ec44daada/_ds_bundle.js` in `<helmet>` (include it in child DCs too — de-duped by URL) and compose with its components — do not recreate those components from scratch or restyle raw HTML to look like them. At the top of the template:

```html
<helmet>
  <link rel="stylesheet" href="_ds/industry-4241ba5b-d6f7-4db9-9b11-1c4ec44daada/styles.css">
  <script src="_ds/industry-4241ba5b-d6f7-4db9-9b11-1c4ec44daada/_ds_bundle.js"></script>
</helmet>
```

Then mount any component directly in the template — no logic class needed:

```html
<x-import component-from-global-scope="Industry_indust.Button" hint-size="auto,40px">Label</x-import>
```

Props are template attributes (kebab → camelCase); template children pass through as `props.children`. The linked stylesheet(s) carry the design tokens (colors, type, spacing) — style against those via `var(--*)` and the design system's classes rather than guessing values.

**Start from a template if one matches.** Before building from scratch, check whether a template below matches the user's request. Read the template (list its folder, `read_file` the entry) and decide: if it's close to what's asked, `copy_files` the folder as your starting point; if you'd rather re-author in DC, `dc_write` a new page using the template as your structural reference. When this design system is bound, `copy_files` repoints the copied `ds-base.js` automatically — only edit its base line yourself if the copy result says so, or when copying from an unbound project (change `'../..'` to your `_ds/industry-4241ba5b-d6f7-4db9-9b11-1c4ec44daada` path). (Older templates have no `ds-base.js` and carry `../../…` bundle/stylesheet refs in their pages instead — repoint those by hand.)

- `Deck` (`/projects/4241ba5b-d6f7-4db9-9b11-1c4ec44daada/templates/deck/`) — A twenty-one-slide presentation starter: cover, contents, dividers, columns, quadrants, a data table, SVG charts and timeline, bleed imagery, a quote and a close, on the theme's tokens
- `Landing` (`/projects/4241ba5b-d6f7-4db9-9b11-1c4ec44daada/templates/landing/`) — A one-page product landing in the system's own voice — an invented product (Holdfast: a fastener catalog), a condensed hero, a numbered spec-sheet plate, wireframe cells and a duotone photograph

The full design-system source tree lives at `/projects/4241ba5b-d6f7-4db9-9b11-1c4ec44daada/` — use `list_files` / `read_file` from there for anything not under `_ds/` (layout varies by brand; don't assume folder names). Its guide is reproduced below so you don't need to fetch it:

<design-system-guide>
# Industry design system

Industry is a wireframe: steel-blue on a light technical ground, Barlow Condensed headings over Barlow, a modular grid, and cards, figures and buttons framed as blueprint objects — square-cornered, hairline-bordered, with "+" registration marks at the corners. Cards and figures stay transparent line drawings; the primary button is the one solid object on the board, an accent fill that keeps the square corners and the marks. Photography is duotoned into the steel accent and icons are thin-stroke.

## How to use this

- Link the one stylesheet from every page — `&lt;link rel="stylesheet" href="styles.css"&gt;` (adjust the relative path) — and take every color, font, spacing, radius and shadow from its variables (`var(--color-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`, `var(--shadow-*)`). Never hard-code a hex, a font name or a px value the tokens already carry.
- Build with the classes below rather than inventing parallel ones; the component pages are plain HTML, so view source and copy the markup.
- `templates/` holds starting points a consuming project can copy whole.
- The whole system was derived from `theme.json`. To change the look, edit the tokens at the top of `styles.css` — every page, the thumbnail and this guide read from them — and keep `theme.json` and the written guidance in step so they don't drift from what the CSS actually does.

## Direction

Modular grid layouts — content in equal-width cells, strong horizontal and vertical rhythm, visible structure. Cards, buttons and major sections are wireframe objects: square-cornered, thin-bordered, with `+` crosshair corner marks (the `.blueprint` class + four `&lt;i class="corner tl/tr/bl/br"&gt;` children) — never soft filled rounded blocks. Images and figures get the same treatment: square, hairline-framed and marked, never rounded or clipped. Wrap hero and inline images in the `.duotone` class — they are desaturated and washed in the accent, like a screen print that re-colors with the theme.

## Color

A light ground (`--color-bg` #f2f2f3) with `--color-text` #1d1f20 and a single accent #5980a6 (this is a mono scheme: no second accent was chosen — the `--color-accent-2-*` variables carry a machine-derived stand-in kept only so both sets resolve; treat them as one role). Each role carries a 100–900 tonal ramp (`--color-neutral-100` … `--color-accent-2-900`) generated in OKLCH on a shared perceptual lightness scale, so the same step of any ramp has the same visual weight. Use the light steps (100–300) for tinted fills, hovers and subtle borders, 500 as the role's base, and the dark steps (700–900) for text on tinted fills and for pressed states; prefer ramp steps over ad-hoc `color-mix()`. For elevation use `--shadow-sm/md/lg` (already tuned to the ground) rather than ad-hoc box-shadows.

## Type

Barlow Condensed for headings over Barlow for body text, loaded as `--font-heading` / `--font-body`. Density 0.85× and radius 4px are already baked into the `--space-*` / `--radius-*` scales — use the variables, not raw numbers.

## Icons

Use Lucide icons (https://lucide.dev), at stroke-width 1.5 for a lighter, more technical look throughout.

## Interaction states

Interactive states are themed, never browser defaults: give every interactive element a `:hover` tint and a pressed state from the accent ramp (one step past the base — `--color-accent-600` on a light ground, `--color-accent-400` on a dark one, or a `color-mix()` tint for outlined/ghost variants), and style keyboard focus with `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }` — never leave the default blue focus ring.

## Components

| Class | What it is | Shown in |
| --- | --- | --- |
| `.btn` with `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-icon`, `.btn-block` | Actions — the primary is a solid accent fill | components/buttons.html |
| `.tag` with `.tag-accent`, `.tag-accent-2`, `.tag-neutral`, `.tag-outline` | Small labels tinted from the ramps (mono palette: accent-2 reads the same as accent) | components/buttons.html |
| `.field` + `label`, `.input`, `.radio` + `.dot`, `.seg` + `.seg-opt` | Form fields and choices on native elements — no script | components/forms.html |
| `.card` with `.card-kicker`, `.card-title`, `.card-body`, `.card-meta`; `.elev-sm/md/lg` | Transparent, hairline-bordered cards with corner registration marks | components/cards.html |
| `.nav` + `.nav-brand` | The header bar | components/navigation.html |
| `.table` | Data tables with themed header and row rules | components/table.html |
| `.dialog-backdrop` + `.dialog` (+ `.dialog-title/-body/-actions`) | A modal at the top elevation | components/dialog.html |
| `.hr` | A horizontal rule — present, but this system prefers whitespace; avoid it | — |
| `.blueprint` + four `&lt;i class="corner tl/tr/bl/br"&gt;` children | The wireframe frame every card, figure and primary button wears | components/cards.html |
| `.duotone` | The image wrapper — every content photograph goes through it | foundations/image.html |

States are built in: hovers and pressed states come from the accent ramp, keyboard focus is the 2px accent `:focus-visible` ring, `::selection` is an accent tint, and disabled controls drop to 45% opacity. Don't restyle them per page. The accent-to-ground pair is tuned to at least 3:1 — enough for icons, large text and interface chrome, not for body copy — so for paragraph-size text in the accent use a deep ramp step (`--color-accent-700` on this ground) rather than the accent itself.

## Do

- Frame cards, figures and primary buttons as blueprint objects: the `.blueprint` class plus four `&lt;i class="corner …"&gt;` marks.
- Keep the grid visible — equal cells, strong horizontal and vertical rhythm.
- Condense headings (Barlow Condensed) and keep body copy in Barlow.
- Duotone photographs with the `.duotone` wrapper so they take the accent.

## Don't

- Do not round cards, figures or buttons, and do not give cards or figures a surface fill — they are line drawings (the solid accent primary button is the one deliberate exception).
- Do not drop the registration marks from a framed element.
- Do not use thick icon strokes; the set is Lucide at 1.5.
- Do not add decorative color beyond the steel accent. The accent's own deep step (`--color-accent-900`) may carry a full field where the deck's section dividers use it — steel as ground, type reversed to paper. (The landing's numbers sit on a drawn spec-sheet plate on the paper ground instead — its own grammar, not a field.)

## Files

- `styles.css` — the only stylesheet: the token sheet (`:root` variables, ramps, base type) plus the component layer. Link it from every page.
- `readme.md` — this guide.
- `theme.json` — the parameters these files were derived from (a machine-readable record of the theme).
- `thumbnail.html` — the project cover (brand mark + swatches).
- `foundations/type.html` — the type scale and the heading/body pairing at real sizes.
- `foundations/color.html` — color roles and the 100-900 tonal ramps, with usage notes.
- `foundations/layout.html` — the spacing scale, the grid and how edges are drawn.
- `foundations/icons.html` — the icon set at interface sizes, inline and in buttons.
- `foundations/image.html` — how photographs and figures are treated.
- `components/buttons.html` — buttons, icon buttons and tags in every variant and state.
- `components/forms.html` — text fields, radios and the segmented control on native elements.
- `components/cards.html` — content cards and the elevation steps.
- `components/navigation.html` — the header bar pattern.
- `components/table.html` — a data table with the themed header and row rules.
- `components/dialog.html` — a modal over its backdrop at the top elevation.
- `theme.html` — the theme's parameters rendered as a reference sheet.
- `templates/landing/` — a starter page consuming the system the intended way (`index.html`, its `ds-base.js` loader, and the vendored `image-slot.js` its photograph mounts).
- `assets/photo.jpg` — the reference photograph the imagery page treats.

</design-system-guide>
</attached-skill>

## User

Found issues — fixing…

## User

<artifact-content-authored-by-others/>
Found issues — fixing…

## Assistant

_[tool: run_script]_

_[tool: ready_for_verification]_

The three boards were getting squeezed side by side, which made content spill out of its boxes. I've fixed the sizing so each stays at full 1280 px width and they wrap instead. It's being checked again now.

I also made three small fixes for the spills:
- **Palette labels:** the colour codes under the swatches now wrap instead of running out of their columns.
- **1c wordmark:** set slightly smaller so it fits its box.
- **1c spec readouts:** values like "5 000 mAh" can now wrap instead of overflowing.

The 1c status badges and the "Not available" cell should fit now that the board is full width, but that's not confirmed yet.

