/* explainer-shorts · timing
 * Turns parsed blocks into a schedule (when each block starts, how long it writes)
 * plus a list of semantic sound events. Pure function: no layout needed, so the CLI
 * can report the exact duration without opening a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESTiming = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RE_IDEO = /[㐀-鿿豈-﫿]/;
  var RE_CJK_PUNCT = /[　-〿＀-￯—…“”‘’]/;

  function count(plain) {
    var c = { cjk: 0, punct: 0, words: 0, letters: 0 };
    var s = String(plain || '');
    var re = /[㐀-鿿豈-﫿]|[　-〿＀-￯—…“”‘’]|[^\s㐀-鿿豈-﫿　-〿＀-￯—…“”‘’]+/g;
    var m;
    while ((m = re.exec(s))) {
      var x = m[0];
      if (RE_IDEO.test(x) && x.length === 1) c.cjk++;
      else if (RE_CJK_PUNCT.test(x) && x.length === 1) c.punct++;
      else { c.words++; c.letters += x.length; }
    }
    return c;
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function readSeconds(c) {
    return c.cjk / 5.0 + c.punct * 0.06 + c.words / 2.7 + c.letters * 0.012;
  }

  function writeSeconds(c, theme, factor) {
    var w;
    if (theme === 'night') w = c.cjk / 14 + c.punct * 0.03 + c.words * 0.14;
    else w = c.cjk / 9 + c.punct * 0.05 + c.words * 0.2 + c.letters * 0.01;
    w *= factor || 1;
    return theme === 'night' ? clamp(w, 0.25, 1.8) : clamp(w, 0.3, 2.4);
  }

  function firstNumber(plain) {
    var m = String(plain).match(/(\d[\d,]*(?:\.\d+)?)/);
    if (!m) return null;
    var v = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(v) || v === 0) return null;
    return { text: m[1], value: v, index: m.index, decimals: (m[1].split('.')[1] || '').length, grouped: m[1].indexOf(',') >= 0 };
  }

  function schedule(parsed) {
    var meta = parsed.meta;
    // write speed follows the theme's writing style (kinetic themes reveal faster)
    var theme = meta.writeStyle === 'kin' ? 'night' : (meta.writeStyle === 'ink' ? 'notebook' : meta.theme);
    var S = 1 / (meta.speed || 1);
    var blocks = parsed.blocks;
    var events = [];
    var t = 0.35 * S;
    var firstVisible = true;

    function ev(k, at, extra) {
      var e = { k: k, t: +at.toFixed(4) };
      if (extra) for (var key in extra) e[key] = extra[key];
      events.push(e);
      return e;
    }

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var c = count(b.plain);
      var read = readSeconds(c) * S;
      var w, adv;
      b.counts = c;
      b.start = t;

      switch (b.type) {
        case 'title':
          w = writeSeconds(c, theme, 1.1) * S;
          b.write = [t, w];
          b.underline = [t + w + 0.05 * S, 0.35 * S];
          ev('write', t, { dur: w, weight: 1.25 });
          ev('underline', b.underline[0], { dur: b.underline[1] });
          adv = Math.max(w + 0.55 * S, read + 0.25 * S);
          break;

        case 'heading':
          if (!firstVisible) {
            b.pan = [t, 0.85 * S];
            ev('pan', t, { dur: 0.85 * S });
            t += 0.5 * S;
          }
          w = writeSeconds(c, theme, 1) * S;
          b.write = [t, w];
          b.underline = [t + w, 0.3 * S];
          ev('write', t, { dur: w, weight: 0.9 });
          ev('underline', b.underline[0], { dur: b.underline[1] });
          adv = Math.max(w + 0.4 * S, read + 0.15 * S);
          break;

        case 'line':
        case 'item':
          w = writeSeconds(c, theme, 1) * S;
          b.write = [t, w];
          ev('write', t, { dur: w, weight: 1 });
          adv = Math.max(w + 0.3 * S, read);
          break;

        case 'note':
          w = writeSeconds(c, theme, 1.05) * S;
          b.write = [t, w];
          ev('write', t, { dur: w, weight: 0.8, style: 'note' });
          adv = Math.max(w + 0.3 * S, read);
          break;

        case 'guess':
          w = writeSeconds(c, theme, 0.9) * S;
          b.write = [t, w];
          b.strike = [t + w + 0.22 * S, 0.28 * S];
          ev('write', t, { dur: w, weight: 0.7, style: 'guess' });
          ev('strike', b.strike[0], { dur: b.strike[1] });
          adv = w + 0.22 * S + 0.28 * S + 0.28 * S;
          break;

        case 'reveal':
          b.pop = [t, 0.45 * S];
          b.number = firstNumber(b.plain);
          ev('reveal', t);
          if (b.number) {
            b.countUp = [t + 0.05 * S, 0.9 * S];
            ev('count', b.countUp[0], { dur: b.countUp[1], steps: 12 });
          }
          b.circle = [t + (b.number ? 0.95 : 0.32) * S, 0.55 * S];
          ev('circle', b.circle[0], { dur: b.circle[1] });
          adv = Math.max((b.number ? 2.0 : 1.5) * S, read + 0.6 * S);
          break;

        case 'tag':
          b.stamp = [t, 0.22 * S];
          ev('stamp', t);
          w = writeSeconds(c, theme, 1) * S;
          b.write = [t + 0.24 * S, w];
          ev('write', b.write[0], { dur: w, weight: 1 });
          adv = 0.24 * S + Math.max(w + 0.3 * S, read);
          break;

        case 'formula':
          var chars = b.plain.replace(/\s+/g, '').length;
          w = clamp(chars * 0.045, 0.5, 2.4) * S;
          b.write = [t, w];
          ev('type', t, { dur: w, n: chars });
          adv = w + Math.max(0.9 * S, read * 0.7);
          break;

        case 'source':
          b.fade = [t, 0.4 * S];
          adv = 0.7 * S;
          break;

        case 'svg':
          var dd = (b.drawSeconds || 1.6) * S;
          b.draw = [t, dd];
          ev('draw', t, { dur: dd });
          adv = dd + 0.6 * S;
          break;

        case 'pause':
          b.silence = [t, 0.75 * S];
          ev('silence', t, { dur: 0.75 * S });
          adv = 0.75 * S;
          break;

        default:
          adv = 0.5 * S;
      }
      if (b.type !== 'pause') firstVisible = false;
      b.end = t + adv;
      t += adv;
    }

    var end = { start: t + 0.25 * S, dur: 2.6 };
    ev('end', end.start);
    var duration = end.start + end.dur;
    return { blocks: blocks, events: events, end: end, duration: +duration.toFixed(3) };
  }

  return { schedule: schedule, count: count, readSeconds: readSeconds, writeSeconds: writeSeconds, firstNumber: firstNumber };
});
