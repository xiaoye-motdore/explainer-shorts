#!/usr/bin/env node
/* explainer-shorts CLI
 *   node es.mjs setup                      install fonts + renderer once (cached)
 *   node es.mjs lint    script.md          check the script, print duration and warnings
 *   node es.mjs preview script.md          contact sheet of 12 frames (for a quick look)
 *   node es.mjs render  script.md          final MP4 (+ no-music version) and covers
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

if (parseInt(process.versions.node, 10) < 18) { console.error('explainer-shorts needs Node 18 or newer (you have ' + process.versions.node + ').'); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const ENGINE = path.join(SKILL, 'engine');
const req = createRequire(import.meta.url);
const ESParse = req(path.join(ENGINE, 'parse.js'));
const ESTiming = req(path.join(ENGINE, 'timing.js'));
const PKG = JSON.parse(fs.readFileSync(path.join(SKILL, 'package.json'), 'utf8'));
const VERSION = PKG.version;
const DEPS = process.env.EXPLAINER_SHORTS_DEPS || path.join(os.homedir(), '.cache', 'explainer-shorts', VERSION);
const W = 1080, H = 1920;

// Every bundled font is available to every theme (CSS only; glyph files load on demand).
const FONT_CSS = [
  'lxgw-wenkai-webfont/lxgwwenkai-regular.css', 'lxgw-wenkai-webfont/lxgwwenkai-bold.css',
  '@fontsource/caveat/700.css',
  '@fontsource/noto-sans-sc/400.css', '@fontsource/noto-sans-sc/700.css', '@fontsource/noto-sans-sc/900.css',
  '@fontsource/space-grotesk/700.css', '@fontsource/ibm-plex-mono/500.css'
];
const BUILTIN_THEMES = ['notebook', 'night', 'chalk'];

// ---------------------------------------------------------------- utils
const log = (...a) => console.error(...a);
function die(msg, code = 1) { log(msg); process.exit(code); }

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function ffmpegPath() {
  if (process.env.EXPLAINER_SHORTS_FFMPEG) return process.env.EXPLAINER_SHORTS_FFMPEG;
  return which('ffmpeg');
}

function depsReady() {
  return fs.existsSync(path.join(DEPS, 'node_modules', 'playwright-core', 'package.json')) &&
    fs.existsSync(path.join(DEPS, 'node_modules', 'lxgw-wenkai-webfont', 'lxgwwenkai-regular.css'));
}

function installDeps() {
  fs.mkdirSync(DEPS, { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'package.json'), path.join(DEPS, 'package.json'));
  log(`explainer-shorts: installing fonts and renderer into ${DEPS} (one time, ~120 MB)…`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: DEPS, stdio: 'inherit' });
  if (r.status !== 0) die('npm install failed. Check your network, then run: node es.mjs setup');
}

function depRequire(name) {
  return createRequire(path.join(DEPS, 'package.json'))(name);
}

async function launchBrowser() {
  const { chromium } = depRequire('playwright-core');
  const tries = [];
  if (process.env.EXPLAINER_SHORTS_CHROME) tries.push({ executablePath: process.env.EXPLAINER_SHORTS_CHROME });
  try { const p = chromium.executablePath(); if (p && fs.existsSync(p)) tries.push({ executablePath: p }); } catch {}
  for (const c of ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']) if (fs.existsSync(c)) tries.push({ executablePath: c });
  tries.push({ channel: 'chrome' });
  let last;
  for (const opt of tries) {
    try { return await chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars'], ...opt }); }
    catch (e) { last = e; }
  }
  die('No Chrome or Chromium found.\n  Run: node es.mjs setup --browser   (downloads Chromium for Playwright)\n  or set EXPLAINER_SHORTS_CHROME=/path/to/chrome\n' + (last ? String(last.message).split('\n')[0] : ''));
}

function installBrowser() {
  const cli = path.join(DEPS, 'node_modules', 'playwright-core', 'cli.js');
  log('Downloading Chromium for Playwright…');
  const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '' } });
  if (r.status !== 0) die('Chromium download failed. Install Google Chrome, or set EXPLAINER_SHORTS_CHROME.');
}

// static server: engine + fonts on one origin (no file:// CORS surprises)
function serve(userDir) {
  const roots = [['/engine/', ENGINE], ['/deps/', path.join(DEPS, 'node_modules')]];
  if (userDir) roots.push(['/user/', userDir]);
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((rq, rs) => {
    let url;
    try { url = decodeURIComponent(rq.url.split('?')[0]); } catch { rs.writeHead(400).end(); return; }
    for (const [prefix, dir] of roots) {
      if (!url.startsWith(prefix)) continue;
      const fp = path.normalize(path.join(dir, url.slice(prefix.length)));
      if (fp !== dir && !fp.startsWith(dir + path.sep)) { rs.writeHead(403).end(); return; }
      fs.readFile(fp, (err, data) => {
        if (err) { rs.writeHead(404).end(); return; }
        rs.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
        rs.end(data);
      });
      return;
    }
    rs.writeHead(404).end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// Resolve a theme name or a path to a user .css theme.
function resolveTheme(src, opts) {
  const fromFlag = opts.theme;
  const parsed = ESParse.parse(src);
  const name = fromFlag || parsed.meta.theme;
  if (BUILTIN_THEMES.includes(name)) return { name, file: null };
  if (!/\.css$/i.test(name)) die(`Unknown theme "${name}". Use ${BUILTIN_THEMES.join(', ')}, or a path to a .css file.`);
  const base = fromFlag ? process.cwd() : (opts.scriptDir || process.cwd());
  const file = path.resolve(base, name);
  if (!fs.existsSync(file)) die(`Theme file not found: ${file}`);
  return { name, file };
}

async function openPlayer(script, opts = {}) {
  if (!depsReady()) installDeps();
  const theme = resolveTheme(script, opts);
  const server = await serve(theme.file ? path.dirname(theme.file) : null);
  const port = server.address().port;
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  const fontCss = FONT_CSS.map(f => `http://127.0.0.1:${port}/deps/${f}`);
  const themeCss = theme.file ? `http://127.0.0.1:${port}/user/${encodeURIComponent(path.basename(theme.file))}` : `themes/${theme.name}.css`;
  const cfg = { script, theme: opts.theme || null, themeCss, music: opts.music, debug: !!opts.debug, fontCss };
  await page.addInitScript(c => { window.__ES_CONFIG = c; }, cfg);
  page.on('pageerror', e => log('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/engine/player.html`);
  await page.waitForFunction(() => window.ES && window.ES.ready === true, null, { timeout: 180000 });
  const info = await page.evaluate(() => ({ error: ES.error, duration: ES.duration, fps: ES.fps, meta: ES.meta, warnings: ES.warnings }));
  const close = async () => { await browser.close(); server.close(); };
  if (info.error) { await close(); printErrors('script', info.error); process.exit(1); }
  let cdp = null;
  try { cdp = await page.context().newCDPSession(page); } catch {}
  const shot = async (quality = 92) => {
    if (cdp) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true, captureBeyondViewport: false });
      return Buffer.from(r.data, 'base64');
    }
    return page.screenshot({ type: 'jpeg', quality });
  };
  return { page, info, close, shot };
}

function printErrors(file, errors) {
  for (const e of errors) {
    log(`${file}:${e.line || 1}  error  ${e.message}`);
    if (e.example) log('    example:\n      ' + String(e.example).split('\n').join('\n      '));
  }
}

function readScript(file) {
  if (!file) die('Missing script path. Usage: node es.mjs render path/to/script.md');
  if (!fs.existsSync(file)) die(`No such file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function outDirFor(file, args) {
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  const dir = path.resolve(args.out || path.join('explainer-shorts-out', name));
  fs.mkdirSync(dir, { recursive: true });
  return { dir, name };
}

// ---------------------------------------------------------------- lint
function estWidthEm(plain) {
  let w = 0;
  for (const ch of Array.from(plain)) {
    if (/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(ch)) w += 1;
    else if (ch === ' ') w += 0.3;
    else if (/[A-Z0-9]/.test(ch)) w += 0.62;
    else w += 0.52;
  }
  return w;
}

function lint(src, file, themeOverride) {
  const parsed = ESParse.parse(src);
  if (themeOverride) parsed.meta.theme = themeOverride;
  const res = { file, errors: parsed.errors, warnings: [...parsed.warnings], meta: parsed.meta };
  if (/\.css$/i.test(parsed.meta.theme) && file) {
    const tf = path.resolve(themeOverride ? process.cwd() : path.dirname(path.resolve(file)), parsed.meta.theme);
    if (!fs.existsSync(tf)) res.errors.push({ line: 1, message: `Theme file not found: ${tf}` });
  }
  if (parsed.errors.length || res.errors.length) return res;
  const sched = ESTiming.schedule(parsed);
  res.duration = sched.duration;
  res.sections = parsed.sections;
  res.blocks = parsed.blocks.length;
  const warn = (line, message) => res.warnings.push({ line, message });
  const zh = parsed.meta.lang === 'zh';
  const visible = parsed.blocks.filter(b => b.type !== 'pause');
  const first = visible[0];

  if (first && !['title', 'reveal'].includes(first.type)) warn(first.line, 'Open with a # title or a !! reveal: the first two seconds decide whether people keep watching.');
  if (sched.duration < 12) warn(1, `Only ${sched.duration.toFixed(1)} s long. Short videos work best between 20 and 75 s.`);
  if (sched.duration > 90) warn(1, `${sched.duration.toFixed(1)} s is long for a vertical short. Cut to under 90 s, or raise speed: in the front matter.`);

  const th = BUILTIN_THEMES.includes(parsed.meta.theme) ? parsed.meta.theme : 'notebook';
  const contentEm = { notebook: 774, night: 880, chalk: 836 }[th];
  const NB = { title: 96, line: 68, item: 68, tag: 66, note: 54, guess: 62, reveal: 124, heading: 62 };
  const size = { notebook: NB, chalk: NB, night: { title: 90, line: 66, item: 66, tag: 62, note: 48, guess: 60, reveal: 120, heading: 44 } }[th];
  for (const b of visible) {
    const fs_ = size[b.type];
    if (!fs_) continue;
    const em = estWidthEm(b.plain) + (b.type === 'tag' ? estWidthEm(b.label || '') * 0.7 + 1 : 0);
    const perLine = contentEm / fs_;
    if (['title', 'reveal', 'heading'].includes(b.type)) {
      if (em > perLine / 0.6) warn(b.line, `Too long for one line (${b.type}); it will wrap. Split it into two lines.`);
      else if (em > perLine / 0.85) warn(b.line, `Will be shrunk to fit one line (${Math.round(perLine / em * 100)}% size). Shorter reads better.`);
    } else if (em > perLine * 2) {
      warn(b.line, `Wraps onto ${Math.ceil(em / perLine)} lines on a phone. Keep one idea per line (≈${Math.floor(perLine)} ${zh ? 'Chinese characters' : 'em'} per line).`);
    }
    if (zh && (b.plain.match(/的/g) || []).length >= 3) warn(b.line, 'Three or more 的 in one line. Rewrite it shorter.');
  }

  const bySec = new Map();
  for (const b of parsed.blocks) { if (!bySec.has(b.section)) bySec.set(b.section, []); bySec.get(b.section).push(b); }
  for (const [s, list] of bySec) {
    const vis = list.filter(b => b.type !== 'pause');
    if (vis.length > 9) warn(vis[0].line, `Screen ${s + 1} has ${vis.length} blocks. Split it with another ## heading.`);
    const hasNum = vis.some(b => !['heading', 'source', 'svg'].includes(b.type) && /\d/.test(b.plain));
    const hasSrc = vis.some(b => b.type === 'source');
    if (hasNum && !hasSrc) {
      const nb = vis.find(b => !['heading', 'source', 'svg'].includes(b.type) && /\d/.test(b.plain));
      warn(nb.line, 'This screen states a number but has no ^ source line. Viewers will ask where it comes from.');
    }
  }
  return res;
}

function printLint(res) {
  for (const e of res.errors) {
    log(`${res.file}:${e.line}  error    ${e.message}`);
    if (e.example) log('           example: ' + String(e.example).replace(/\n/g, '\n                    '));
  }
  for (const w of res.warnings) log(`${res.file}:${w.line}  warning  ${w.message}`);
  if (!res.errors.length) log(`${res.file}: ${res.duration.toFixed(1)} s · ${res.sections} screen(s) · ${res.blocks} blocks · theme ${res.meta.theme} · ${res.errors.length} errors · ${res.warnings.length} warnings`);
}

// ---------------------------------------------------------------- ffmpeg helpers
function runFF(ff, args) {
  const r = spawnSync(ff, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) die('ffmpeg failed:\n' + (r.stderr || '').slice(-2000));
  return r.stderr || '';
}

function measureLoudness(ff, wav, I, TP) {
  const err = runFF(ff, ['-hide_banner', '-nostats', '-i', wav, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=11:print_format=json`, '-f', 'null', '-']);
  const m = err.match(/\{[\s\S]*?\}/g);
  if (!m) die('Could not read loudness from ffmpeg.');
  return JSON.parse(m[m.length - 1]);
}

function muxWithLoudness(ff, video, wav, out, I, TP) {
  const m = measureLoudness(ff, wav, I, TP);
  const af = `loudnorm=I=${I}:TP=${TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  const err = runFF(ff, ['-y', '-hide_banner', '-nostats', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-af', af,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out]);
  const j = err.match(/\{[\s\S]*?\}/g);
  const after = j ? JSON.parse(j[j.length - 1]) : null;
  return { input: +m.input_i, output: after ? +after.output_i : null, truePeak: after ? +after.output_tp : null };
}

// ---------------------------------------------------------------- commands
async function cmdSetup(args) {
  if (!depsReady() || args.force) installDeps();
  else log(`Fonts and renderer already installed in ${DEPS}`);
  if (args.browser) installBrowser();
  const ff = ffmpegPath();
  log(ff ? `ffmpeg: ${ff}` : 'ffmpeg: NOT FOUND — install it (macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg)');
  const b = await launchBrowser();
  log(`browser: ${b.version()}`);
  await b.close();
  log(ff ? 'Ready.' : 'Almost ready: install ffmpeg, then render.');
}

async function cmdLint(args) {
  const file = args._[1];
  const res = lint(readScript(file), file, args.theme);
  if (args.json) console.log(JSON.stringify(res, null, 2));
  else printLint(res);
  process.exit(res.errors.length ? 1 : 0);
}

async function cmdPreview(args) {
  const file = args._[1];
  const src = readScript(file);
  const res = lint(src, file, args.theme);
  if (res.errors.length) { printLint(res); process.exit(1); }
  const ff = ffmpegPath();
  const { dir, name } = outDirFor(file, args);
  const { page, info, close, shot } = await openPlayer(src, { theme: args.theme, scriptDir: path.dirname(path.resolve(file)), debug: !args['no-label'] });
  const dur = info.duration;
  let times;
  if (args.at) times = String(args.at).split(',').map(Number).filter(x => x >= 0);
  else {
    const n = parseInt(args.frames || 12, 10);
    times = Array.from({ length: n }, (_, i) => +(Math.min(dur - 0.05, (i + 1) * dur / n)).toFixed(2));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-prev-'));
  const files = [];
  for (let i = 0; i < times.length; i++) {
    await page.evaluate(t => ES.renderAt(t), times[i]);
    const buf = await shot(90);
    const f = path.join(args.at ? dir : tmp, args.at ? `${name}.t${times[i].toFixed(2)}.jpg` : `f${String(i).padStart(2, '0')}.jpg`);
    fs.writeFileSync(f, buf);
    files.push(f);
  }
  const layoutWarnings = await page.evaluate(() => ES.warnings);
  await close();
  for (const w of [...res.warnings, ...layoutWarnings]) log(`${file}:${w.line}  warning  ${w.message}`);
  if (args.at) { files.forEach(f => console.log(f)); return; }
  if (!ff) die('ffmpeg is needed to build the contact sheet.');
  const cols = 4, rows = Math.ceil(times.length / cols);
  const sheet = path.join(dir, `${name}.preview.jpg`);
  runFF(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', '1', '-i', path.join(tmp, 'f%02d.jpg'),
    '-vf', `scale=324:576:flags=lanczos,tile=${cols}x${rows}:padding=10:margin=10:color=0x222222`, '-frames:v', '1', '-q:v', '3', sheet]);
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`${dur.toFixed(1)} s · frames at ${times.join(', ')} s`);
  console.log(sheet);
}

async function cmdRender(args) {
  const file = args._[1];
  const src = readScript(file);
  const res = lint(src, file, args.theme);
  if (res.errors.length) { printLint(res); process.exit(1); }
  const ff = ffmpegPath();
  if (!ff) die('ffmpeg not found. Install it (macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg), then run again.');
  const { dir, name } = outDirFor(file, args);
  const draft = !!args.draft;
  const t0 = Date.now();
  const { page, info, close, shot } = await openPlayer(src, { theme: args.theme, scriptDir: path.dirname(path.resolve(file)), music: args['no-music'] ? false : undefined });
  const fps = parseInt(args.fps || info.fps || 30, 10);
  const dur = info.duration;
  const N = Math.round(dur * fps);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-render-'));
  const videoOnly = path.join(tmp, 'video.mp4');

  // audio first (fast), so a failure shows up before the long frame loop
  const wavMusic = path.join(tmp, 'music.wav');
  const wavSfx = path.join(tmp, 'sfx.wav');
  const withMusic = info.meta.music !== false && !args['no-music'];
  const a1 = await page.evaluate(m => ES.renderAudio({ music: m }), withMusic);
  fs.writeFileSync(wavMusic, Buffer.from(a1.dataUrl.split(',')[1], 'base64'));
  if (withMusic) {
    const a2 = await page.evaluate(() => ES.renderAudio({ music: false }));
    fs.writeFileSync(wavSfx, Buffer.from(a2.dataUrl.split(',')[1], 'base64'));
  }

  const enc = spawn(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=1080:1920:in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', '-crf', draft ? '25' : '21', '-profile:v', 'high', '-level', '4.2',
    '-g', String(fps * 2), '-bf', '2', '-r', String(fps), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart', videoOnly], { stdio: ['pipe', 'inherit', 'inherit'] });
  let lastPct = -1;
  for (let i = 0; i < N; i++) {
    await page.evaluate(t => ES.renderAt(t), i / fps);
    const buf = await shot(draft ? 82 : 92);
    if (!enc.stdin.write(buf)) await once(enc.stdin, 'drain');
    const pct = Math.floor(i / N * 10);
    if (pct !== lastPct) { lastPct = pct; log(`frames ${i}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)} s`); }
  }
  enc.stdin.end();
  const [code] = await once(enc, 'close');
  if (code !== 0) die('ffmpeg encoding failed.');

  // covers
  const cover916 = path.join(dir, `${name}.cover-9x16.png`);
  const cover34 = path.join(dir, `${name}.cover-3x4.png`);
  await page.evaluate(() => ES.renderCover('9x16'));
  await page.screenshot({ path: cover916, type: 'png' });
  await page.setViewportSize({ width: W, height: 1440 });
  await page.evaluate(() => ES.renderCover('3x4'));
  await page.screenshot({ path: cover34, type: 'png' });
  const layoutWarnings = await page.evaluate(() => ES.warnings);
  await close();

  const outMain = path.join(dir, `${name}.mp4`);
  const loud = muxWithLoudness(ff, videoOnly, wavMusic, outMain, -16, -1.5);
  let outSfx = null, loudSfx = null;
  if (withMusic) {
    outSfx = path.join(dir, `${name}.no-music.mp4`);
    loudSfx = muxWithLoudness(ff, videoOnly, wavSfx, outSfx, -18, -2);
  }
  if (!args.keep) fs.rmSync(tmp, { recursive: true, force: true });

  const secs = (Date.now() - t0) / 1000;
  const report = {
    script: path.resolve(file), theme: info.meta.theme, duration: +dur.toFixed(2), fps, frames: N,
    renderSeconds: +secs.toFixed(1),
    outputs: { video: outMain, videoNoMusic: outSfx, cover9x16: cover916, cover3x4: cover34 },
    sizeMB: +(fs.statSync(outMain).size / 1048576).toFixed(2),
    loudness: { music: loud, noMusic: loudSfx },
    warnings: [...res.warnings, ...layoutWarnings]
  };
  fs.writeFileSync(path.join(dir, `${name}.report.json`), JSON.stringify(report, null, 2));
  for (const w of report.warnings) log(`${file}:${w.line}  warning  ${w.message}`);
  log(`done in ${secs.toFixed(0)} s · ${dur.toFixed(1)} s video · ${N} frames · ${report.sizeMB} MB`);
  console.log(outMain);
  if (outSfx) console.log(outSfx);
  console.log(cover916);
  console.log(cover34);
}

const HELP = `explainer-shorts ${VERSION}
usage:
  node es.mjs setup [--browser]            install fonts + renderer (cached in ${DEPS})
  node es.mjs lint    <script.md> [--json] check syntax, duration, line lengths, sources
  node es.mjs preview <script.md> [--at 1.5,8] [--frames 12]
                                           contact sheet (or single frames) for a quick look
  node es.mjs render  <script.md> [--out dir] [--theme notebook|night|chalk|my.css] [--draft] [--no-music] [--fps 30]
                                           MP4 (with and without music) + 9:16 and 3:4 covers
script format: ${path.join(SKILL, 'reference', 'format.md')}`;

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const run = { setup: cmdSetup, lint: cmdLint, preview: cmdPreview, render: cmdRender }[cmd];
if (!run || args.help) { console.log(HELP); process.exit(run ? 0 : (cmd ? 1 : 0)); }
run(args).catch(e => die(e && e.stack ? e.stack : String(e)));
