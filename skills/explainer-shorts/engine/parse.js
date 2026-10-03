/* explainer-shorts · script parser
 * Shared by the CLI (Node, via require) and the player page (browser, global ESParse).
 * The model writes content only; this file turns a short Markdown script into blocks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var THEMES = ['notebook', 'night', 'chalk'];
  var DEFAULTS = {
    title: '',
    subtitle: '',
    theme: 'notebook',
    author: '',
    music: true,
    credit: true,
    speed: 1,
    lang: 'auto',
    fps: 30
  };

  var EXAMPLES = {
    title: '# AI 交给你的东西，你怎么看得懂？',
    heading: '## 第 1 档 · 文字',
    reveal: '!! 讲解视频',
    guess: '~~更长的文章？~~',
    tag: '[规则] 一个词，只许一个意思',
    formula: '= v = √(2gh) = 133 m/s',
    source: '^ 来源：ASD-STE100',
    svg: '```svg\n<svg viewBox="0 0 200 200">…</svg>\n```'
  };

  function stripMarks(s) {
    return String(s)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/==(.+?)==/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\*(.+?)\*/g, '$1');
  }

  function toBool(v) {
    return /^(true|yes|on|1)$/i.test(String(v).trim());
  }

  function parse(src) {
    var out = { meta: {}, blocks: [], errors: [], warnings: [] };
    var k;
    for (k in DEFAULTS) out.meta[k] = DEFAULTS[k];
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var i = 0;

    function err(line, msg, example) {
      out.errors.push({ line: line, message: msg, example: example || '' });
    }

    // ---------- front matter ----------
    if (lines.length && lines[0].trim() === '---') {
      var end = -1;
      for (var j = 1; j < lines.length; j++) {
        if (lines[j].trim() === '---') { end = j; break; }
      }
      if (end < 0) {
        err(1, 'Front matter starts with --- but never closes.', '---\ntitle: …\ntheme: notebook\n---');
      } else {
        for (var f = 1; f < end; f++) {
          var fl = lines[f].trim();
          if (!fl || fl.charAt(0) === '#') continue;
          var m = fl.match(/^([A-Za-z_]+)\s*:\s*(.*)$/);
          if (!m) { err(f + 1, 'Front matter lines must look like "key: value".', 'theme: night'); continue; }
          var key = m[1].toLowerCase();
          var val = m[2].trim();
          var quoted = val.match(/^(["'])(.*)\1\s*(#.*)?$/);
          val = quoted ? quoted[2] : val.replace(/\s+#.*$/, '').trim();
          if (key === 'theme') {
            if (THEMES.indexOf(val) < 0 && !/\.css$/i.test(val)) err(f + 1, 'Unknown theme "' + val + '". Use one of: ' + THEMES.join(', ') + ', or a path to your own .css theme.', 'theme: notebook');
            else out.meta.theme = val;
          } else if (key === 'music' || key === 'credit') {
            out.meta[key] = toBool(val);
          } else if (key === 'speed') {
            var sp = parseFloat(val);
            if (!(sp >= 0.5 && sp <= 2)) err(f + 1, 'speed must be a number between 0.5 and 2.', 'speed: 1.1');
            else out.meta.speed = sp;
          } else if (key === 'fps') {
            var fps = parseInt(val, 10);
            if ([24, 25, 30, 50, 60].indexOf(fps) < 0) err(f + 1, 'fps must be 24, 25, 30, 50 or 60.', 'fps: 30');
            else out.meta.fps = fps;
          } else if (key in DEFAULTS) {
            out.meta[key] = val;
          } else {
            out.warnings.push({ line: f + 1, message: 'Unknown front matter key "' + key + '" (ignored).' });
          }
        }
        i = end + 1;
      }
    }

    // ---------- body ----------
    var section = 0;
    var sawHeading = false;
    for (; i < lines.length; i++) {
      var raw = lines[i];
      var t = raw.trim();
      var ln = i + 1;
      if (!t) continue;
      if (/^<!--.*-->$/.test(t)) continue;

      // fenced svg doodle
      if (/^```/.test(t)) {
        var lang = t.slice(3).trim().toLowerCase();
        var body = [];
        var closed = false;
        for (i = i + 1; i < lines.length; i++) {
          if (/^```\s*$/.test(lines[i].trim())) { closed = true; break; }
          body.push(lines[i]);
        }
        if (!closed) { err(ln, 'Code fence opened here is never closed.', EXAMPLES.svg); break; }
        var fm = lang.match(/^svg(?:\s+(\d+(?:\.\d+)?))?$/);
        if (!fm) { err(ln, 'Only ```svg fences are supported (inline doodles). Optional draw time in seconds: ```svg 2', EXAMPLES.svg); continue; }
        var drawSeconds = fm[1] ? Math.max(0.6, Math.min(5, parseFloat(fm[1]))) : 1.6;
        var svg = body.join('\n').trim();
        if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) { err(ln, 'The svg fence must contain one <svg>…</svg> element.', EXAMPLES.svg); continue; }
        if (/<script|\son[a-z]+\s*=|javascript:|<foreignObject|<iframe|(?:href|src)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(svg)) { err(ln, 'SVG doodles may not contain scripts, event handlers, embedded HTML or links to the web.', EXAMPLES.svg); continue; }
        out.blocks.push({ type: 'svg', svg: svg, text: '', plain: '', line: ln, section: section, drawSeconds: drawSeconds });
        continue;
      }

      if (t === '...' || t === '…' || t === '……') {
        out.blocks.push({ type: 'pause', text: '', plain: '', line: ln, section: section });
        continue;
      }

      var mm;
      if ((mm = t.match(/^##\s+(.+)$/))) {
        if (sawHeading || out.blocks.length) section += 1;
        sawHeading = true;
        push('heading', mm[1]);
        continue;
      }
      if (/^#{3,}\s/.test(t)) { err(ln, 'Only # (title) and ## (new screen) headings exist.', EXAMPLES.heading); continue; }
      if (/^#{1,2}$/.test(t)) { err(ln, 'A heading needs text after the #.', EXAMPLES.heading); continue; }
      if ((mm = t.match(/^#\s+(.+)$/))) { push('title', mm[1]); continue; }
      if ((mm = t.match(/^>\s*(.+)$/))) { push('note', mm[1]); continue; }
      if ((mm = t.match(/^!!\s*(.*)$/))) {
        if (!mm[1].trim()) { err(ln, 'A reveal (!!) needs text after it.', EXAMPLES.reveal); continue; }
        push('reveal', mm[1]);
        continue;
      }
      if ((mm = t.match(/^~~(.+)~~$/))) { push('guess', mm[1]); continue; }
      if ((mm = t.match(/^=\s+(.+)$/))) { push('formula', mm[1]); continue; }
      if ((mm = t.match(/^\^\s*(.+)$/))) { push('source', mm[1]); continue; }
      if ((mm = t.match(/^[-•]\s+(.+)$/))) { push('item', mm[1]); continue; }
      if ((mm = t.match(/^\[([^\]]{1,14})\]\s*(.+)$/))) {
        var b = push('tag', mm[2]);
        b.label = mm[1].trim();
        continue;
      }
      if (/^\[[^\]]*$/.test(t)) { err(ln, 'Tag is missing its closing ].', EXAMPLES.tag); continue; }
      push('line', t);
    }

    function push(type, text) {
      var b = { type: type, text: text.trim(), plain: stripMarks(text.trim()), line: ln, section: section };
      out.blocks.push(b);
      return b;
    }

    var visible = out.blocks.filter(function (b) { return b.type !== 'pause'; });
    if (!visible.length) err(1, 'The script has no content. Start with a # title line.', EXAMPLES.title);

    if (!out.meta.title) {
      var firstTitle = out.blocks.filter(function (b) { return b.type === 'title'; })
        .map(function (b) { return b.plain; });
      out.meta.title = firstTitle.join('') || (visible[0] ? visible[0].plain : '');
    }
    if (out.meta.lang === 'auto') {
      var all = out.blocks.map(function (b) { return b.plain; }).join('');
      out.meta.lang = /[㐀-鿿]/.test(all) ? 'zh' : 'en';
    }
    out.sections = section + 1;
    return out;
  }

  return { parse: parse, stripMarks: stripMarks, THEMES: THEMES, DEFAULTS: DEFAULTS, EXAMPLES: EXAMPLES };
});
