# Themes

A theme is one CSS file. Scripts never change when the look changes.

- Built in: `notebook`, `night`, `chalk`
- Your own: `theme: ./my-theme.css` in the front matter (path relative to the script), or `--theme path/to/my-theme.css` on the command line

## Start from the template

Copy `examples/themes/xuan.css` (rice paper, ink, vermilion seal) and edit it.

- Custom themes get `<body class="custom">`, so start every selector with `.custom`.
- `url(...)` in your CSS (images, fonts) resolves next to the theme file.
- Check your theme with `node es.mjs preview script.md --theme my-theme.css`.

## Engine settings

Put these custom properties on `body.custom`. All of them are optional.

| Property | Values | Default | Effect |
|---|---|---|---|
| `--es-write` | `ink` · `kinetic` | `ink` | `ink`: each character is wiped in like a pen stroke. `kinetic`: characters rise and sharpen into place. |
| `--es-formula` | `ink` · `type` | `ink` for ink themes, `type` for kinetic | How `=` formula lines appear. `type` adds a blinking `.caret`. |
| `--es-reveal` | `circle` · `glow` | `circle` / `glow` | `!!` decoration: a hand-drawn ellipse, or an underline with a glow. |
| `--es-underline` | `on` · `off` | `on` / `off` | Hand-drawn underline under the last title line and under headings. |
| `--es-heading-bar` | `on` · `off` | `off` | Animates `--bar` (a width) on headings, for a `::before` bar. |
| `--es-shake` | `on` · `off` | `on` / `off` | Small camera shake when a reveal lands. |
| `--es-stamp` | `rubber` · `pill` | `rubber` / `pill` | How `[tag]` labels land: tilted rubber stamp, or a soft pop. |
| `--es-texture` | `grain` · `none` | `none` | Draws a fibre/grain texture into `#grain` (and `.grainbg` on covers). |
| `--es-grain-rgb` | `r,g,b` | `140,126,104` | Grain colour. |
| `--es-stars` | `on` · `off` | `off` | Twinkling star field with parallax on `#fx`. |
| `--es-sound` | `pen` · `air` | `pen` / `air` | Sound-effect palette: pencil, marker and bells, or swishes, booms and shimmer. |
| `--es-music` | `musicbox` · `plucks` · `none` | `musicbox` / `plucks` | Music bed. `none` = sound effects only. |
| `--es-left`, `--es-right` | px | `196`, `110` | Text column margins. Keep the right margin ≥ 100 to stay clear of platform buttons. |
| `--es-ink` | colour | `#2446A6` | Title underline colour. |
| `--es-mark` | colour | `#D23B2E` | Strike-throughs, reveal circles, heading underlines. |
| `--es-accent` | colour | `#F2C14E` | Reveal underline in `glow` mode. |
| `--es-glow` | `r,g,b` | `242,193,78` | Reveal glow colour. |
| `--es-guess-dim` | 0–1 | `0` / `0.5` | How much a struck-out guess fades. |
| `--es-hl-size` | % | `34%` | Height of the `==highlighter==` band. |
| `--es-bullet` | string | `'•'` | Bullet glyph for `-` items. |

"Default" values with a slash depend on `--es-write`: ink / kinetic.

## What to style

| Selector | What it is |
|---|---|
| `#paper`, `.paperbg` | Background that scrolls with the text; `.paperbg` is the same background on covers. Style both the same way. |
| `#bg` | Fixed background behind everything (night uses it for the sky gradient). |
| `#grain`, `.grainbg` | Texture layer when `--es-texture: grain`; set `mix-blend-mode` and `opacity`. |
| `#vignette` | Fixed overlay on top: vignettes, frames (chalk draws its wooden frame with `box-shadow`). |
| `.blk-title` `.blk-heading` `.blk-line` `.blk-item` `.blk-note` `.blk-guess` `.blk-reveal` `.blk-tag` `.blk-formula` `.blk-source` `.blk-svg` | One class per block type. |
| `.em` `.hl` `.hand` `.code` | Inline marks. For `.hl`, use a `background-image` with `background-size: 0% …`; the engine animates the width. |
| `.tag` `.bullet` `.caret` | Tag label, bullet, typing caret. |
| `.end .sig`, `.end .credit` | Last screen. |
| `#cover` `.cv-title` `.cv-sub` `.cv-sig` | Covers. Give `.cv-title`, `.cv-sub` and `.cv-sig` `position: absolute` with left/right margins; the engine sets `top`. |
| `.blk-svg` (`color`) · `.accent` · `.accent-fill` | Doodle ink colour, accent stroke, accent fill. |

## Fonts

Bundled and available to every theme: `'LXGW WenKai'` (400, 700), `'Noto Sans SC'` (400, 700, 900), `'Caveat'` (700),
`'Space Grotesk'` (700), `'IBM Plex Mono'` (500). For any other font, add an `@font-face` with a `url()` next to the theme file.
The engine loads exactly the glyphs the script uses before the first frame.

## Practical limits

- Keep body text at 60–70 px. Phones show the 1080 px frame at about a third of that size.
- Content sits between y = 330 and y = 1430 of the frame, clear of platform UI.
- Plain CSS covers 2D looks: paper, boards, gradients, textures, frames, colour schemes. Animated backgrounds such as shaders and 3D scenes need a background-script hook, which is on the roadmap.
