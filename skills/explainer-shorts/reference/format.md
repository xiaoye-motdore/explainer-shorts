# Script format reference

A script is a Markdown file: optional front matter, then one block per line.
You write content only. The engine decides layout, line timing, camera moves,
animation, sound and encoding.

## Front matter

```yaml
---
title: Why is the sky blue?      # cover title (defaults to the # lines)
subtitle: One sentence, 40 s     # optional, shown on the cover
theme: notebook                  # notebook | night | chalk | ./my-theme.css (see themes.md)
author: your-name                # signature on the last screen and the cover
music: true                      # false = sound effects only
speed: 1                         # 0.5–2; 1.2 = 20% faster
credit: true                     # false hides the small "explainer-shorts" credit line
fps: 30                          # 24 | 25 | 30 | 50 | 60
---
```

Every key is optional.

## Blocks

One block per line. Blank lines are ignored.

| You write | Block | What happens on screen |
|---|---|---|
| `# text` | title | Big text, written in. Put each title line on its own `#` line. Use for the hook. |
| `## text` | new screen | Camera moves to a fresh screen; the heading is written at the top. |
| `text` | line | Normal line, written in at reading speed. |
| `> text` | note | Margin note (red pen in `notebook`, dim aside in `night`). |
| `- text` | item | Bulleted line. |
| `~~text~~` | wrong guess | Written, then struck through. Use 1–3 of them before a `!!` reveal. |
| `!! text` | reveal | Pops in large, circled (notebook) or glowing (night). If it contains a number, the number counts up. |
| `[label] text` | tag | A stamped label, then the text. Labels up to 14 characters. |
| `= text` | formula | Typed character by character in a formula style. |
| `^ text` | source | Small source line. Put it under the claim it supports. |
| `...` | pause | 0.75 s of silence; the music drops out. Use before a punchline. |
| ```` ```svg ```` … ```` ``` ```` | doodle | An inline SVG drawn stroke by stroke, like a pen. |

### Inline marks

| Mark | Effect |
|---|---|
| `**text**` | emphasis colour (red / gold) |
| `==text==` | highlighter sweeps in after the line is written |
| `*text*` | handwriting style (blue Caveat in `notebook`) — good for short Latin words |
| `` `text` `` | monospace |

Do not put spaces around marks in Chinese: `让它照**飞机维修手册**写`, not `让它照 **飞机维修手册** 写`.

## Doodles (```svg)

````markdown
```svg 1.6
<svg viewBox="0 0 460 180" fill="none" stroke="currentColor" stroke-width="6">
  <rect x="14" y="58" width="112" height="64" rx="14"/>
  <path d="M132,90 L178,90 M166,78 L180,90 L166,102"/>
  <circle class="accent" cx="400" cy="90" r="34"/>
</svg>
```
````

- The number after `svg` is the drawing time in seconds (0.6–5, default 1.6).
- Shapes are drawn in document order: `path`, `line`, `polyline`, `polygon`, `circle`, `ellipse`, `rect`.
- Use `stroke="currentColor"` so the ink matches the theme. `class="accent"` uses the accent colour (red / gold); add `accent-fill` to fill a shape with it (the fill fades in after its outline).
- Keep it simple: 3–12 shapes, `stroke-width` 5–7 in a viewBox about 400–460 wide. The doodle is scaled to at most 520 × 360 px and centred.
- No `<script>`, no event handlers, no external images.

## Timing (automatic)

You do not set times. The engine uses:

- Chinese: about 5 characters per second of reading time; English: about 2.7 words per second.
- Handwriting (`notebook`) writes about 9 Chinese characters per second; kinetic type (`night`) about 14.
- Reveals hold for at least 1.5 s (2 s if a number counts up). Guesses are struck 0.2 s after they are written.
- A new screen (`##`) starts with a 0.85 s camera move.
- `speed:` in the front matter scales all of it.

`lint` prints the exact duration before you render.

## Layout rules the linter checks

- Title, heading and reveal lines must fit on one line. Slightly long ones are shrunk, down to 60 % size; longer ones wrap and get a warning.
- Normal lines may wrap to two lines on a phone. Three or more gives a warning.
  About 11 Chinese characters fit on one line in `notebook` and about 13 in `night`.
- A screen taller than the phone's safe area scrolls. The linter warns when a screen has more than 9 blocks.
- A screen that states a number without a `^` source line gets a warning.
- Three or more 的 in one Chinese line gets a warning.
- Under 12 s or over 90 s gets a warning.

## Safe area

Content is kept between y = 330 and y = 1430 of the 1080 × 1920 frame, so it is not covered by
platform UI (search bar at the top, caption and buttons at the bottom). The right margin keeps
text clear of the like / comment buttons.

## Outputs of `render`

| File | What |
|---|---|
| `name.mp4` | H.264 1080×1920, AAC 48 kHz, music + sound effects, loudness −16 LUFS, true peak −1.5 dBTP |
| `name.no-music.mp4` | Same picture, sound effects only (−18 LUFS), for adding platform music |
| `name.cover-9x16.png` | Cover 1080×1920 |
| `name.cover-3x4.png` | Cover 1080×1440 (Xiaohongshu / profile grid) |
| `name.report.json` | Duration, frames, render time, loudness, warnings |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No Chrome or Chromium found` | `node es.mjs setup --browser`, or set `EXPLAINER_SHORTS_CHROME=/path/to/chrome` |
| `ffmpeg not found` | macOS `brew install ffmpeg` · Ubuntu `sudo apt install ffmpeg` · Windows `winget install ffmpeg` |
| Fonts download fails | Check network access to the npm registry, then `node es.mjs setup --force` |
| Want the dependencies elsewhere | Set `EXPLAINER_SHORTS_DEPS=/some/folder` |
| Render is slow | `--draft` (faster encoder, lower quality) for checks; final render once |
