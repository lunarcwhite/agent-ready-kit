// Taste Skill vendor preset content (MIT License, Copyright (c) 2026 Leonxlnx).
//
// Static content bundled with the application. These files are redistributed
// under the MIT License. The LICENSE file is included in the export.
//
// Source: https://github.com/Leonxlnx/taste-skill
// Install name: design-taste-frontend (and related skills)
//
// This module exports the skill files as AgentKitFile[] for the taste-skill
// vendor preset. The content is immutable — it is never modified by the
// adapter boundary.

import type { AgentKitFile } from "./compiler";

const TASTE_SKILL_FILES: AgentKitFile[] = [
  {
    path: "skills/taste-skill/SKILL.md",
    content: `---
name: design-taste-frontend
description: Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check.
---

# Taste Skill: Anti-Slop Frontend Skill

> Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI.
> Every rule below is **contextual**. None of it fires automatically. First read the brief, then pull only what fits.

## Brief Inference

Before touching code or tweaking dials, **infer what the user actually wants**. Most LLM design output is bad because the model jumps to a default aesthetic instead of reading the room.

### Read these signals first
1. **Page kind** - landing (SaaS / consumer / agency / event), portfolio (dev / designer / creative studio), redesign (preserve vs overhaul), editorial / blog.
2. **Vibe words** the user used - "minimalist", "calm", "Linear-style", "Awwwards", "brutalist", "premium consumer", "Apple-y", "playful", "serious B2B", "editorial", "agency-y", "glassy", "dark tech".
3. **Reference signals** - URLs they linked, screenshots they pasted, products they named, brands they're competing with.
4. **Audience** - B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio. The audience picks the aesthetic, not your taste.
5. **Brand assets that already exist** - logo, color, type, photography. For redesigns, these are starting material, not optional input.
6. **Quiet constraints** - accessibility-first audiences, public-sector, regulated industries, trust-first commerce, kids' products. These constraints OVERRIDE aesthetic preference.

### Output a one-line "Design Read" before generating
Before any code, state in one line: **"Reading this as: <page kind> for <audience>, with a <vibe> language, leaning toward <design system or aesthetic family>."**

### If the brief is ambiguous, ask one question, do not guess
Ask exactly **one** clarifying question - never a multi-question dump - and only when the design read genuinely diverges.

### Anti-Default Discipline
Do not default to: AI-purple gradients, centered hero over dark mesh, three equal feature cards, generic glassmorphism on everything, infinite-loop micro-animations everywhere, Inter + slate-900. These are the LLM defaults. Reach past them deliberately based on the design read.

## The Three Dials (Core Configuration)

After the design read, set three dials. Every layout, motion, and density decision below is gated by these.

* **DESIGN_VARIANCE: 8** - 1 = Perfect Symmetry, 10 = Artsy Chaos
* **MOTION_INTENSITY: 6** - 1 = Static, 10 = Cinematic / Physics
* **VISUAL_DENSITY: 4** - 1 = Art Gallery / Airy, 10 = Cockpit / Packed Data

**Baseline:** 8 / 6 / 4. Use these unless the design read overrides them. Do not ask the user to edit this file - overrides happen conversationally.

## Brief to Design System Map

Once you have the design read and dials, pick the right foundation. Do not invent CSS for things that have an official package.

### When to reach for a real design system (use official packages)
| Brief reads as... | Reach for | Why |
|---|---|---|
| Microsoft / enterprise SaaS / dashboards | @fluentui/react-components | Official Fluent UI, Microsoft tokens, accessibility done |
| Google-ish UI, Material-flavored product | @material/web + Material 3 tokens | Official, theme-able via Material Theming |
| IBM-style B2B / enterprise analytics | @carbon/react + @carbon/styles | Official Carbon, mature data-density patterns |
| GitHub-style devtool / community page | @primer/css or @primer/react-brand | Official Primer; Brand variant for marketing |
| Public-sector UK service | govuk-frontend | Legally / regulatorily expected |
| US public-sector / trust-first | uswds | Same |
| Modern accessible React foundation | @radix-ui/themes | Primitives + polished theme |
| Modern SaaS where you own the components | shadcn/ui | You own the code, easy to customise; never ship default state |
| Tailwind-based modern SaaS / AI marketing | Tailwind v4 utilities + dark: variant | Default for indie + small team builds |

**Honesty rule:** if the brief reads as one of the systems above, install and use the **official** package. Do not recreate its CSS by hand.

**One system per project.** Do not mix Fluent React with Carbon in the same tree.

## Default Architecture & Conventions

### Stack
* **Framework:** React or Next.js. Default to Server Components (RSC).
* **Styling:** Tailwind v4 (default). Tailwind v3 only if the existing project demands it.
* **Animation:** Motion (the library formerly known as Framer Motion). Import from motion/react.
* **Fonts:** Always use next/font (Next.js) or self-host with @font-face + font-display: swap. Never link Google Fonts via <link> in production.

### State
* Local useState / useReducer for isolated UI.
* Global state ONLY for deep prop-drilling avoidance - Zustand, Jotai, or React context.
* **NEVER** use useState to track continuous values driven by user input. Use Motion's useMotionValue / useTransform / useScroll.

### Icons
* **Allowed libraries:** @phosphor-icons/react, hugeicons-react, @radix-ui/react-icons, @tabler/icons-react.
* **Discouraged:** lucide-react.
* **NEVER hand-roll SVG icons.**
* **One family per project.**

### Responsiveness & Layout Mechanics
* Standardize breakpoints (sm 640, md 768, lg 1024, xl 1280, 2xl 1536).
* Contain page layouts using max-w-[1400px] mx-auto or max-w-7xl.
* **Viewport Stability:** NEVER use h-screen for full-height Hero sections. ALWAYS use min-h-[100dvh].
* **Grid over Flex-Math:** NEVER use complex flexbox percentage math. ALWAYS use CSS Grid.

## Design Engineering Directives

### Typography
* **Display / Headlines:** Default text-4xl md:text-6xl tracking-tighter leading-none.
* **Body / Paragraphs:** Default text-base text-gray-600 leading-relaxed max-w-[65ch].
* **Sans font choice:** Discouraged as default: Inter. Pick Geist, Outfit, Cabinet Grotesk, Satoshi, or a brand-appropriate serif first.
* **SERIF DISCIPLINE:** Serif is very discouraged as the default font for any project.

### Color Calibration
* Max 1 accent color. Saturation < 80% by default.
* **THE LILA RULE:** The "AI Purple / Blue glow" aesthetic is discouraged as a default.
* **One palette per project.** Do not fluctuate between warm and cool grays within the same project.
* **COLOR CONSISTENCY LOCK:** Once an accent color is chosen for a page, it is used on the WHOLE page.

### Layout Diversification
* **ANTI-CENTER BIAS:** Centered Hero / H1 sections are avoided when DESIGN_VARIANCE > 4.
* **BENTO CELL COUNT RULE:** A bento grid has EXACTLY as many cells as you have content for.
* **Section-Layout-Repetition Ban.** Once you use a layout family for a section, that family can appear at most ONCE on the page.
* **EYEBROW RESTRAINT:** Maximum 1 eyebrow per 3 sections.

### Interactive UI States
* **Loading:** Skeletal loaders matching the final layout's shape.
* **Empty States:** Beautifully composed; indicate how to populate.
* **Error States:** Clear, inline (forms), or contextual (toasts only for transient).
* **Tactile Feedback:** On :active, use -translate-y-[1px] or scale-[0.98].
* **BUTTON CONTRAST CHECK:** Before shipping any button, verify the button text is readable against the button background. WCAG AA min (4.5:1 for body, 3:1 for large text).
* **CTA BUTTON WRAP BAN:** Button text MUST fit on one line at desktop.
* **NO DUPLICATE CTA INTENT:** Two CTAs with the same intent on one page is a Pre-Flight Fail.

### Image & Visual Asset Strategy
1. **Image-generation tool first.** If ANY image-gen tool is available, you MUST use it.
2. **Real web images second.** Use picsum.photos/seed/{descriptive-seed}/{w}/{h} for placeholder photography.
3. **Last resort: tell the user.** Do NOT fill the page with hand-rolled SVG illustrations or div-based "fake screenshots."

**Hero needs a real visual.** Text + gradient blob is not a hero - it's a placeholder.

## Performance & Accessibility Guardrails

### Hardware Acceleration
* Animate ONLY transform and opacity. Never animate top, left, width, height.
* Use will-change: transform sparingly.

### Reduced Motion (mandatory)
* **Any motion above MOTION_INTENSITY > 3 MUST honor prefers-reduced-motion.** This is non-negotiable.

### Dark Mode (mandatory for any consumer-facing page)
* Design for **both modes from the start**. Never ship light-only or dark-only without explicit user instruction.

### Core Web Vitals Targets
* **LCP** < 2.5s. Hero image must be next/image priority or preloaded.
* **INP** < 200ms. Heavy work off main thread.
* **CLS** < 0.1. Reserve space for images, fonts, embeds.

## AI Tells (Forbidden Patterns)

### Visual & CSS
* **NO neon / outer glows** by default.
* **NO pure black (#000000).** Off-black, zinc-950, or charcoal.
* **NO oversaturated accents.**
* **NO excessive gradient text** for large headers.
* **NO custom mouse cursors.**

### Typography
* **AVOID Inter as default.**
* **NO oversized H1s** that just scream.
* **Serif constraints:** Serif for editorial / luxury / publication. Not for dashboards.

### Layout & Spacing
* **NO 3-column card layouts** as default feature rows.
* **NO h-screen** for full-height sections. Use min-h-[100dvh].
* **NO complex flexbox percentage math.** Use CSS Grid.
* **NO placeholder-as-label in forms.** Label above input, always.
* **NO generic card look** (border + shadow + white background) as default.
* **NO "filler" UI elements** that don't serve the user.
* **NO infinite scroll hijack** unless the brief explicitly calls for it.
* **NO scroll-triggered animations** that don't communicate hierarchy, storytelling, feedback, or state transition.

### Content
* **NO generic names** ("John Doe", "Acme Corp", "Nexus", "Flowbit").
* **NO fake round numbers** (99.99%, 50%, $100.00). Use organic, messy data.
* **NO AI copywriting cliches** ("Elevate", "Seamless", "Unleash", "Next-Gen", "Game-changer", "Delve", "Tapestry", "In the world of...").
* **NO exclamation marks** in success messages.
* **NO "Oops!" error messages.** Be direct: "Connection failed. Please try again."
* **NO passive voice.**
* **NO lorem ipsum.**
* **NO title case on every header.** Use sentence case instead.

### Em-Dash Ban
* **NO em-dashes or en-dashes** anywhere in output copy. Use a hyphen or restructure the sentence.

## Pre-Flight Check

Before delivering any page, run this audit in writing:

1. **Em-dash audit** - zero em-dashes or en-dashes anywhere.
2. **Hero discipline** - headline 2 lines or less, subtext 20 words or less, CTAs visible without scroll.
3. **Section-Layout-Repetition audit** - list each section's layout family. No family appears more than once.
4. **Eyebrow count** - uppercase tracking instances <= ceil(sectionCount / 3).
5. **Button contrast** - every CTA passes WCAG AA.
6. **Form contrast** - every input, placeholder, focus ring, helper text, error text passes WCAG AA.
7. **Color consistency** - one accent color, locked across the whole page.
8. **Shape consistency** - one corner-radius scale, locked across the whole page.
9. **Typography** - no Inter as default, no serif as default (unless justified), no oversized H1s.
10. **Images** - hero has a real visual, not a gradient blob. At least 2-3 real images on the page.
11. **Motion** - all animations use transform and opacity only. All honor prefers-reduced-motion.
12. **Dark mode** - page works in both light and dark mode.
13. **Performance** - LCP < 2.5s, INP < 200ms, CLS < 0.1.
14. **Accessibility** - semantic HTML, proper labels, sufficient contrast, keyboard navigable.
15. **AI tells** - no banned patterns from above.

Any Fail blocks completion.
`,
  },
  {
    path: "skills/taste-skill-v1/SKILL.md",
    content: `---
name: design-taste-frontend-v1
description: The original v1 taste-skill, preserved for projects depending on its exact behavior. The current default is design-taste-frontend (v2 experimental), which is a substantial rewrite. Use this v1 install name only if you need exact backward compatibility.
---

# High-Agency Frontend Skill (v1)

## Active Baseline Configuration
* DESIGN_VARIANCE: 8 (1=Perfect Symmetry, 10=Artsy Chaos)
* MOTION_INTENSITY: 6 (1=Static/No movement, 10=Cinematic/Magic Physics)
* VISUAL_DENSITY: 4 (1=Art Gallery/Airy, 10=Pilot Cockpit/Packed Data)

## Default Architecture & Conventions

* **Framework:** React or Next.js. Default to Server Components (RSC).
* **Styling:** Tailwind CSS (v3/v4) for 90% of styling.
* **Icons:** @phosphor-icons/react or @radix-ui/react-icons.
* **Responsiveness:** Standardize breakpoints. NEVER use h-screen for full-height Hero sections. ALWAYS use min-h-[100dvh].
* **Grid over Flex-Math:** ALWAYS use CSS Grid for reliable structures.

## Design Engineering Directives

### Typography
* **Display/Headlines:** Default to text-4xl md:text-6xl tracking-tighter leading-none.
* **Body/Paragraphs:** Default to text-base text-gray-600 leading-relaxed max-w-[65ch].
* **ANTI-SLOP:** Discourage Inter for "Premium" or "Creative" vibes. Force unique character using Geist, Outfit, Cabinet Grotesk, or Satoshi.
* **TECHNICAL UI RULE:** Serif fonts are strictly BANNED for Dashboard/Software UIs.

### Color Calibration
* Max 1 Accent Color. Saturation < 80%.
* **THE LILA BAN:** The "AI Purple/Blue" aesthetic is strictly BANNED.
* **COLOR CONSISTENCY:** Stick to one palette for the entire output.

### Layout Diversification
* **ANTI-CENTER BIAS:** Centered Hero/H1 sections are strictly BANNED when DESIGN_VARIANCE > 4.

### Materiality, Shadows, and "Anti-Card Overuse"
* Use cards ONLY when elevation communicates hierarchy.
* For VISUAL_DENSITY > 7, generic card containers are strictly BANNED.

### Interactive UI States
* **Loading:** Skeletal loaders matching layout sizes.
* **Empty States:** Beautifully composed empty states.
* **Error States:** Clear, inline error reporting.
* **Tactile Feedback:** On :active, use -translate-y-[1px] or scale-[0.98].

### Data & Form Patterns
* **Forms:** Label MUST sit above input. Error text below input.

## Creative Proactivity (Anti-Slop Implementation)

* **"Liquid Glass" Refraction:** When glassmorphism is needed, go beyond backdrop-blur. Add a 1px inner border and a subtle inner shadow.
* **Magnetic Micro-Physics:** Implement buttons that pull slightly toward the mouse cursor. NEVER use React useState for magnetic hover.
* **Perpetual Micro-Interactions:** When MOTION_INTENSITY > 5, embed continuous, infinite micro-animations in standard components.
* **Layout Transitions:** Always utilize Framer Motion's layout and layoutId props.
* **Staggered Orchestration:** Do not mount lists or grids instantly. Use staggerChildren or CSS cascade.

## Performance Guardrails

* **DOM Cost:** Apply grain/noise filters exclusively to fixed, pointer-event-none pseudo-elements.
* **Hardware Acceleration:** Never animate top, left, width, or height. Animate exclusively via transform and opacity.
* **Z-Index Restraint:** NEVER spam arbitrary z-50 or z-10.

## AI Tells (Forbidden Patterns)

* **NO Neon/Outer Glows**
* **NO Pure Black**
* **NO Oversaturated Accents**
* **NO Excessive Gradient Text**
* **NO Custom Mouse Cursors**
* **NO Inter Font** (for premium/creative contexts)
* **NO Oversized H1s**
* **NO 3-Column Card Layouts** (as default)
* **NO Generic Names** ("John Doe", "Acme Corp", "Nexus", "SmartFlow")
* **NO Fake Numbers** (99.99%, 50%, $100.00)
* **NO AI Cliches** ("Elevate", "Seamless", "Unleash", "Next-Gen")
* **NO Broken Unsplash Links**
* **NO Lorem Ipsum**

## Final Pre-Flight Check

- [ ] Is global state used appropriately to avoid deep prop-drilling?
- [ ] Is mobile layout collapse guaranteed for high-variance designs?
- [ ] Do full-height sections safely use min-h-[100dvh]?
- [ ] Do useEffect animations contain strict cleanup functions?
- [ ] Are empty, loading, and error states provided?
- [ ] Are cards omitted in favor of spacing where possible?
- [ ] Did you strictly isolate CPU-heavy perpetual animations in their own Client Components?
`,
  },
  {
    path: "skills/gpt-tasteskill/SKILL.md",
    content: `---
name: gpt-taste
description: Elite UX/UI & Advanced GSAP Motion Engineer. Enforces Python-driven true randomization for layout variance, strict AIDA page structure, wide editorial typography (bans 6-line wraps), gapless bento grids, strict GSAP ScrollTriggers (pinning, stacking, scrubbing), inline micro-images, and massive section spacing.
---

# Elite UX/UI & Advanced GSAP Motion Engineer

## Python-Driven True Randomization
LLMs are inherently lazy and always pick the first layout option. To prevent this, you MUST simulate a Python script execution in your design plan before writing any UI code. Use a deterministic seed to simulate random.choice() and strictly select:
- 1 Hero Architecture
- 1 Typography Stack (Satoshi, Cabinet Grotesk, Outfit, or Geist. NEVER Inter)
- 3 Unique Component Architectures
- 2 Advanced GSAP Paradigms

## AIDA Structure & Spacing
Every page MUST begin with a highly creative, premium Navigation Bar. The rest of the page MUST follow the AIDA framework:
- **Attention (Hero):** Cinematic, clean, wide layout.
- **Interest (Features/Bento):** High-density, mathematically perfect grid.
- **Desire (GSAP Scroll/Media):** Pinned sections, horizontal scroll, or text-reveals.
- **Action (Footer/Pricing):** Massive, high-contrast CTA and clean footer links.

**SPACING RULE:** Add huge vertical padding between all major sections (e.g., py-32 md:py-48).

## Hero Architecture & The 2-Line Iron Rule
The Hero must breathe. It must NOT be a narrow, 6-line text wall.
- **The Container Width Fix:** You MUST use ultra-wide containers for the H1.
- **The Line Limit:** The H1 MUST NEVER exceed 2 to 3 lines.
- **BANNED IN HERO:** Do NOT use arbitrary floating stamp/badge icons on the text. Do NOT use pill-tags under the hero.

## The Gapless Bento Grid
- **Zero Empty Space in Grids:** You MUST use Tailwind's grid-flow-dense on every Bento Grid.
- **Card Restraint:** 3 to 5 highly intentional cards are better than 8 messy ones.

## Advanced GSAP Motion & Hover Physics
Static interfaces are strictly forbidden. You must write real GSAP (@gsap/react, ScrollTrigger).
- **Hover Physics:** Every clickable card and image must react.
- **Scroll Pinning:** Pin a section title on the left while a gallery scrolls on the right.
- **Image Scale & Fade Scroll:** Images must start small (scale: 0.8) and grow to scale: 1.0.
- **Scrubbing Text Reveals:** Opacity of central paragraph words starts at 0.1 and scrubs to 1.0.
- **Card Stacking:** Cards overlap and stack on top of each other dynamically.

## Component Arsenal
- **Inline Typography Images:** Embed small, pill-shaped images directly INSIDE massive headings.
- **Horizontal Accordions:** Vertical slices that expand horizontally on hover.
- **Infinite Marquee:** Smooth, continuously scrolling rows.
- **Feedback/Testimonial Carousel:** Clean, overlapping portrait images next to minimalist typography quotes.

## Content, Assets & Strict Bans
- **The Meta-Label Ban:** BANNED FOREVER are labels like "SECTION 01", "QUESTION 05", "ABOUT US".
- **Image Context & Style:** Use https://picsum.photos/seed/{keyword}/1920/1080 and match the keyword to the vibe.
- **Horizontal Scroll Bug:** Wrap the entire page in <main className="overflow-x-hidden w-full max-w-full">.

## Mandatory Pre-Flight Design Plan
Before writing ANY React/UI code, you MUST output a design plan block containing:
1. **Python RNG Execution:** Show the deterministic selection of your Hero Layout, Component Arsenal, GSAP animations, and Fonts.
2. **AIDA Check:** Confirm the page contains Navigation, Attention, Interest, Desire, Action.
3. **Hero Math Verification:** Explicitly state the max-w class you are applying to the H1.
4. **Bento Density Verification:** Prove mathematically that your grid columns and rows leave zero empty spaces.
5. **Label Sweep & Button Check:** Confirm no cheap meta-labels exist, and button text contrast is perfect.
`,
  },
  {
    path: "skills/image-to-code-skill/SKILL.md",
    content: `---
name: image-to-code
description: Elite website image-to-code skill for Codex. For visually important web tasks, it must first generate the design image(s) itself, deeply analyze them, then implement the website to match them as closely as possible.
---

# Elite Website Image-to-Core Skill

## Core Directive
You are an elite web design art director and implementation strategist. Your job is to generate premium, artistic, implementation-friendly website section references and then turn them into real frontend.

The required workflow is: image generation first, deep image analysis second, implementation third.

## Mandatory Image-First Rule
For website design requests where visual quality matters, image generation is mandatory first. Do not start with freeform coding. The generated image(s) are the primary visual source of truth.

## Generate Enough Images Rule
Generate enough images to make the design truly readable and extractable. It is better to generate too many clear images than too few compressed images.

## Do Not Crop Old Images Rule
When a section needs a dedicated image, generate a fresh new image. Do not crop, cut out, zoom into, or slice from a previously generated larger image.

## Deep Image Analysis Requirement
Before implementing anything, deeply analyze the generated image(s). Treat them like a design specification. Extract: exact visible text, typography relationships, spacing relationships, buttons and controls, color palette, layout structure, section ordering, visual rhythm.

## Anti-AI-Slop Rules
Strictly avoid: endless centered sections, identical card rows, cloned left-text/right-image blocks, default purple/blue AI gradients, too many glowing edges, floating blobs everywhere, giant heading + weak tiny subcopy, generic filler vibes (unleash, elevate, revolutionize, next-gen, seamless), fake brand slop (Acme, Nexus, Flowbit, Quantumly, NovaCore).

## Typography-First Discipline
Always ensure: clear size contrast, obvious reading order, strong display moments, readable body text, concise copy, section headings that reinforce structure.

## Section Rhythm Rule
Vary section rhythm across the page by changing: density, image-to-text ratio, alignment, scale, whitespace, card grouping, background intensity, visual tempo.

## Clarity Check
Before finalizing, verify internally: Is the hierarchy obvious? Is the hero clean enough? Is the design visually distinctive? Is it free of obvious AI tells? Can someone code from this?
`,
  },
  {
    path: "skills/redesign-skill/SKILL.md",
    content: `---
name: redesign-existing-projects
description: Upgrades existing websites and apps to premium quality. Audits current design, identifies generic AI patterns, and applies high-end design standards without breaking functionality. Works with any CSS framework or vanilla CSS.
---

# Redesign Skill

## How This Works
1. **Scan** - Read the codebase. Identify the framework, styling method, and current design patterns.
2. **Diagnose** - Run through the audit below. List every generic pattern, weak point, and missing state you find.
3. **Fix** - Apply targeted upgrades working with the existing stack. Do not rewrite from scratch. Improve what is there.

## Design Audit

### Typography
- Browser default fonts or Inter everywhere. Replace with Geist, Outfit, Cabinet Grotesk, Satoshi.
- Headlines lack presence. Increase size for display text, tighten letter-spacing, reduce line-height.
- Body text too wide. Limit paragraph width to roughly 65 characters.
- Only Regular (400) and Bold (700) weights used. Introduce Medium (500) and SemiBold (600).
- Numbers in proportional font. Use a monospace font or enable tabular figures.
- All-caps subheaders everywhere. Try lowercase italics, sentence case, or small-caps instead.
- Orphaned words. Fix with text-wrap: balance or text-wrap: pretty.

### Color and Surfaces
- Pure #000000 background. Replace with off-black, dark charcoal, or tinted dark.
- Oversaturated accent colors. Keep saturation below 80%.
- More than one accent color. Pick one. Remove the rest.
- Mixing warm and cool grays. Stick to one gray family.
- Purple/blue "AI gradient" aesthetic. Replace with neutral bases and a single, considered accent.
- Generic box-shadow. Tint shadows to match the background hue.
- Flat design with zero texture. Add subtle noise, grain, or micro-patterns.
- Random dark sections in a light mode page. Commit to a full dark mode or keep a consistent background tone.

### Layout
- Everything centered and symmetrical. Break symmetry with offset margins, mixed aspect ratios, or left-aligned headers.
- Three equal card columns as feature row. Replace with a 2-column zig-zag, asymmetric grid, horizontal scroll, or masonry layout.
- Using height: 100vh for full-screen sections. Replace with min-height: 100dvh.
- Complex flexbox percentage math. Replace with CSS Grid.
- No max-width container. Add a container constraint (around 1200-1440px).
- Cards of equal height forced by flexbox. Allow variable heights or use masonry.
- Uniform border-radius on everything. Vary the radius.
- No overlap or depth. Use negative margins to create layering and visual depth.
- Missing whitespace. Double the spacing. Let the design breathe.

### Interactivity and States
- No hover states on buttons. Add background shift, slight scale, or translate on hover.
- No active/pressed feedback. Add a subtle scale(0.98) or translateY(1px) on press.
- Instant transitions with zero duration. Add smooth transitions (200-300ms).
- Missing focus ring. Ensure visible focus indicators for keyboard navigation.
- No loading states. Replace generic circular spinners with skeleton loaders.
- No empty states. Design a composed "getting started" view.
- No error states. Add clear, inline error messages for forms.
- Dead links. Either link to real destinations or visually disable them.
- Animations using top, left, width, height. Switch to transform and opacity.

### Content
- Generic names like "John Doe" or "Jane Smith". Use diverse, realistic-sounding names.
- Fake round numbers like 99.99%, 50%, $100.00. Use organic, messy data.
- Placeholder company names like "Acme Corp", "Nexus", "SmartFlow". Invent contextual, believable brand names.
- AI copywriting cliches. Never use "Elevate", "Seamless", "Unleash", "Next-Gen", "Game-changer", "Delve", "Tapestry", or "In the world of...".
- Exclamation marks in success messages. Remove them.
- "Oops!" error messages. Be direct: "Connection failed. Please try again."
- Passive voice. Use active voice.
- Lorem Ipsum. Never use placeholder latin text.
- Title Case On Every Header. Use sentence case instead.

### Component Patterns
- Generic card look (border + shadow + white background). Remove the border, or use only background color, or use only spacing.
- Always one filled button + one ghost button. Add text links or tertiary styles.
- Pill-shaped "New" and "Beta" badges. Try square badges, flags, or plain text labels.
- 3-card carousel testimonials with dots. Replace with a masonry wall, embedded social posts, or a single rotating quote.
- Pricing table with 3 towers. Highlight the recommended tier with color and emphasis.
- Avatar circles exclusively. Try squircles or rounded squares.
- Footer link farm with 4 columns. Simplify. Focus on main navigational paths.

### Iconography
- Lucide or Feather icons exclusively. Use Phosphor, Heroicons, or a custom set.
- Rocketship for "Launch", shield for "Security". Replace cliche metaphors with less obvious icons.
- Inconsistent stroke widths across icons. Standardize to one stroke weight.
- Missing favicon. Always include a branded favicon.

### Code Quality
- Div soup. Use semantic HTML.
- Inline styles mixed with CSS classes. Move all styling to the project's styling system.
- Hardcoded pixel widths. Use relative units.
- Missing alt text on images. Describe image content for screen readers.
- Arbitrary z-index values like 9999. Establish a clean z-index scale.
- Commented-out dead code. Remove all debug artifacts.
- Import hallucinations. Check that every import actually exists.
- Missing meta tags. Add proper title, description, og:image.

## Fix Priority
1. Font swap - biggest instant improvement, lowest risk
2. Color palette cleanup - remove clashing or oversaturated colors
3. Hover and active states - makes the interface feel alive
4. Layout and spacing - proper grid, max-width, consistent padding
5. Replace generic components - swap cliche patterns for modern alternatives
6. Add loading, empty, and error states - makes it feel finished
7. Polish typography scale and spacing - the premium final touch

## Rules
- Work with the existing tech stack. Do not migrate frameworks or styling libraries.
- Do not break existing functionality. Test after every change.
- Before importing any new library, check the project's dependency file first.
- Keep changes reviewable and focused. Small, targeted improvements over big rewrites.
`,
  },
  {
    path: "skills/soft-skill/SKILL.md",
    content: `---
name: high-end-visual-design
description: Teaches the AI to design like a high-end agency. Defines the exact fonts, spacing, shadows, card structures, and animations that make a website feel expensive. Blocks all the common defaults that make AI designs look cheap or generic.
---

# High-End Visual Design Skill

## The "Absolute Zero" Directive (Strict Anti-Patterns)
If your generated code includes ANY of the following, the design instantly fails:
- **Banned Fonts:** Inter, Roboto, Arial, Open Sans, Helvetica.
- **Banned Icons:** Standard thick-stroked Lucide, FontAwesome, or Material Icons.
- **Banned Borders & Shadows:** Generic 1px solid gray borders. Harsh, dark drop shadows.
- **Banned Layouts:** Edge-to-edge sticky navbars glued to the top. Symmetrical, boring 3-column Bootstrap-style grids.
- **Banned Motion:** Standard linear or ease-in-out transitions. Instant state changes without interpolation.

## The Creative Variance Engine
Before writing code, silently select ONE combination from the following archetypes:

### Vibe & Texture Archetypes (Pick 1)
1. **Ethereal Glass (SaaS / AI / Tech):** Deepest OLED black, radial mesh gradients, Vantablack cards with heavy backdrop-blur-2xl.
2. **Editorial Luxury (Lifestyle / Real Estate / Agency):** Warm creams, muted sage, or deep espresso tones. High-contrast Variable Serif fonts.
3. **Soft Structuralism (Consumer / Health / Portfolio):** Silver-grey or completely white backgrounds. Massive bold Grotesk typography.

### Layout Archetypes (Pick 1)
1. **The Asymmetrical Bento:** A masonry-like CSS Grid of varying card sizes.
2. **The Z-Axis Cascade:** Elements are stacked like physical cards, slightly overlapping each other with varying depths of field.
3. **The Editorial Split:** Massive typography on the left half, with interactive, scrollable horizontal image pills on the right.

## Haptic Micro-Aesthetics

### The "Double-Bezel" (Nested Architecture)
Never place a premium card, image, or container flatly on the background. They must look like physical, machined hardware using nested enclosures.
- **Outer Shell:** A wrapper div with a subtle background, a hairline outer border, a specific padding, and a large outer radius.
- **Inner Core:** The actual content container inside the shell with its own distinct background color, its own inner highlight, and a mathematically calculated smaller radius.

### Nested CTA & "Island" Button Architecture
- **Structure:** Primary interactive buttons must be fully rounded pills with generous padding.
- **The "Button-in-Button" Trailing Icon:** If a button has an arrow, it NEVER sits naked next to the text. It must be nested inside its own distinct circular wrapper.

### Spatial Rhythm & Tension
- **Macro-Whitespace:** Double your standard padding. Use py-24 to py-40 for sections.
- **Eyebrow Tags:** Precede major H1/H2s with a microscopic, pill-shaped badge.

## Motion Choreography
Never use default transitions. All motion must simulate real-world mass and spring physics.

### Magnetic Button Hover Physics
- Use the group utility. On hover, do not just change the background color.
- Scale the entire button down slightly (active:scale-[0.98]).
- The nested inner icon circle should translate diagonally and scale up slightly.

### Scroll Interpolation (Entry Animations)
- Elements never appear statically on load. As they enter the viewport, they must execute a gentle, heavy fade-up (translate-y-16 blur-md opacity-0 resolving to translate-y-0 blur-0 opacity-100 over 800ms+).

## Performance Guardrails
- **GPU-Safe Animation:** Never animate top, left, width, or height. Animate exclusively via transform and opacity.
- **Blur Constraints:** Apply backdrop-blur only to fixed or sticky elements. Never apply blur filters to scrolling containers.
- **Z-Index Discipline:** Do not use arbitrary z-50 or z-[9999].

## Execution Protocol
1. Roll the Variance Engine. Choose your Vibe and Layout Archetypes.
2. Establish the background texture, macro-whitespace scale, and massive typography sizes.
3. Build the DOM strictly using the "Double-Bezel" technique for all major cards.
4. Inject the custom cubic-bezier transitions, the staggered navigation reveals, and the button-in-button hover physics.
5. Deliver flawless, pixel-perfect React/Tailwind/HTML code.

## Pre-Output Checklist
- [ ] No banned fonts, icons, borders, shadows, layouts, or motion patterns
- [ ] A Vibe Archetype and Layout Archetype were consciously selected and applied
- [ ] All major cards and containers use the Double-Bezel nested architecture
- [ ] CTA buttons use the Button-in-Button trailing icon pattern where applicable
- [ ] Section padding is at minimum py-24
- [ ] All transitions use custom cubic-bezier curves
- [ ] Scroll entry animations are present
- [ ] Layout collapses gracefully below 768px to single-column
- [ ] All animations use only transform and opacity
- [ ] backdrop-blur is only applied to fixed/sticky elements
`,
  },
  {
    path: "skills/minimalist-skill/SKILL.md",
    content: `---
name: minimalist-ui
description: Clean editorial-style interfaces. Warm monochrome palette, typographic contrast, flat bento grids, muted pastels. No gradients, no heavy shadows.
---

# Premium Utilitarian Minimalism UI

## Absolute Negative Constraints (Banned Elements)
- DO NOT use the "Inter", "Roboto", or "Open Sans" typefaces.
- DO NOT use generic, thin-line icon libraries like "Lucide", "Feather", or standard "Heroicons".
- DO NOT use Tailwind's default heavy drop shadows. Shadows must be practically non-existent or heavily customized to be ultra-diffuse and low opacity (< 0.05).
- DO NOT use primary colored backgrounds for large elements or sections.
- DO NOT use gradients, neon colors, or 3D glassmorphism (beyond subtle navbar blurs).
- DO NOT use rounded-full (pill shapes) for large containers, cards, or primary buttons.
- DO NOT use emojis anywhere in code, markup, text content, headings, or alt text.
- DO NOT use generic placeholder names like "John Doe", "Acme Corp", or "Lorem Ipsum".
- DO NOT use AI copywriting cliches: "Elevate", "Seamless", "Unleash", "Next-Gen", "Game-changer", "Delve".

## Typographic Architecture
- Primary Sans-Serif (Body, UI, Buttons): Use clean, geometric, or system-native fonts with character. Target: font-family: 'SF Pro Display', 'Geist Sans', 'Helvetica Neue', 'Switzer', sans-serif.
- Editorial Serif (Hero Headings & Quotes): Target: font-family: 'Lyon Text', 'Newsreader', 'Playfair Display', 'Instrument Serif', serif.
- Monospace (Code, Keystrokes, Meta-data): Target: font-family: 'Geist Mono', 'SF Mono', 'JetBrains Mono', monospace.
- Text Colors: Body text must never be absolute black (#000000). Use off-black/charcoal (#111111 or #2F3437) with a generous line-height of 1.6 for legibility.

## Color Palette (Warm Monochrome + Spot Pastels)
- Canvas / Background: Pure White #FFFFFF or Warm Bone/Off-White #F7F6F3 / #FBFBFA.
- Primary Surface (Cards): #FFFFFF or #F9F9F8.
- Structural Borders / Dividers: Ultra-light gray #EAEAEA or rgba(0,0,0,0.06).
- Accent Colors: Exclusively use highly desaturated, washed-out pastels for tags, inline code backgrounds, or subtle icon backgrounds.
  - Pale Red: #FDEBEC (Text: #9F2F2D)
  - Pale Blue: #E1F3FE (Text: #1F6C9F)
  - Pale Green: #EDF3EC (Text: #346538)
  - Pale Yellow: #FBF3DB (Text: #956400)

## Component Specifications
- Bento Box Feature Grids: Utilize asymmetrical CSS Grid layouts. Cards must have exactly border: 1px solid #EAEAEA. Border-radius must be crisp: 8px or 12px maximum.
- Primary Call-To-Action (Buttons): Solid background #111111, text #FFFFFF. Slight border-radius (4px to 6px). No box-shadow.
- Tags & Status Badges: Pill-shaped (border-radius: 9999px), very small typography (text-xs), uppercase with wide tracking (letter-spacing: 0.05em). Background must use the defined Muted Pastels.
- Accordions (FAQ): Strip all container boxes. Separate items only with a border-bottom: 1px solid #EAEAEA.

## Iconography & Imagery Directives
- System Icons: Use "Phosphor Icons (Bold or Fill weights)" or "Radix UI Icons" for a technical, slightly thicker-stroke aesthetic.
- Illustrations: Monochromatic, rough continuous-line ink sketches on a white background.
- Photography: Use high-quality, desaturated images with a warm tone. Apply subtle overlays (opacity: 0.04 warm grain).

## Subtle Motion & Micro-Animations
- Scroll Entry: Elements fade in gently as they enter the viewport. Use translateY(12px) + opacity: 0 resolving over 600ms with cubic-bezier(0.16, 1, 0.3, 1).
- Hover States: Cards lift with an ultra-subtle shadow shift. Buttons respond with scale(0.98) on :active.
- Staggered Reveals: Lists and grid items enter with a cascade delay (animation-delay: calc(var(--index) * 80ms)).

## Execution Protocol
1. Establish the macro-whitespace first. Use massive vertical padding between sections (e.g., py-24 or py-32 in Tailwind).
2. Constrain the main typography content width to max-w-4xl or max-w-5xl.
3. Apply the custom typographic hierarchy and monochromatic color variables immediately.
4. Ensure every card, divider, and border adheres strictly to the 1px solid #EAEAEA rule.
5. Add scroll-entry animations to all major content blocks.
6. Ensure sections have visual depth through imagery, ambient gradients, or subtle textures.
`,
  },
  {
    path: "skills/brutalist-skill/SKILL.md",
    content: `---
name: industrial-brutalist-ui
description: Raw mechanical interfaces fusing Swiss typographic print with military terminal aesthetics. Rigid grids, extreme type scale contrast, utilitarian color, analog degradation effects. For data-heavy dashboards, portfolios, or editorial sites that need to feel like declassified blueprints.
---

# Industrial Brutalism & Tactical Telemetry UI

## Visual Archetypes
Pick ONE per project and commit to it:

### Swiss Industrial Print
- High-contrast light modes (newsprint/off-white substrates).
- Monolithic, heavy sans-serif typography.
- Unforgiving structural grids outlined by visible dividing lines.
- Aggressive, asymmetric use of negative space punctuated by oversized, viewport-bleeding numerals or letterforms.
- Heavy use of primary red as an alert/accent color.

### Tactical Telemetry & CRT Terminal
- Dark mode exclusivity.
- High-density tabular data presentation.
- Absolute dominance of monospaced typography.
- Integration of technical framing devices (ASCII brackets, crosshairs).
- Application of simulated hardware limitations (phosphor glow, scanlines, low bit-depth rendering).

## Typographic Architecture
- **Macro-Typography (Structural Headers):** Neo-Grotesque / Heavy Sans-Serif. Optimal Web Fonts: Neue Haas Grotesk (Black), Archivo Black, Roboto Flex (Heavy), Monument Extended. Deployed at massive scales using fluid typography (e.g., clamp(4rem, 10vw, 15rem)). Extremely tight tracking (-0.03em to -0.06em). Highly compressed leading (0.85 to 0.95). Exclusively uppercase for structural impact.
- **Micro-Typography (Data & Telemetry):** Monospace / Technical Sans. Optimal Web Fonts: JetBrains Mono, IBM Plex Mono, Space Mono, VT323, Courier Prime. Fixed and small (10px to 14px). Generous tracking (0.05em to 0.1em). Exclusively uppercase for all metadata, navigation, unit IDs, and coordinates.

## Color System
Choose ONE substrate palette per project and use it consistently:

### If Swiss Industrial Print (Light)
- Background: #F4F4F0 or #EAE8E3 (Matte, unbleached documentation paper).
- Foreground: #050505 to #111111 (Carbon Ink).
- Accent: #E61919 or #FF2A2A (Aviation/Hazard Red). This is the ONLY accent color.

### If Tactical Telemetry (Dark)
- Background: #0A0A0A or #121212 (Deactivated CRT. Avoid pure #000000).
- Foreground: #EAEAEA (White phosphor).
- Accent: #E61919 or #FF2A2A (Aviation/Hazard Red).
- Terminal Green (#4AF626): Optional. Use ONLY for a single specific UI element.

## Layout and Spatial Engineering
- **The Blueprint Grid:** Strict adherence to CSS Grid architectures. Elements do not float; they are anchored precisely to grid tracks and intersections.
- **Visible Compartmentalization:** Extensive utilization of solid borders (1px or 2px solid) to delineate distinct zones of information.
- **Bimodal Density:** Layouts oscillate between extreme data density and vast expanses of calculated negative space.
- **Geometry:** Absolute rejection of border-radius. All corners must be exactly 90 degrees.

## UI Components and Symbology
- **Syntax Decoration:** Utilization of ASCII characters to frame data points. Framing: [ DELIVERY SYSTEMS ], < RE-IND >. Directional: >>>, ///.
- **Industrial Markers:** Prominent integration of registration (R), copyright (C), and trademark (TM) symbols functioning as structural geometric elements.
- **Technical Assets:** Integration of crosshairs (+) at grid intersections, repeating vertical lines (barcodes), thick horizontal warning stripes.

## Textural and Post-Processing Effects
- **Halftone and 1-Bit Dithering:** Transforming continuous-tone images or large serif typography into dot-matrix patterns.
- **CRT Scanlines:** For terminal interfaces, applying a repeating-linear-gradient to the background.
- **Mechanical Noise:** A global, low-opacity SVG static/noise filter applied to the DOM root.

## Web Engineering Directives
1. **Grid Determinism:** Utilize display: grid; gap: 1px; with contrasting parent/child background colors.
2. **Semantic Rigidity:** Construct the DOM using precise semantic tags (<data>, <samp>, <kbd>, <output>, <dl>).
3. **Typography Clamping:** Implement CSS clamp() functions exclusively for macro-typography.
`,
  },
  {
    path: "skills/output-skill/SKILL.md",
    content: `---
name: full-output-enforcement
description: Overrides default LLM truncation behavior. Enforces complete code generation, bans placeholder patterns, and handles token-limit splits cleanly. Apply to any task requiring exhaustive, unabridged output.
---

# Full-Output Enforcement

## Baseline
Treat every task as production-critical. A partial output is a broken output. Do not optimize for brevity - optimize for completeness. If the user asks for a full file, deliver the full file. If the user asks for 5 components, deliver 5 components. No exceptions.

## Banned Output Patterns
The following patterns are hard failures. Never produce them:

**In code blocks:** // ..., // rest of code, // implement here, // TODO, /* ... */, // similar to above, // continue pattern, // add more as needed, bare ... standing in for omitted code

**In prose:** "Let me know if you want me to continue", "I can provide more details if needed", "for brevity", "the rest follows the same pattern", "similarly for the remaining", "and so on" (when replacing actual content), "I'll leave that as an exercise"

**Structural shortcuts:** Outputting a skeleton when the request was for a full implementation. Showing the first and last section while skipping the middle. Replacing repeated logic with one example and a description.

## Execution Process
1. **Scope** - Read the full request. Count how many distinct deliverables are expected. Lock that number.
2. **Build** - Generate every deliverable completely. No partial drafts.
3. **Cross-check** - Before output, re-read the original request. Compare your deliverable count against the scope count.

## Handling Long Outputs
When a response approaches the token limit:
- Do not compress remaining sections to squeeze them in.
- Do not skip ahead to a conclusion.
- Write at full quality up to a clean breakpoint.
- End with: [PAUSED - X of Y complete. Send "continue" to resume from: next section name]

On "continue", pick up exactly where you stopped. No recap, no repetition.

## Quick Check
Before finalizing any response, verify:
- No banned patterns from the list above appear anywhere in the output
- Every item the user requested is present and finished
- Code blocks contain actual runnable code, not descriptions of what code would do
- Nothing was shortened to save space
`,
  },
  {
    path: "skills/stitch-skill/SKILL.md",
    content: `---
name: stitch-design-taste
description: Semantic Design System Skill for Google Stitch. Generates agent-friendly DESIGN.md files that enforce premium, anti-generic UI standards - strict typography, calibrated color, asymmetric layouts, perpetual micro-motion, and hardware-accelerated performance.
---

# Stitch Design Taste - Semantic Design System Skill

## Overview
This skill generates DESIGN.md files optimized for Google Stitch screen generation. It translates the battle-tested anti-slop frontend engineering directives into Stitch's native semantic design language.

## The Goal
Generate a DESIGN.md file that encodes:
1. **Visual atmosphere** - the mood, density, and design philosophy
2. **Color calibration** - neutrals, accents, and banned patterns with hex codes
3. **Typographic architecture** - font stacks, scale hierarchy, and anti-patterns
4. **Component behaviors** - buttons, cards, inputs with interaction states
5. **Layout principles** - grid systems, spacing philosophy, responsive strategy
6. **Motion philosophy** - animation engine specs, spring physics, perpetual micro-interactions
7. **Anti-patterns** - explicit list of banned AI design cliches

## Analysis & Synthesis Instructions

### 1. Define the Atmosphere
Evaluate the target project's intent. Use evocative adjectives from the taste spectrum:
- **Density:** "Art Gallery Airy" (1-3) -> "Daily App Balanced" (4-7) -> "Cockpit Dense" (8-10)
- **Variance:** "Predictable Symmetric" (1-3) -> "Offset Asymmetric" (4-7) -> "Artsy Chaotic" (8-10)
- **Motion:** "Static Restrained" (1-3) -> "Fluid CSS" (4-7) -> "Cinematic Choreography" (8-10)

Default baseline: Variance 8, Motion 6, Density 4.

### 2. Map the Color Palette
For each color provide: **Descriptive Name** + **Hex Code** + **Functional Role**.

**Mandatory constraints:**
- Maximum 1 accent color. Saturation below 80%
- The "AI Purple/Blue Neon" aesthetic is strictly BANNED
- Use absolute neutral bases (Zinc/Slate) with high-contrast singular accents
- Stick to one palette for the entire output
- Never use pure black (#000000) - use Off-Black, Zinc-950, or Charcoal

### 3. Establish Typography Rules
- **Display/Headlines:** Track-tight, controlled scale. Not screaming.
- **Body:** Relaxed leading, max 65 characters per line
- **Font Selection:** Inter is BANNED for premium/creative contexts. Force unique character: Geist, Outfit, Cabinet Grotesk, or Satoshi
- **Serif Ban:** Generic serif fonts are BANNED. If serif is needed, use only distinctive modern serifs.
- **Dashboard Constraint:** Use Sans-Serif pairings exclusively

### 4. Define the Hero Section
- **Inline Image Typography:** Embed small, contextual photos or visuals directly between words or letters in the headline.
- **No Overlapping:** Text must never overlap images or other text.
- **No Filler Text:** "Scroll to explore", "Swipe down", scroll arrow icons are BANNED.
- **Asymmetric Structure:** Centered Hero layouts BANNED when variance exceeds 4
- **CTA Restraint:** Maximum one primary CTA. No secondary "Learn more" links

### 5. Describe Component Stylings
- **Buttons:** Tactile push feedback on active state. No neon outer glows.
- **Cards:** Use ONLY when elevation communicates hierarchy.
- **Inputs/Forms:** Label above input, helper text optional, error text below.
- **Loading States:** Skeletal loaders matching layout dimensions.
- **Empty States:** Composed compositions indicating how to populate data.
- **Error States:** Clear, inline error reporting.

### 6. Define Layout Principles
- No overlapping elements
- Centered Hero sections are BANNED when variance exceeds 4
- The generic "3 equal cards horizontally" feature row is BANNED
- CSS Grid over Flexbox math
- Contain layouts using max-width constraints (e.g., 1400px centered)
- Full-height sections must use min-h-[100dvh] - never h-screen

### 7. Define Responsive Rules
- **Mobile-First Collapse (< 768px):** All multi-column layouts collapse to single column.
- **No Horizontal Scroll:** Horizontal overflow on mobile is a critical failure
- **Typography Scaling:** Headlines scale via clamp(). Body text minimum 1rem/14px
- **Touch Targets:** All interactive elements minimum 44px tap target

### 8. Encode Motion Philosophy
- **Spring Physics default:** stiffness: 100, damping: 20
- **Perpetual Micro-Interactions:** Every active component should have an infinite loop state
- **Staggered Orchestration:** Never mount lists instantly - use cascade delays
- **Performance:** Animate exclusively via transform and opacity

### 9. List Anti-Patterns (AI Tells)
Encode these as explicit "NEVER DO" rules:
- No emojis anywhere
- No Inter font
- No generic serif fonts
- No pure black (#000000)
- No neon/outer glow shadows
- No oversaturated accents
- No excessive gradient text on large headers
- No custom mouse cursors
- No overlapping elements
- No 3-column equal card layouts
- No generic names ("John Doe", "Acme", "Nexus")
- No fake round numbers (99.99%, 50%)
- No AI copywriting cliches ("Elevate", "Seamless", "Unleash", "Next-Gen")
- No filler UI text: "Scroll to explore", "Swipe down", scroll arrows
- No centered Hero sections (for high-variance projects)

## Output Format (DESIGN.md Structure)

The generated DESIGN.md should contain:
1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Component Stylings
5. Layout Principles
6. Motion & Interaction
7. Anti-Patterns (Banned)
`,
  },
  {
    path: "skills/imagegen-frontend-web/SKILL.md",
    content: `---
name: imagegen-frontend-web
description: Elite frontend image-direction skill for generating premium, conversion-aware website design references. CRITICAL OUTPUT RULE - generate ONE separate horizontal image FOR EVERY section. A landing page with 8 sections produces 8 images. Never compress multiple sections into one image.
---

# Elite Frontend Image Direction

## Hard Output Rule
**Generate one separate horizontal image PER section. Always. No exceptions.**
- 1 section requested -> 1 image
- 4 sections requested -> 4 images
- 8 sections requested -> 8 images
- "landing page" with no count -> default to 6 sections -> 6 images

## Hero Composition Bias
The default **left-text / right-image hero is the most overused AI pattern**. Consider these alternatives:
- centered over background image
- bottom-left over image
- bottom-right over image
- top-left lead
- stacked center
- image-as-canvas
- off-grid editorial
- mini minimalist
- right-text / left-image (inverted classic)

## Core Directive
Generate highly creative, premium, frontend design reference images that feel like real high-end website concepts. The output must feel: art-directed, premium, visually memorable, structured, readable, implementation-friendly.

## Active Baseline Configuration
- DESIGN_VARIANCE: 8
- VISUAL_DENSITY: 4
- ART_DIRECTION: 8
- IMPLEMENTATION_CLARITY: 9
- IMAGE_USAGE_PRIORITY: 9
- SPACING_GENEROSITY: 8

## The Combinatorial Variation Engine
Choose one option from each category and commit to it consistently:

### Theme Paradigm
1. Pristine Light Mode
2. Deep Dark Mode
3. Bold Studio Solid
4. Quiet Premium Neutral

### Hero Architecture
1. Cinematic Centered Minimalist
2. Asymmetric Split Hero
3. Floating Polaroid Scatter
4. Inline Typography Behemoth
5. Editorial Offset Composition
6. Massive Image-First Hero with restrained text

### Section System
1. Strict modular bento rhythm
2. Alternating editorial blocks
3. Poster-like stacked storytelling
4. Gallery-led visual cadence
5. Swiss grid discipline
6. Asymmetric premium marketing flow

## Image Count & Page Slicing
Generate **one separate horizontal image PER section**. Always. Never combine multiple sections in a single image.

## Anti-AI-Slop Rules
Strictly avoid: endless centered sections, identical card rows, cloned left-text/right-image blocks, default purple/blue AI gradients, too many glowing edges, floating blobs everywhere, giant heading + weak tiny subcopy, generic filler vibes (unleash, elevate, revolutionize, next-gen, seamless), fake brand slop (Acme, Nexus, Flowbit, Quantumly, NovaCore).

## Section Rhythm Rule
Vary section rhythm across the page by changing: density, image-to-text ratio, alignment, scale, whitespace, card grouping, background intensity, visual tempo.

## Clarity Check
Before finalizing, verify internally: Is the hierarchy obvious? Is the hero clean enough? Is the design visually distinctive? Is it free of obvious AI tells? Can someone code from this?
`,
  },
  {
    path: "skills/imagegen-frontend-mobile/SKILL.md",
    content: `---
name: imagegen-frontend-mobile
description: Elite mobile app image-generation skill for creating premium, app-native screen concepts and flows. Designed for iOS, Android, and cross-platform mobile products. Generates images only. It does not write code.
---

# Elite Mobile App Image Direction

## Core Directive
Generate premium, app-native, highly readable mobile app screen images and flow images. The output must feel: app-native, premium, clean, highly intentional, visually strong, readable, believable, flow-aware, platform-aware, creatively art-directed, non-generic.

This skill generates images only. Do not switch into coding mode. Do not describe code.

## Active Baseline Configuration
- DESIGN_VARIANCE: 8
- VISUAL_DENSITY: 3
- ART_DIRECTION: 9
- PLATFORM_AWARENESS: 9
- FLOW_VARIETY: 8
- SPACING_GENEROSITY: 9
- CLARITY_DISCIPLINE: 10
- TEXT_READABILITY_PRIORITY: 10

## Platform Mode Rule
Choose one: iOS-native premium, Android-native premium, or cross-platform premium neutral.

## Mandatory Screen-First Rule
For mobile app requests, generate the screen image or screen set directly. The main deliverable is one or more mobile screen images.

## Generate Enough Screens Rule
It is better to generate multiple clean readable screens than one compressed board with tiny unreadable text.

## App Design Bible Rule
When generating multiple images for the same app, lock an internal design bible: platform mode, device frame style, palette logic, typography mood, spacing system, corner radius logic, icon style, navigation model, card and list behavior, button styling, shadow language.

## Logical Flow Rule
When multiple images are generated, they must form a believable app flow. The screen order should make sense.

## Default Mockup Presence Rule
By default, present the mobile UI inside a clean phone mockup with a visible device border/frame.

## Mobile Anti-AI-Tells Rule
Strictly avoid: purple-blue fintech gradients everywhere, random glass cards, ambient blobs with no purpose, fake neon premium look, generic dribbble-style floating widgets, oversized corner radii on everything, fake chart dashboard spam, repeated stat cards with no product reason, cloned screens in a flow, giant empty cards with weak content, phone-shaped websites instead of app screens.

## Style Variation Engine
Choose a clear visual direction and commit to it: Theme Paradigm, Typography Character, Structure Bias, Image Art Direction Bias, Texture / Surface Treatment, Palette Logic, Signature Component Set, Decorative Asset Set, Motion-Implied Language.

## Color Palette Rule
Always use a clean, controlled color palette. Use a strong palette with internal logic. Keep color relationships clean. Let one or two accents do real work.

## Non-Genericity Rule
The app should not feel like a default template. Push the concept toward: stronger identity, stronger mood, stronger art direction, cleaner but more original composition, better image treatment, more distinctive asset language, more specific palette logic, more memorable screen-to-screen rhythm.

## Not Always Simple Rule
Simplicity is not the goal by itself. Cleanliness is the goal. A screen may be rich, layered, and expressive if it remains readable.

## Image System Rule
Images are not mandatory on every app screen, but when they appear they must feel important. Use images when the app category benefits from them.

## Text Rule
Copy should be: short, clean, product-appropriate, readable, useful for the screen.

## Text Size and Readability Rule
Text must never feel too small. If the text feels small, the design is not finished yet.

## Spacing and Density Rule
Do not make the app too dense. The UI should breathe.

## Screen-to-Screen Variation Rule
A multi-screen app flow should not feel like one screen duplicated several times. Vary: top-area composition, image-to-text balance, content density, card/list emphasis, CTA placement, visual tempo, module proportions, background treatment, texture intensity.

## Quality Check
Before finalizing, verify internally: Does this feel like a real mobile app? Are safe areas respected? Is the first screen clean enough? Is the copy short enough? Is the type readable? Are there enough screens for the requested flow? Is the app free of obvious mobile AI tells? Is the layout free of box-in-box clutter? Are image moments purposeful and consistent? Does the flow feel coherent? Do screens vary enough without breaking the design system? Does the product feel premium and app-native?
`,
  },
  {
    path: "skills/brandkit/SKILL.md",
    content: `---
name: brandkit
description: Premium brand-kit image generation skill for creating high-end brand-guidelines boards, logo systems, identity boards, and visual-world presentations.
---

# Brandkit Image Generation Skill

## Core Principle
A premium brand kit is not decoration. It is a visual argument for why the brand exists. Every generated board must answer: What does this brand represent? What is the core metaphor? How does the logo express that? How does the system scale across UI, print, image, and detail? Why does the whole thing feel ownable?

## Brand Strategy First
Before generating, infer the brand strategy: category, audience, product function, emotional promise, cultural position, trust level, visual world, symbolic metaphor, what the brand should avoid.

## Logo Generation Standard
The logo must be professional: simple, memorable, symbolic, scalable, ownable, visually balanced, connected to the brand idea, usable as icon, wordmark, badge, UI mark, and pattern.

## Logo Concept Methods
1. Monogram + Meaning: Combine the brand initial with a metaphor.
2. Product Action: Turn the product's main action into a symbol.
3. Metaphor Fusion: Combine two meaningful ideas into one reduced mark.
4. Negative Space: Use empty space to create intelligence.
5. Construction Geometry: Create a mark from a clear system.

## Board Composition DNA
A strong brand-kit board should feel like a curated sequence: large calm cover panel, one digital mockup panel, one image-led atmosphere panel, one system/construction panel, one physical or icon application panel, one quiet tagline panel.

## Visual Modes
Choose based on the brand: Dark Developer / Builder, Dark Product / Operator, Dark Nature / Calm System, Dark Security / Threat Intelligence, Light Editorial / Compliance, Luxury / Beauty / Fashion, Voice / Communication, Cultural / Experimental.

## Premium Detail Language
Use details like: small page numbers, tiny footer labels, precise alignment marks, construction lines, subtle crosshair grids, thin rules, browser bars, rounded rectangles, image masks, soft shadows, low-opacity texture, halftone image treatment, one highlighted word, one accent chip, one strong icon state.

## Text Rules
Use very little text. Good text: brand name, one tagline, one URL, one command, 2-5 section labels, short UI chips. Bad text: long paragraphs, tiny fake body copy, lots of menu items, lorem ipsum, dense explanations, unreadable labels.

## Color Discipline
Use one dominant palette: base color, primary accent, secondary accent, neutrals. Accents must repeat across panels. No random rainbow unless requested. No generic purple-blue AI glow unless appropriate.

## Anti-Generic Rules
Never make: random floating icons, generic startup gradients, overdesigned logos, meaningless blobs, messy layout collages, fake tiny UI, inconsistent logo marks, too many colors, cheap neon, stock-template brand boards, corporate PowerPoint slides, soulless SaaS dashboards.

## Final Output Standard
The image must look like: a premium identity deck, a senior designer's presentation board, a brand-system case study, a visual launch direction, a professional logo concept board. The final result should be: clean, strategic, symbolic, minimal, coherent, premium, art-directed, implementation-friendly.
`,
  },
  {
    path: "skills/LICENSE",
    content: `MIT License

Copyright (c) 2026 Leonxlnx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
];

export function getTasteSkillFiles(): AgentKitFile[] {
  return TASTE_SKILL_FILES.map((file) => ({ ...file }));
}
