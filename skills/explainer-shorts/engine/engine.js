/* explainer-shorts · player engine (runs inside headless Chromium)
 * Builds the page from parsed blocks, measures layout, plans the camera,
 * and exposes ES.renderAt(t) so the CLI can capture any frame deterministically.
 */
(function () {
  'use strict';
  var W = 1080, H = 1920;
  var ES = window.ES = { ready: false, error: null, warnings: [], debug: false };

  // ---------- math ----------
  function clamp(x, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return Math.min(b, Math.max(a, x)); }
  function P(t, a, d) { return d <= 0 ? (t >= a ? 1 : 0) : clamp((t - a) / d); }
  function eOC(p) { return 1 - Math.pow(1 - p, 3); }
  function eIOC(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function eOB(p) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); }
  function writeEase(p) { return 0.75 * p + 0.25 * eIOC(p); }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  var LAYOUT = { contentTop: 1400, regionTop: 330, regionBottom: 1430, secGap: 340 };

  // Theme settings live in the theme's CSS as custom properties on <body>,
  // so a new look is one CSS file. See reference/themes.md.
  function readThemeConfig() {
    var cs = getComputedStyle(document.body);
    function v(name, def) { var x = cs.getPropertyValue(name).trim().replace(/^["']|["']$/g, ''); return x || def; }
    var write = v('--es-write', 'ink') === 'kinetic' ? 'kin' : 'ink';
    var c = {
      write: write,
      formula: v('--es-formula', write === 'kin' ? 'type' : 'ink'),
      reveal: v('--es-reveal', write === 'kin' ? 'glow' : 'circle'),
      underline: v('--es-underline', write === 'kin' ? 'off' : 'on') === 'on',
      headingBar: v('--es-heading-bar', 'off') === 'on',
      shake: v('--es-shake', write === 'kin' ? 'off' : 'on') === 'on',
      stamp: v('--es-stamp', write === 'kin' ? 'pill' : 'rubber'),
      texture: v('--es-texture', 'none'),
      grainRGB: v('--es-grain-rgb', '140,126,104'),
      stars: v('--es-stars', 'off') === 'on',
      sound: v('--es-sound', write === 'kin' ? 'air' : 'pen'),
      music: v('--es-music', write === 'kin' ? 'plucks' : 'musicbox'),
      left: parseFloat(v('--es-left', '196')),
      right: parseFloat(v('--es-right', '110')),
      ink: v('--es-ink', '#2446A6'),
      mark: v('--es-mark', '#D23B2E'),
      accent: v('--es-accent', '#F2C14E'),
      glow: v('--es-glow', '242,193,78'),
      guessDim: parseFloat(v('--es-guess-dim', write === 'kin' ? '0.5' : '0')),
      hlSize: v('--es-hl-size', '34%'),
      bullet: v('--es-bullet', '•')
    };
    return c;
  }

  var $ = function (id) { return document.getElementById(id); };
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  // ---------- inline marks → units ----------
  var RE_MARK = /\*\*(.+?)\*\*|==(.+?)==|`(.+?)`|\*(.+?)\*/g;
  function tokens(text) {
    var out = [], last = 0, m;
    RE_MARK.lastIndex = 0;
    while ((m = RE_MARK.exec(text))) {
      if (m.index > last) out.push({ cls: '', text: text.slice(last, m.index) });
      if (m[1] !== undefined) out.push({ cls: 'em', text: m[1] });
      else if (m[2] !== undefined) out.push({ cls: 'hl', text: m[2] });
      else if (m[3] !== undefined) out.push({ cls: 'code', text: m[3] });
      else out.push({ cls: 'hand', text: m[4] });
      last = RE_MARK.lastIndex;
    }
    if (last < text.length) out.push({ cls: '', text: text.slice(last) });
    return out;
  }

  var PUNCT = /^[　-〿＀-￯—…“”‘’]$/;
  var OPENERS = '“‘（《「『【〔';
  var RE_PIECE = /\s+|[㐀-鿿豈-﫿]|[　-〿＀-￯—…“”‘’]|[^\s㐀-鿿豈-﫿　-〿＀-￯—…“”‘’]+/g;

  function pieces(s, perChar) {
    var raw = [], m;
    RE_PIECE.lastIndex = 0;
    while ((m = RE_PIECE.exec(s))) raw.push(m[0]);
    var units = [], pending = '';
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i];
      if (/^\s+$/.test(p)) { if (pending) { units.push({ t: pending }); pending = ''; } units.push({ sp: true, t: p }); continue; }
      if (PUNCT.test(p)) {
        if (OPENERS.indexOf(p) >= 0) { pending += p; continue; }
        var prev = units[units.length - 1];
        if (prev && !prev.sp && !pending) { prev.t += p; continue; }
      }
      if (pending) { p = pending + p; pending = ''; }
      units.push({ t: p });
    }
    if (pending) units.push({ t: pending });
    if (!perChar) return units;
    var out = [];
    units.forEach(function (u) {
      if (u.sp) { out.push(u); return; }
      Array.from(u.t).forEach(function (ch) { out.push({ t: ch }); });
    });
    return out;
  }

  function weightOf(t, perChar) {
    if (perChar) return 1;
    if (/[㐀-鿿豈-﫿]/.test(t)) return 1 + 0.25 * (Array.from(t).length - 1);
    return 0.45 + 0.07 * t.length;
  }

  // Fill a container with animated units; returns {units, hls}.
  function fillUnits(container, text, perChar) {
    var rec = { units: [], hls: [] };
    tokens(text).forEach(function (tk) {
      var host = container;
      if (tk.cls) { host = mk('span', tk.cls); container.appendChild(host); if (tk.cls === 'hl') rec.hls.push(host); }
      pieces(tk.text, perChar).forEach(function (u) {
        if (u.sp) { host.appendChild(document.createTextNode(u.t)); return; }
        var s = mk('span', 'u', u.t);
        host.appendChild(s);
        rec.units.push({ el: s, w: weightOf(u.t, perChar), state: -1 });
      });
    });
    var c = 0;
    rec.units.forEach(function (u) { u.c0 = c; c += u.w; u.c1 = c; });
    rec.total = c || 1;
    return rec;
  }

  // Static text (no per-unit animation) with marks; optionally wraps the first number.
  function fillStatic(container, text, number) {
    var rec = { hls: [], num: null };
    var done = !number;
    tokens(text).forEach(function (tk) {
      var host = container;
      if (tk.cls) { host = mk('span', tk.cls); container.appendChild(host); if (tk.cls === 'hl') rec.hls.push(host); }
      var s = tk.text;
      if (!done) {
        var idx = s.indexOf(number.text);
        if (idx >= 0) {
          if (idx > 0) host.appendChild(document.createTextNode(s.slice(0, idx)));
          var n = mk('span', 'num', number.text);
          host.appendChild(n);
          rec.num = n;
          s = s.slice(idx + number.text.length);
          done = true;
        }
      }
      if (s) host.appendChild(document.createTextNode(s));
    });
    return rec;
  }

  // ---------- geometry ----------
  function lineRects(el) {
    var r = document.createRange();
    r.selectNodeContents(el);
    var rects = Array.prototype.slice.call(r.getClientRects()).filter(function (q) { return q.width > 1 && q.height > 1; });
    var lines = [];
    rects.forEach(function (q) {
      var L = null;
      for (var i = 0; i < lines.length; i++) {
        if (Math.abs(lines[i].cy - (q.top + q.bottom) / 2) < q.height * 0.45) { L = lines[i]; break; }
      }
      if (!L) { L = { left: q.left, right: q.right, top: q.top, bottom: q.bottom, cy: (q.top + q.bottom) / 2 }; lines.push(L); }
      else { L.left = Math.min(L.left, q.left); L.right = Math.max(L.right, q.right); L.top = Math.min(L.top, q.top); L.bottom = Math.max(L.bottom, q.bottom); }
    });
    lines.sort(function (a, b) { return a.top - b.top; });
    return lines;
  }
  function unionRect(lines) {
    var u = { left: 1e9, right: -1e9, top: 1e9, bottom: -1e9 };
    lines.forEach(function (l) { u.left = Math.min(u.left, l.left); u.right = Math.max(u.right, l.right); u.top = Math.min(u.top, l.top); u.bottom = Math.max(u.bottom, l.bottom); });
    return u;
  }

  // ---------- ink paths ----------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function inkPath(d, color, width, opacity) {
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', width);
    p._baseOp = opacity === undefined ? 1 : opacity;
    $('ink').appendChild(p);
    return p;
  }
  function setDraw(p, x) {
    if (!p) return;
    if (p._len === undefined) p._len = p.getTotalLength();
    if (x <= 0) { if (p._st !== 0) { p.style.visibility = 'hidden'; p._st = 0; } return; }
    var L = p._len;
    p.style.visibility = 'visible';
    p.style.strokeDasharray = L + ' ' + L;
    p.style.strokeDashoffset = (L * (1 - x)).toFixed(2);
    p._st = 1;
  }
  function wavyLine(x0, x1, y, amp, seed) {
    var r = rng(seed);
    var a = amp * (0.6 + 0.8 * r()), b = amp * (0.6 + 0.8 * r());
    return 'M' + x0.toFixed(1) + ',' + (y + amp * 0.4).toFixed(1) +
      ' C' + (x0 + (x1 - x0) * 0.3).toFixed(1) + ',' + (y - a).toFixed(1) + ' ' +
      (x0 + (x1 - x0) * 0.7).toFixed(1) + ',' + (y + b).toFixed(1) + ' ' +
      x1.toFixed(1) + ',' + (y - amp * 0.3).toFixed(1);
  }
  function ellipsePath(cx, cy, rx, ry, start, turn, seed, rot) {
    var pts = [], n = 120;
    for (var i = 0; i <= n; i++) {
      var k = i / n, th = start + turn * k;
      var rr = 1 + 0.035 * Math.sin(2 * th + seed) + 0.018 * Math.sin(5 * th + seed * 2) + 0.06 * k;
      var x = rx * rr * Math.cos(th), y = ry * rr * Math.sin(th);
      var c = Math.cos(rot), s = Math.sin(rot);
      pts.push((cx + x * c - y * s).toFixed(1) + ',' + (cy + x * s + y * c).toFixed(1));
    }
    return 'M' + pts.join(' L');
  }

  // ---------- state ----------
  var S = { theme: null, C: null, blocks: [], sections: [], kfs: [], meta: null, sched: null, end: null, stars: null };

  function loadCss(href) {
    return new Promise(function (res) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      l.onload = function () { res(true); };
      l.onerror = function () { res(false); };
      document.head.appendChild(l);
    });
  }

  function grainTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 512;
    var g = c.getContext('2d');
    var img = g.createImageData(512, 512);
    var r = rng(7);
    var rgb = String((S.C && S.C.grainRGB) || '140,126,104').split(',').map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < 512 * 512; i++) {
      var n = r();
      var a = n > 0.5 ? Math.pow((n - 0.5) / 0.5, 1.4) * 26 : 0;
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  // ---------- build ----------
  function build(parsed, sched) {
    var meta = parsed.meta, C = S.C;
    var content = $('content');
    content.style.left = C.left + 'px';
    content.style.top = LAYOUT.contentTop + 'px';
    content.style.width = (W - C.left - C.right) + 'px';

    var secs = [];
    function sec(i) {
      while (secs.length <= i) {
        var s = mk('section', 'sec');
        if (secs.length > 0) s.style.marginTop = LAYOUT.secGap + 'px';
        content.appendChild(s);
        secs.push({ el: s, blocks: [], fadeAt: null });
      }
      return secs[i];
    }

    sched.blocks.forEach(function (b, idx) {
      b.idx = idx;
      if (b.type === 'pause') return;
      var host = sec(b.section);
      var el = mk('div', 'blk blk-' + b.type);
      b.el = el;
      host.blocks.push(b);
      switch (b.type) {
        case 'title': case 'heading': case 'line': case 'note': case 'guess':
          b.rec = fillUnits(el, b.text, false);
          break;
        case 'item':
          el.appendChild(mk('span', 'bullet', C.bullet));
          var body = mk('span', 'item-body');
          el.appendChild(body);
          b.rec = fillUnits(body, b.text, false);
          break;
        case 'tag':
          b.tagEl = mk('span', 'tag', b.label);
          el.appendChild(b.tagEl);
          var tb = mk('span', 'tag-body');
          el.appendChild(tb);
          b.rec = fillUnits(tb, b.text, false);
          break;
        case 'formula':
          b.rec = fillUnits(el, b.text, true);
          if (C.formula === 'type') { b.caret = mk('span', 'caret'); el.appendChild(b.caret); }
          break;
        case 'reveal':
          var inner = mk('span', 'reveal-text');
          el.appendChild(inner);
          b.inner = inner;
          b.rec = fillStatic(inner, b.text, b.number);
          break;
        case 'source':
          b.rec = fillStatic(el, b.text, null);
          break;
        case 'svg':
          el.innerHTML = b.svg;
          var svg = el.querySelector('svg');
          if (svg) {
            var vb = (svg.getAttribute('viewBox') || '0 0 300 300').split(/[\s,]+/).map(Number);
            var ar = vb[3] / vb[2] || 1;
            var wpx = Math.min(520, 360 / ar);
            svg.setAttribute('width', wpx);
            svg.setAttribute('height', wpx * ar);
          }
          break;
      }
      host.el.appendChild(el);
    });

    // end card
    var end = mk('div', 'end');
    var sigText = meta.author ? '— ' + meta.author : '';
    if (sigText) { var sig = mk('div', 'sig'); end.appendChild(sig); S.endSig = fillUnits(sig, sigText, false); S.endSigEl = sig; }
    if (meta.credit !== false) {
      var credit = mk('div', 'credit', meta.lang === 'zh' ? '画面、音效和配乐全部由代码生成 · explainer-shorts' : 'Frames, sound and music: all code · explainer-shorts');
      end.appendChild(credit);
      S.endCredit = credit;
    }
    content.appendChild(end);
    S.endEl = end;
    S.sections = secs;
  }

  function fitWidth(b, avail) {
    var el = b.el;
    if (['title', 'reveal', 'heading', 'formula'].indexOf(b.type) < 0) return;
    var base = parseFloat(getComputedStyle(el).fontSize);
    el.classList.add('fit');
    var r = document.createRange();
    r.selectNodeContents(el);
    var w = r.getBoundingClientRect().width;
    var ecs = getComputedStyle(el);
    var pad = (parseFloat(ecs.paddingLeft) || 0) + (parseFloat(ecs.paddingRight) || 0);
    var room = avail - pad - 4;
    if (w > room) {
      var f = room / w;
      if (f >= 0.6) el.style.fontSize = (base * f).toFixed(2) + 'px';
      else { el.classList.remove('fit'); el.style.fontSize = (base * 0.78).toFixed(2) + 'px'; }
    }
  }

  function measure() {
    var C = S.C;
    var avail = W - C.left - C.right;
    S.blocks.forEach(function (b) { if (b.el) fitWidth(b, avail); });

    S.blocks.forEach(function (b) {
      if (!b.el) return;
      var r = b.el.getBoundingClientRect();
      b.top = r.top; b.bottom = r.bottom; b.left = r.left; b.right = r.right;
      var lines = lineRects(b.inner || b.el);
      b.lines = lines;
      if ((b.type === 'line' || b.type === 'item' || b.type === 'note' || b.type === 'tag') && lines.length > 2) {
        ES.warnings.push({ line: b.line, message: 'Wraps onto ' + lines.length + ' lines on screen; split it into shorter lines.' });
      }
      if (b.type === 'title' && lines.length > 1) {
        ES.warnings.push({ line: b.line, message: 'Title wraps onto ' + lines.length + ' lines; put each line on its own # line.' });
      }
      if (b.type === 'svg' && r.height > 700) ES.warnings.push({ line: b.line, message: 'SVG doodle is very tall (' + Math.round(r.height) + 'px).' });
    });

    // section heights
    S.sections.forEach(function (s, i) {
      var r = s.el.getBoundingClientRect();
      s.top = r.top; s.bottom = r.bottom;
      if (r.height > LAYOUT.regionBottom - LAYOUT.regionTop) ES.warnings.push({ line: (s.blocks[0] || {}).line || 1, message: 'Screen ' + (i + 1) + ' is ' + Math.round(r.height) + 'px tall; the camera will scroll. Consider splitting with ##.' });
    });
    var er = S.endEl.getBoundingClientRect();
    S.endTop = er.top; S.endBottom = er.bottom;

    // backgrounds
    var contentBottom = S.endBottom + 2400;
    $('paper').style.height = contentBottom + 'px';
    if (C.texture === 'grain') {
      var g = $('grain');
      g.style.height = contentBottom + 'px';
      g.style.backgroundImage = 'url(' + grainTexture() + ')';
    }
    $('ink').setAttribute('width', W);
    $('ink').setAttribute('height', contentBottom);
    $('ink').setAttribute('viewBox', '0 0 ' + W + ' ' + contentBottom);

    // ink
    var seed = 1;
    S.blocks.forEach(function (b) {
      if (!b.el) return;
      var L = b.lines || [];
      var last = L[L.length - 1];
      seed += 1;
      if (b.type === 'title' && b.underline && last && C.underline) {
        var nextB = S.blocks[b.idx + 1];
        if (!nextB || nextB.type !== 'title') b.inkUnder = inkPath(wavyLine(last.left - 8, last.right + 10, last.bottom - 6, 5, seed), C.ink, 6);
      }
      if (b.type === 'heading' && last && C.underline) b.inkUnder = inkPath(wavyLine(last.left - 4, last.right + 6, last.bottom - 2, 4, seed), C.mark, 4, 0.85);
      if (b.type === 'guess') {
        b.inkStrikes = L.map(function (l, k) {
          var y = (l.top + l.bottom) / 2 + 4;
          var d = 'M' + (l.left - 10) + ',' + (y + 6) + ' Q' + ((l.left + l.right) / 2) + ',' + (y - 5 + k * 3) + ' ' + (l.right + 12) + ',' + (y - 6);
          return inkPath(d, C.mark, C.write === 'kin' ? 5 : 6);
        });
      }
      if (b.type === 'reveal' && L.length) {
        var u = unionRect(L);
        if (C.reveal === 'circle') {
          var cx = (u.left + u.right) / 2 + 4, cy = (u.top + u.bottom) / 2 + 4;
          var rx = (u.right - u.left) / 2 + 30, ry = (u.bottom - u.top) / 2 * 0.86 + 12;
          b.ink1 = inkPath(ellipsePath(cx, cy, rx, ry, Math.PI * 0.95, Math.PI * 2.1, 1.3 + seed * 0.1, -0.05), C.mark, 5.5);
          b.ink2 = inkPath(ellipsePath(cx + 4, cy + 3, rx - 10, ry - 8, Math.PI * 1.05, Math.PI * 2.04, 2.1 + seed * 0.1, 0.04), C.mark, 3, 0.75);
        } else {
          b.ink1 = inkPath('M' + u.left + ',' + (u.bottom + 10) + ' L' + u.right + ',' + (u.bottom + 10), C.accent, 8);
        }
      }
    });

    // number widths (no jitter during count-up)
    S.blocks.forEach(function (b) {
      if (b.rec && b.rec.num) {
        var nw = b.rec.num.getBoundingClientRect().width;
        b.rec.num.style.width = Math.ceil(nw + 2) + 'px';
      }
      if (b.type === 'formula' && S.C.formula === 'type' && getComputedStyle(b.el).display === 'inline-block') {
        b.el.style.width = Math.ceil(b.el.getBoundingClientRect().width + 30) + 'px';
      }
    });

    // doodles: measure every stroke so the pen can draw them in order
    S.blocks.forEach(function (b) {
      if (b.type !== 'svg') return;
      var shapes = b.el.querySelectorAll('path, line, polyline, polygon, circle, ellipse, rect');
      var c = 0;
      b.strokes = [];
      Array.prototype.forEach.call(shapes, function (sh) {
        var cs = getComputedStyle(sh);
        var hasStroke = cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0;
        var hasFill = cs.fill && cs.fill !== 'none' && parseFloat(cs.fillOpacity) > 0;
        var len = 0;
        try { len = sh.getTotalLength(); } catch (e) { len = 0; }
        if (!hasStroke) len = 0;
        var w = hasStroke ? Math.max(len, 8) : (hasFill ? 60 : 0);
        if (!w) return;
        var rec = { el: sh, len: len, c0: c, c1: c + w, fillOp: hasFill ? parseFloat(cs.fillOpacity) : 0, stroke: hasStroke };
        c += w;
        if (hasStroke) { sh.style.strokeDasharray = len + ' ' + len; sh.style.strokeDashoffset = len; }
        if (hasFill) sh.style.fillOpacity = 0;
        b.strokes.push(rec);
      });
      b.strokeTotal = c || 1;
    });

    // night: when does each section fade out?
    S.sections.forEach(function (s, i) {
      var next = S.sections[i + 1];
      if (!next) { s.fadeAt = null; return; }
      var h = next.blocks[0];
      s.fadeAt = h && h.pan ? h.pan[0] : (h ? h.start - 0.4 : null);
    });

    planCamera();
  }

  function planCamera() {
    var RT = LAYOUT.regionTop, RB = LAYOUT.regionBottom, RH = RB - RT;
    var nSec = S.sections.length;
    function secTarget(i) {
      var s = S.sections[i];
      var bottom = i === nSec - 1 ? Math.max(s.bottom, S.endBottom) : s.bottom;
      var h = bottom - s.top;
      if (h <= RH) return s.top - (RT + (RH - h) * 0.42);
      return s.top - RT;
    }
    var cam = secTarget(0), kfs = [];
    S.y0 = cam;
    S.blocks.forEach(function (b) {
      if (!b.el) return;
      var target = cam;
      if (b.type === 'heading' && b.pan) target = secTarget(b.section);
      if (b.bottom - target > RB) target = b.bottom - RB;
      if (Math.abs(target - cam) > 2) {
        var t0 = b.pan ? b.pan[0] : Math.max(0, b.start - 0.3);
        var d = b.pan ? b.pan[1] : 0.6;
        kfs.push({ t: t0, d: d, dy: target - cam });
        cam = target;
      }
    });
    var need = S.endBottom - (RB + 160);
    if (need > cam) kfs.push({ t: S.end.start - 0.35, d: 0.75, dy: need - cam });
    S.kfs = kfs;
  }

  function cameraY(t) {
    var y = S.y0 || 0;
    for (var i = 0; i < S.kfs.length; i++) { var k = S.kfs[i]; y += k.dy * eIOC(P(t, k.t, k.d)); }
    return y;
  }

  // ---------- per-frame ----------
  function setUnit(u, p, mode) {
    if (p <= 0) { if (u.state !== 0) { u.el.style.visibility = 'hidden'; u.state = 0; } return; }
    if (p >= 1) {
      if (u.state !== 2) { var s = u.el.style; s.visibility = 'visible'; s.clipPath = 'none'; s.opacity = ''; s.transform = ''; s.filter = ''; u.state = 2; }
      return;
    }
    var st = u.el.style;
    st.visibility = 'visible';
    if (mode === 'ink') {
      st.clipPath = 'inset(-35% ' + ((1 - p) * 100).toFixed(2) + '% -35% -14%)';
    } else if (mode === 'type') {
      st.clipPath = 'none';
    } else {
      st.opacity = p.toFixed(3);
      st.transform = 'translateY(' + ((1 - p) * 0.32).toFixed(3) + 'em)';
      st.filter = 'blur(' + ((1 - p) * 8).toFixed(2) + 'px)';
    }
    u.state = 1;
  }

  function animUnits(rec, t, ws, wd, mode) {
    if (!rec || !rec.units) return;
    var tot = rec.total;
    for (var k = 0; k < rec.units.length; k++) {
      var u = rec.units[k], p;
      if (mode === 'ink') {
        var s0 = ws + wd * u.c0 / tot, s1 = ws + wd * u.c1 / tot;
        p = writeEase(P(t, s0, s1 - s0));
      } else if (mode === 'type') {
        p = t >= ws + wd * u.c0 / tot ? 1 : 0;
      } else {
        p = eOC(P(t, ws + wd * 0.88 * u.c0 / tot, 0.42));
      }
      setUnit(u, p, mode);
    }
  }

  function setHls(rec, t, at) {
    if (!rec || !rec.hls || !rec.hls.length) return;
    var x = eOC(P(t, at, 0.45)) * 100;
    rec.hls.forEach(function (h) { h.style.backgroundSize = x.toFixed(1) + '% ' + S.C.hlSize; });
  }

  function show(el, on) { var v = on ? 'visible' : 'hidden'; if (el._vis !== v) { el.style.visibility = v; el._vis = v; } }

  function fmtNum(n, v) {
    var s = v.toFixed(n.decimals);
    if (n.grouped) { var parts = s.split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = parts.join('.'); }
    return s;
  }

  function renderBlock(b, t) {
    var C = S.C, el = b.el, mode = C.write;
    var startAt = b.write ? Math.min(b.start, b.write[0]) : b.start;
    if (b.type === 'heading' && b.write) startAt = b.write[0] - 0.12;
    var visible = t >= startAt - 0.001;
    show(el, visible);
    if (!visible) { hideInk(b); return; }
    switch (b.type) {
      case 'title': case 'line': case 'note': case 'item': case 'heading':
        animUnits(b.rec, t, b.write[0], b.write[1], mode);
        setHls(b.rec, t, b.write[0] + b.write[1] + 0.05);
        if (b.type === 'heading' && C.headingBar) el.style.setProperty('--bar', (96 * eOC(P(t, b.write[0] - 0.1, 0.5))).toFixed(1) + 'px');
        if (b.inkUnder) setDraw(b.inkUnder, eOC(P(t, b.underline[0], b.underline[1])));
        break;
      case 'guess':
        animUnits(b.rec, t, b.write[0], b.write[1], mode);
        var sp = eOC(P(t, b.strike[0], b.strike[1]));
        (b.inkStrikes || []).forEach(function (p, k) { setDraw(p, clamp(sp * b.inkStrikes.length - k)); });
        if (C.guessDim) el.style.opacity = (1 - C.guessDim * sp).toFixed(3);
        break;
      case 'tag':
        var tp = P(t, b.stamp[0], b.stamp[1]);
        b.tagEl.style.opacity = clamp(tp * 2.5).toFixed(3);
        var sc = C.stamp === 'pill' ? 1.35 - 0.35 * eOC(tp) : 1.7 - 0.7 * eOC(tp);
        b.tagEl.style.transform = (C.stamp === 'pill' ? '' : 'rotate(-2deg) ') + 'scale(' + sc.toFixed(4) + ')';
        animUnits(b.rec, t, b.write[0], b.write[1], mode);
        setHls(b.rec, t, b.write[0] + b.write[1] + 0.05);
        break;
      case 'formula':
        animUnits(b.rec, t, b.write[0], b.write[1], C.formula === 'type' ? 'type' : mode);
        if (b.caret) {
          var typing = t < b.write[0] + b.write[1] + 0.7;
          b.caret.style.opacity = typing ? (Math.floor((t - b.write[0]) * 2.2) % 2 === 0 ? 1 : 0.15) : 0;
          if (b.rec.units.length) {
            var lastVis = null;
            for (var k = 0; k < b.rec.units.length; k++) if (b.rec.units[k].state === 2) lastVis = b.rec.units[k].el;
            if (lastVis && lastVis.nextSibling !== b.caret) lastVis.parentNode.insertBefore(b.caret, lastVis.nextSibling);
          }
        }
        break;
      case 'reveal':
        var p = P(t, b.pop[0], b.pop[1]);
        el.style.opacity = clamp(p * 3).toFixed(3);
        el.style.transform = 'scale(' + (0.35 + 0.65 * eOB(p)).toFixed(4) + ')';
        if (b.number && b.rec.num) {
          var q = eOC(P(t, b.countUp[0], b.countUp[1]));
          b.rec.num.textContent = q >= 1 ? b.number.text : fmtNum(b.number, b.number.value * q);
        }
        if (C.reveal === 'circle') {
          setDraw(b.ink1, eIOC(P(t, b.circle[0], b.circle[1])));
          setDraw(b.ink2, eIOC(P(t, b.circle[0] + b.circle[1] * 0.85, b.circle[1] * 0.5)));
        } else {
          setDraw(b.ink1, eOC(P(t, b.circle[0], b.circle[1])));
          var g = P(t, b.pop[0] + 0.2, 0.9);
          var glow = g < 0.4 ? g / 0.4 : 1 - (g - 0.4) / 0.6 * 0.55;
          b.inner.style.textShadow = '0 0 ' + (44 * glow).toFixed(1) + 'px rgba(' + C.glow + ',' + (0.55 * glow).toFixed(3) + ')';
        }
        setHls(b.rec, t, b.circle[0]);
        break;
      case 'source':
        var f = eOC(P(t, b.fade[0], b.fade[1]));
        el.style.opacity = f.toFixed(3);
        el.style.transform = 'translateY(' + ((1 - f) * 10).toFixed(2) + 'px)';
        break;
      case 'svg':
        var dp = P(t, b.draw[0], b.draw[1]) * b.strokeTotal;
        (b.strokes || []).forEach(function (sk) {
          var q = clamp((dp - sk.c0) / (sk.c1 - sk.c0));
          if (sk.stroke) {
            var e = writeEase(q);
            sk.el.style.strokeDashoffset = (sk.len * (1 - e)).toFixed(2);
            sk.el.style.visibility = q > 0 ? 'visible' : 'hidden';
          }
          if (sk.fillOp) sk.el.style.fillOpacity = (sk.fillOp * eOC(clamp((q - 0.6) / 0.4))).toFixed(3);
          if (!sk.stroke && sk.fillOp) sk.el.style.visibility = q > 0 ? 'visible' : 'hidden';
        });
        break;
    }
  }

  function hideInk(b) {
    [b.inkUnder, b.ink1, b.ink2].forEach(function (p) { if (p) setDraw(p, 0); });
    (b.inkStrikes || []).forEach(function (p) { setDraw(p, 0); });
  }

  function drawStars(t, camY) {
    var cv = $('fx');
    if (!S.stars) {
      var r = rng(42);
      S.stars = [];
      for (var i = 0; i < 110; i++) S.stars.push({ x: r() * W, y: r() * H, s: 0.6 + r() * 2.0, f: 0.15 + r() * 0.5, ph: r() * 6.28, d: 0.04 + r() * 0.12 });
      cv.width = W; cv.height = H;
    }
    var g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    S.stars.forEach(function (st) {
      var y = ((st.y - camY * st.d) % H + H) % H;
      var a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * st.f * t + st.ph));
      g.fillStyle = 'rgba(220,228,255,' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(st.x, y, st.s, 0, Math.PI * 2); g.fill();
    });
  }

  function renderAt(t) {
    var C = S.C;
    var y = cameraY(t);
    var dx = 0, dy = 0;
    if (C.shake) {
      S.blocks.forEach(function (b) {
        if (b.type === 'reveal') {
          var at = b.pop[0] + 0.12, u = t - at;
          if (u >= 0 && u < 0.3) { var dd = Math.exp(-u / 0.07); dx += 5 * Math.sin(2 * Math.PI * 24 * u) * dd; dy += 4 * Math.cos(2 * Math.PI * 29 * u) * dd; }
        }
      });
    }
    $('world').style.transform = 'translate(' + dx.toFixed(2) + 'px,' + (dy - y).toFixed(2) + 'px)';
    if (C.stars) drawStars(t, y);

    S.sections.forEach(function (s) {
      s.o = s.fadeAt === null ? 1 : 1 - eOC(P(t, s.fadeAt + 0.1, 0.45));
      s.el.style.opacity = s.o.toFixed(3);
    });
    S.blocks.forEach(function (b) {
      if (!b.el) return;
      renderBlock(b, t);
      var so = S.sections[b.section] ? S.sections[b.section].o : 1;
      [b.inkUnder, b.ink1, b.ink2].concat(b.inkStrikes || []).forEach(function (p) { if (p) p.style.opacity = (p._baseOp * so).toFixed(3); });
    });

    // end card
    var e0 = S.end.start;
    show(S.endEl, t >= e0 - 0.001);
    if (S.endSig) animUnits(S.endSig, t, e0 + 0.1, 0.7, C.write);
    if (S.endCredit) { var cf = eOC(P(t, e0 + 0.7, 0.5)); S.endCredit.style.opacity = cf.toFixed(3); }

    if (ES.debug) { var d = $('debug'); d.style.display = 'block'; d.textContent = 't=' + t.toFixed(2) + 's'; }
  }

  // ---------- cover ----------
  function renderCover(kind) {
    var C = S.C, meta = S.meta;
    var h = kind === '3x4' ? 1440 : 1920;
    document.documentElement.style.height = h + 'px';
    document.body.style.height = h + 'px';
    $('stage').style.height = h + 'px';
    $('world').style.display = 'none';
    $('fx').style.display = C.stars ? 'block' : 'none';
    var cv = $('cover');
    cv.innerHTML = '';
    cv.style.display = 'block';
    cv.style.height = h + 'px';
    var pb = mk('div', 'paperbg'); pb.style.cssText = 'position:absolute;left:0;top:0;width:1080px;height:' + h + 'px'; cv.appendChild(pb);
    if (C.texture === 'grain') { var gr = mk('div', 'grainbg'); gr.style.cssText = 'position:absolute;left:0;top:0;width:1080px;height:' + h + 'px;background-image:url(' + grainTexture() + ')'; cv.appendChild(gr); }
    var titleLines = S.blocks.filter(function (b) { return b.type === 'title'; }).map(function (b) { return b.text; });
    if (!titleLines.length) titleLines = [meta.title];
    var tEl = mk('div', 'cv-title');
    titleLines.forEach(function (line) { var d = mk('div'); fillStatic(d, line, null); d.querySelectorAll('.hl').forEach(function (x) { x.style.backgroundSize = '100% ' + C.hlSize; }); tEl.appendChild(d); });
    cv.appendChild(tEl);
    var top = kind === '3x4' ? 300 : 520;
    tEl.style.top = top + 'px';
    // fit long titles
    var room = W - C.left - Math.max(90, C.right - 10);
    Array.prototype.forEach.call(tEl.children, function (d) {
      d.style.whiteSpace = 'nowrap';
      var r = document.createRange(); r.selectNodeContents(d);
      var w = r.getBoundingClientRect().width;
      if (w > room) d.style.fontSize = (parseFloat(getComputedStyle(tEl).fontSize) * room / w * 0.98).toFixed(1) + 'px';
    });
    var tr = tEl.getBoundingClientRect();
    if (C.underline) {
      var lines = lineRects(tEl.lastChild);
      var l = lines[lines.length - 1];
      if (l) {
        var svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('width', W); svg.setAttribute('height', h);
        svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
        var p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', wavyLine(l.left - 8, l.right + 12, l.bottom - 4, 6, 3));
        p.setAttribute('stroke', C.ink); p.setAttribute('stroke-width', 7); p.setAttribute('fill', 'none'); p.setAttribute('stroke-linecap', 'round');
        svg.appendChild(p); cv.appendChild(svg);
      }
    }
    if (meta.subtitle) {
      var sEl = mk('div', 'cv-sub');
      fillStatic(sEl, meta.subtitle, null);
      sEl.style.top = (tr.bottom + 70) + 'px';
      cv.appendChild(sEl);
    }
    if (meta.author) {
      var sg = mk('div', 'cv-sig', '— ' + meta.author);
      sg.style.top = (kind === '3x4' ? 1220 : 1500) + 'px';
      cv.appendChild(sg);
    }
    if (C.stars) drawStars(3.3, 0);
  }

  // ---------- boot ----------
  ES.boot = async function () {
    try {
      var cfg = window.__ES_CONFIG || {};
      ES.debug = !!cfg.debug;
      var parsed = ESParse.parse(cfg.script || '');
      if (cfg.theme) parsed.meta.theme = cfg.theme;
      if (cfg.music === false) parsed.meta.music = false;
      if (parsed.errors.length) { ES.error = parsed.errors; ES.ready = true; return; }
      S.theme = parsed.meta.theme;
      var custom = /\.css$/i.test(S.theme);
      document.body.className = custom ? 'custom' : S.theme;
      await Promise.all((cfg.fontCss || []).map(loadCss));
      var ok = await loadCss(cfg.themeCss || ('themes/' + S.theme + '.css'));
      if (!ok) throw new Error('Could not load theme CSS: ' + (cfg.themeCss || S.theme));
      S.C = readThemeConfig();
      ES.themeConfig = S.C;
      parsed.meta.writeStyle = S.C.write;
      var sched = ESTiming.schedule(parsed);
      S.meta = parsed.meta; S.sched = sched; S.blocks = sched.blocks; S.end = sched.end;

      build(parsed, sched);

      // load exactly the font faces and glyphs the page uses
      var jobs = [], seen = {};
      Array.prototype.forEach.call(document.querySelectorAll('#content *'), function (el) {
        var txt = el.textContent;
        if (!txt || !txt.trim()) return;
        var f = getComputedStyle(el).font;
        var key = f + '|' + txt.length;
        if (seen[key] && seen[key] === txt) return;
        seen[key] = txt;
        jobs.push(document.fonts.load(f, txt).catch(function () { return []; }));
      });
      await Promise.all(jobs);
      await document.fonts.ready;
      await new Promise(function (r) { setTimeout(r, 120); });
      await document.fonts.ready;

      measure();
      ES.duration = sched.duration;
      ES.events = sched.events;
      ES.meta = parsed.meta;
      ES.fps = parsed.meta.fps;
      ES.renderAt = renderAt;
      ES.renderCover = renderCover;
      ES.renderAudio = function (opts) {
        var meta = Object.assign({}, parsed.meta, { sound: S.C.sound, musicStyle: S.C.music }, opts || {});
        if (S.C.music === 'none') meta.music = false;
        return ESAudio.render(sched.events, meta, sched.duration);
      };
      ES.layout = function () {
        return S.blocks.filter(function (b) { return b.el; }).map(function (b) {
          return { line: b.line, type: b.type, start: +b.start.toFixed(2), top: Math.round(b.top), bottom: Math.round(b.bottom), lines: (b.lines || []).length };
        });
      };
      renderAt(0);
      ES.ready = true;
    } catch (e) {
      ES.error = [{ line: 0, message: String((e && e.stack) || e) }];
      ES.ready = true;
    }
  };
})();
