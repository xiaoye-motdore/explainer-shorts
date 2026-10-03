/* explainer-shorts · sound
 * Every sound effect and note of music is synthesized here with Web Audio
 * (OfflineAudioContext), driven by the same event list as the picture.
 * No samples, no external audio files.
 */
(function (root) {
  'use strict';
  var SR = 48000;

  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function makeNoise(ctx, seconds) {
    var n = Math.floor(seconds * SR), b = ctx.createBuffer(1, n, SR), d = b.getChannelData(0), r = rng(9);
    for (var i = 0; i < n; i++) d[i] = r() * 2 - 1;
    return b;
  }

  function makeIR(ctx, seconds, decay) {
    var n = Math.floor(seconds * SR), b = ctx.createBuffer(2, n, SR);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), r = rng(21 + ch), lp = 0, e = 0;
      for (var i = 0; i < n; i++) {
        lp = lp + 0.45 * ((r() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-i / SR / decay);
        e += d[i] * d[i];
      }
      var k = 1 / Math.sqrt(e);
      for (i = 0; i < n; i++) d[i] *= k;
    }
    return b;
  }

  // ---------------- music (synthesized straight into sample arrays) ----------------
  function synthMusic(style, duration) {
    var N = Math.ceil((duration + 1) * SR);
    var L = new Float32Array(N), R = new Float32Array(N);
    var r = rng(5);

    function add(buf, pan, t0) {
      var i0 = Math.floor(t0 * SR);
      var gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
      for (var i = 0; i < buf.length && i0 + i < N; i++) { L[i0 + i] += buf[i] * gl; R[i0 + i] += buf[i] * gr; }
    }
    function mbox(m, vel, dur) {
      var n = Math.floor(dur * SR), y = new Float32Array(n), f = mtof(m), w = 2 * Math.PI * f / SR;
      for (var i = 0; i < n; i++) {
        var tt = i / SR;
        var env = (1 - Math.exp(-tt / 0.004)) * Math.exp(-tt / 0.42);
        y[i] = (Math.sin(w * i) + 0.28 * Math.sin(2 * w * i) * Math.exp(-tt / 0.18) + 0.07 * Math.sin(3 * w * i) * Math.exp(-tt / 0.09)) * env * vel;
      }
      return y;
    }
    function ks(m, vel, dur, seed, bright) {
      var f = mtof(m), p = Math.max(2, Math.round(SR / f)), rr = rng(seed);
      var buf = new Float32Array(p), n = Math.floor(dur * SR), out = new Float32Array(n);
      for (var j = 0; j < p; j++) buf[j] = rr() * 2 - 1;
      for (j = 0; j < p; j++) buf[j] = (buf[j] + buf[(j + 1) % p] + buf[(j + 2) % p]) / 3;
      var lp = 0, a = bright || 0.22, fb = 0.996;
      for (var i = 0; i < n; i++) {
        var k = i % p, v = buf[k];
        out[i] = v;
        buf[k] = fb * 0.5 * (v + buf[(k + 1) % p]);
      }
      for (i = 0; i < n; i++) { lp += a * (out[i] - lp); out[i] = lp * vel * Math.exp(-i / SR / 1.3); }
      return out;
    }
    function pad(ms, dur, amp) {
      var n = Math.floor(dur * SR), y = new Float32Array(n);
      ms.forEach(function (m) {
        [-0.0025, 0.0025].forEach(function (det) {
          var w = 2 * Math.PI * mtof(m) * (1 + det) / SR;
          for (var i = 0; i < n; i++) y[i] += Math.sin(w * i) + Math.sin(3 * w * i) / 9;
        });
      });
      for (var i = 0; i < n; i++) {
        var tt = i / SR, env = Math.min(1, tt / 0.4) * Math.min(1, Math.max(0, (dur - tt) / 0.5));
        y[i] *= env * amp;
      }
      return y;
    }

    if (style === 'plucks') {
      // D major pentatonic plucks over a slow pad, 76 BPM
      var beat = 60 / 76, bar = 4 * beat, bi = 0;
      var chords = [
        { pad: [50, 57, 62, 66], arp: [74, 76, 78, 81, 78, 76], bass: 38 },
        { pad: [47, 54, 59, 62], arp: [71, 74, 78, 81, 78, 74], bass: 35 },
        { pad: [43, 50, 55, 59], arp: [71, 74, 76, 79, 76, 74], bass: 31 },
        { pad: [45, 52, 57, 61], arp: [69, 73, 76, 81, 76, 73], bass: 33 }
      ];
      for (var t0 = 0; t0 < duration + 0.5; t0 += bar, bi++) {
        var c = chords[bi % 4];
        add(pad(c.pad, bar + 0.6, 0.012), 0, t0);
        add(ks(c.bass, 0.55, 3.0, 300 + bi, 0.12), -0.1, t0);
        for (var k = 0; k < 6; k++) {
          var tt = t0 + k * (bar / 6);
          if (tt >= duration) break;
          add(ks(c.arp[k] + (k === 3 && bi % 2 ? 2 : 0), (k === 0 ? 0.55 : 0.38) + r() * 0.05, 2.0, 100 + bi * 8 + k, 0.35), k % 2 ? 0.35 : -0.35, tt);
        }
      }
    } else {
      // music box arpeggio + plucked bass + pad, F – Dm – Bb – C, 100 BPM
      var beat2 = 60 / 100, bar2 = 4 * beat2, b2 = 0;
      var ch2 = [
        { root: 65, minor: false, pad: [53, 57, 60], bass: 41 },
        { root: 62, minor: true, pad: [50, 53, 57], bass: 38 },
        { root: 58, minor: false, pad: [50, 53, 58], bass: 46 },
        { root: 60, minor: false, pad: [52, 55, 60], bass: 48 }
      ];
      for (var u0 = 0; u0 < duration + 0.5; u0 += bar2, b2++) {
        var cc = ch2[b2 % 4], third = cc.minor ? 15 : 16;
        var pat = [0, 7, 12, third, 19, third, 12, 7];
        for (var q = 0; q < pat.length; q++) {
          var tq = u0 + q * beat2 / 2;
          if (tq >= duration) break;
          add(mbox(cc.root + pat[q], (q === 0 ? 1 : 0.68) + (r() - 0.5) * 0.12, 1.3), q % 2 ? 0.3 : -0.3, tq);
        }
        add(ks(cc.bass, 0.9, 2.2, b2, 0.22), 0, u0);
        add(ks(cc.bass < 45 ? cc.bass + 7 : cc.bass - 5, 0.55, 2.2, 100 + b2, 0.22), 0, u0 + 2 * beat2);
        add(pad(cc.pad, bar2 + 0.4, 0.022), 0, u0);
      }
    }
    // normalize music bed to a fixed peak so the mix is predictable
    var peak = 1e-9;
    for (var i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    var g = 0.3 / peak;
    for (i = 0; i < N; i++) { L[i] *= g; R[i] *= g; }
    return { L: L, R: R, N: N };
  }

  // ---------------- render ----------------
  function render(events, meta, duration) {
    var len = Math.ceil(duration * SR);
    var ctx = new OfflineAudioContext(2, len, SR);
    var air = (meta.sound || (meta.theme === 'night' ? 'air' : 'pen')) === 'air';
    var R = rng(11);
    var master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    var sfx = ctx.createGain(); sfx.connect(master);
    var verb = ctx.createConvolver(); verb.buffer = makeIR(ctx, air ? 2.4 : 1.4, air ? 0.7 : 0.38); verb.connect(master);
    var sfxSend = ctx.createGain(); sfxSend.gain.value = air ? 0.28 : 0.12; sfx.connect(sfxSend); sfxSend.connect(verb);
    var noise = makeNoise(ctx, 3);

    function noiseSrc(t, dur) {
      var s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      s.start(Math.max(0, t), R() * 2.5); s.stop(Math.max(0, t) + dur + 0.02);
      return s;
    }
    function filt(type, f, q) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b; }
    function chain() { for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
    function envCurve(dur, fn) {
      var n = Math.max(8, Math.round(dur * 300)), c = new Float32Array(n);
      for (var i = 0; i < n; i++) c[i] = fn(i / (n - 1));
      return c;
    }
    function gainCurve(t, dur, curve) { var g = ctx.createGain(); g.gain.value = 0; g.gain.setValueCurveAtTime(curve, Math.max(0, t), Math.max(0.01, dur)); return g; }

    // --- primitives ---
    function pencil(t, dur, level) {
      var strokes = [], tt = 0;
      while (tt < dur) { var sd = 0.05 + R() * 0.08, a = 0.55 + R() * 0.45; strokes.push([tt, sd, a]); tt += sd + 0.012 + R() * 0.04; }
      var curve = envCurve(dur, function (x) {
        var tx = x * dur, v = 0;
        for (var i = 0; i < strokes.length; i++) { var s = strokes[i]; if (tx >= s[0] && tx <= s[0] + s[1]) v = Math.max(v, s[2] * Math.pow(Math.sin(Math.PI * (tx - s[0]) / s[1]), 0.7)); }
        return v * level;
      });
      var src = noiseSrc(t, dur);
      var g = gainCurve(t, dur, curve);
      chain(src, filt('bandpass', 3600, 0.55), g);
      var body = ctx.createGain(); body.gain.value = 0.45;
      chain(src, filt('bandpass', 520, 0.9), body, g);
      chain(g, filt('lowpass', 7500), sfx);
    }
    function marker(t, dur, level) {
      var src = noiseSrc(t, dur);
      var g = gainCurve(t, dur, envCurve(dur, function (x) { return Math.pow(Math.sin(Math.PI * x), 0.5) * level; }));
      chain(src, filt('bandpass', 2600, 0.9), g, sfx);
      var o = ctx.createOscillator(); o.frequency.value = 2300;
      var lfo = ctx.createOscillator(); lfo.frequency.value = 7; var lg = ctx.createGain(); lg.gain.value = 120; chain(lfo, lg, o.frequency);
      var og = gainCurve(t, dur, envCurve(dur, function (x) { return Math.pow(Math.sin(Math.PI * x), 0.5) * level * 0.18; }));
      chain(o, og, sfx);
      o.start(t); o.stop(t + dur + 0.02); lfo.start(t); lfo.stop(t + dur + 0.02);
    }
    function pop(t, level, f0, f1, dur) {
      f0 = f0 || 1000; f1 = f1 || 480; dur = dur || 0.12;
      [1, 2].forEach(function (h) {
        var o = ctx.createOscillator(); o.frequency.setValueAtTime(f0 * h, t); o.frequency.exponentialRampToValueAtTime(f1 * h, t + 0.05);
        var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * (h === 1 ? 1 : 0.25), t + 0.0015); g.gain.setTargetAtTime(0, t + 0.0015, 0.028);
        chain(o, g, sfx); o.start(t); o.stop(t + dur + 0.2);
      });
    }
    function bell(t, level, f0, decay) {
      decay = decay || 1;
      [[1, 1, 1.1], [2, 0.3, 0.55], [2.76, 0.22, 0.4], [5.4, 0.1, 0.2]].forEach(function (p) {
        var o = ctx.createOscillator(); o.frequency.value = f0 * p[0];
        var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * p[1] * 0.5, t + 0.002); g.gain.setTargetAtTime(0, t + 0.002, p[2] * decay);
        chain(o, g, sfx); o.start(t); o.stop(t + p[2] * decay * 6 + 0.1);
      });
    }
    function thump(t, level) {
      var o = ctx.createOscillator(); o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.07);
      var g = ctx.createGain(); g.gain.setValueAtTime(level, t); g.gain.setTargetAtTime(0, t, 0.05);
      chain(o, g, sfx); o.start(t); o.stop(t + 0.4);
      var src = noiseSrc(t, 0.06), cg = ctx.createGain(); cg.gain.setValueAtTime(level * 0.18, t); cg.gain.setTargetAtTime(0, t, 0.004);
      chain(src, filt('bandpass', 2000, 0.7), cg, sfx);
    }
    function whoosh(t, dur, level, fLo, fHi) {
      var src = noiseSrc(t, dur), bp = filt('bandpass', fLo, 1.2);
      bp.frequency.setValueAtTime(fLo, t); bp.frequency.exponentialRampToValueAtTime(fHi, t + dur);
      var g = gainCurve(t, dur, envCurve(dur, function (x) { return Math.pow(Math.sin(Math.PI * x), 1.5) * level; }));
      chain(src, bp, g, sfx);
    }
    function tick(t, level) {
      var src = noiseSrc(t, 0.03), g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.0005); g.gain.setTargetAtTime(0, t + 0.0005, 0.006);
      chain(src, filt('highpass', 3500), g, sfx);
    }
    function boing(t, level) {
      var o = ctx.createOscillator(); o.frequency.setValueAtTime(280, t); o.frequency.setTargetAtTime(580, t, 0.05);
      var lfo = ctx.createOscillator(); lfo.frequency.value = 18; var lg = ctx.createGain(); lg.gain.value = 25; chain(lfo, lg, o.frequency);
      var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, 0.09);
      chain(o, g, sfx); o.start(t); o.stop(t + 0.6); lfo.start(t); lfo.stop(t + 0.6);
    }
    function boom(t, level) {
      var o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.45);
      var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.01); g.gain.setTargetAtTime(0, t + 0.01, 0.32);
      chain(o, g, sfx); o.start(t); o.stop(t + 2);
    }
    function swish(t, dur, level, fLo, fHi) { whoosh(t, dur, level, fLo || 1800, fHi || 4200); }

    // --- events → sounds ---
    var night = air;
    events.forEach(function (e) {
      var t = e.t;
      switch (e.k) {
        case 'write':
          if (night) swish(t, Math.min(0.32, Math.max(0.16, e.dur * 0.4)), 0.05 * (e.weight || 1), 1500, 4800);
          else pencil(t, e.dur, (e.style === 'note' ? 0.12 : 0.14) * Math.min(1.2, e.weight || 1));
          break;
        case 'underline': if (night) swish(t, e.dur, 0.035, 2500, 5200); else marker(t, e.dur, 0.09); break;
        case 'strike': if (night) swish(t, Math.max(0.16, e.dur), 0.08, 3000, 7000); else marker(t, e.dur, 0.17); break;
        case 'reveal':
          if (night) { boom(t, 0.42); bell(t + 0.04, 0.22, 1318.5, 1.4); swish(t, 0.35, 0.05, 5000, 9000); }
          else { pop(t, 0.36, 720, 250, 0.16); bell(t + 0.07, 0.3, 1046.5); }
          break;
        case 'circle': if (night) swish(t, e.dur, 0.04, 2000, 6000); else { marker(t, e.dur, 0.15); marker(t + e.dur * 0.85, e.dur * 0.5, 0.1); } break;
        case 'count': for (var i = 0; i < (e.steps || 12); i++) tick(t + e.dur * Math.pow(i / (e.steps || 12), 0.6), night ? 0.1 : 0.14); break;
        case 'stamp': if (night) { thump(t, 0.16); tick(t, 0.08); } else thump(t, 0.22); break;
        case 'type': var n = Math.min(60, e.n || 10); for (var j = 0; j < n; j++) tick(t + e.dur * j / n + (R() - 0.5) * 0.01, (night ? 0.07 : 0.05) * (0.7 + 0.6 * R())); if (!night) pencil(t, e.dur, 0.08); break;
        case 'pan': whoosh(t, e.dur, night ? 0.12 : 0.1, night ? 180 : 250, night ? 1400 : 2200); break;
        case 'boing': if (night) pop(t, 0.2, 900, 600, 0.1); else boing(t, 0.16); break;
        case 'draw': if (night) { swish(t, Math.min(1.2, e.dur), 0.05, 700, 2600); pop(t + e.dur, 0.12, 1200, 900, 0.08); } else pencil(t, e.dur, 0.13); break;
        case 'end': bell(t, 0.16, 1396.9, 1); bell(t + 0.18, 0.16, 2093.0, 1); break;
      }
    });

    // --- music bed with ducking ---
    if (meta.music !== false) {
      var m = synthMusic(meta.musicStyle || (meta.theme === 'night' ? 'plucks' : 'musicbox'), duration);
      var mb = ctx.createBuffer(2, m.N, SR);
      mb.copyToChannel(m.L, 0); mb.copyToChannel(m.R, 1);
      var ms = ctx.createBufferSource(); ms.buffer = mb;
      var duck = ctx.createGain(); duck.gain.setValueAtTime(0, 0); duck.gain.linearRampToValueAtTime(1, 0.25);
      events.forEach(function (e) {
        if (e.k === 'silence') { duck.gain.setTargetAtTime(0, e.t, 0.02); duck.gain.setTargetAtTime(1, e.t + e.dur, 0.15); }
      });
      var fadeStart = Math.max(0.5, duration - 1.8);
      duck.gain.setValueAtTime(1, fadeStart);
      duck.gain.linearRampToValueAtTime(0, duration);
      var musicLevel = ctx.createGain(); musicLevel.gain.value = night ? 0.5 : 0.42;
      var mSend = ctx.createGain(); mSend.gain.value = night ? 0.45 : 0.35;
      chain(ms, duck, musicLevel, master);
      musicLevel.connect(mSend); mSend.connect(verb);
      ms.start(0);
    }

    return ctx.startRendering().then(function (buf) {
      var L = buf.getChannelData(0), Rr = buf.getChannelData(1), n = buf.length, peak = 1e-9;
      for (var i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
      var g = 0.89 / peak;
      var bytes = new ArrayBuffer(44 + n * 4), dv = new DataView(bytes);
      function str(o, s) { for (var k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); }
      str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, SR, true);
      dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
      var o = 44;
      for (i = 0; i < n; i++) {
        var a = Math.max(-1, Math.min(1, L[i] * g)), b = Math.max(-1, Math.min(1, Rr[i] * g));
        dv.setInt16(o, a < 0 ? a * 0x8000 : a * 0x7fff, true); dv.setInt16(o + 2, b < 0 ? b * 0x8000 : b * 0x7fff, true); o += 4;
      }
      return new Promise(function (res) {
        var fr = new FileReader();
        fr.onload = function () { res({ dataUrl: fr.result, peakBeforeNormalize: peak, seconds: n / SR }); };
        fr.readAsDataURL(new Blob([bytes], { type: 'audio/wav' }));
      });
    });
  }

  root.ESAudio = { render: render };
})(typeof self !== 'undefined' ? self : this);
