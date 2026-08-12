/* md2slides runtime
 *
 * Reads the whole Markdown document out of <script type="text/markdown" id="mds-src">,
 * splits it into slides, renders them and wires up navigation. This is the only
 * implementation of the splitting and parsing: both the command-line converter and
 * MD Viewer merely assemble this file plus marked.js into an HTML page, which is what
 * guarantees the two produce identical decks.
 */
(function () {
  'use strict';

  var CLASS_OK = /^[A-Za-z0-9 _-]+$/;
  var NOTE_HEAD = /^>\s*(講稿|備註|notes?)\s*[：:]\s*/i;

  // ── Chrome strings ──────────────────────────────────────────
  // Chosen from <html lang>, which the CLI sets from --lang and MD Viewer sets from the
  // app's current language. Only the deck's own furniture is translated here; the slide
  // content is always the author's Markdown, untouched.
  var STRINGS = {
    'en': {
      nav: 'navigate', overview: 'overview', notes: 'notes',
      ovTitle: 'Overview', ovHint: 'click to jump · Esc to close',
      slideN: 'Slide {0}', notesLabel: 'Notes'
    },
    'zh-Hant': {
      nav: '翻頁', overview: '總覽', notes: '講稿',
      ovTitle: '總覽', ovHint: '點一下跳頁 · Esc 離開',
      slideN: '第 {0} 頁', notesLabel: '講稿'
    }
  };
  var L = STRINGS[/^zh\b/i.test(document.documentElement.lang || '') ? 'zh-Hant' : 'en'];

  // ── Shared: skip over code fences ───────────────────────────
  // Every line scan goes through here first, or a ## or --- inside a code block would be
  // mistaken for a slide break.
  function fenceOpen(line) {
    var m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    return m ? m[1][0] + m[1].length : null;   // e.g. "`3"
  }
  function fenceClose(line, tok) {
    var ch = tok[0], len = +tok.slice(1);
    var m = new RegExp('^\\s{0,3}(\\' + ch + '{' + len + ',})\\s*$').exec(line);
    return !!m;
  }

  // Shared line-by-line scanner: cb(line, inFence) returns the line(s) to emit (array or
  // string), null if cb consumed the line itself, or undefined to pass it through as-is.
  //
  // Lines inside a code fence still go to cb, just with inFence set. An early version
  // pushed them straight to out and skipped cb, which meant split() — which collects
  // content through cb — silently lost every code block.
  function scan(md, cb) {
    var lines = md.split('\n'), out = [], tok = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], inFence = false;
      if (tok) {
        inFence = true;
        if (fenceClose(line, tok)) tok = null;
      } else {
        var f = fenceOpen(line);
        if (f) { tok = f; inFence = true; }
      }
      var r = cb(line, inFence);
      if (r === null) continue;
      if (r === undefined) out.push(line);
      else if (r.push) out.push.apply(out, r);
      else out.push(r);
    }
    return out;
  }

  // ── 1. Speaker-note blockquote → ::: notes ──────────────────
  // Supports the shorthand "> Notes: …" (or the Chinese "> 講稿：…"): that blockquote and
  // every following > line become a speaker note.
  function speakerNotes(md) {
    var lines = md.split('\n'), out = [], tok = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (tok) { out.push(line); if (fenceClose(line, tok)) tok = null; continue; }
      var f = fenceOpen(line);
      if (f) { tok = f; out.push(line); continue; }

      if (NOTE_HEAD.test(line)) {
        var body = [line.replace(NOTE_HEAD, '')];
        while (i + 1 < lines.length && /^>/.test(lines[i + 1])) {
          body.push(lines[++i].replace(/^>\s?/, ''));
        }
        out.push('', '::: notes', body.join('\n'), ':::', '');
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  }

  // ── 2. fenced div: ::: cols side / ::: card / +++ ───────────
  // Always leave a blank line around the div tags, or CommonMark treats the whole thing as
  // one HTML block and stops rendering the Markdown inside it.
  function fencedDivs(md) {
    var stack = [];
    var out = scan(md, function (line, inFence) {
      if (inFence) return undefined;                        // inside a code block: pass through
      var m = /^:{3,}\s*(.*)$/.exec(line);
      if (m) {
        var spec = m[1].trim().replace(/:+$/, '').trim();
        if (spec) {
          if (!CLASS_OK.test(spec)) spec = 'note';        // reject odd class names
          var isCols = /(^|\s)cols(\s|$)/.test(spec);
          stack.push(isCols);
          var r = ['', '<div class="' + spec + '">', ''];
          if (isCols) r.push('<div class="col">', '');
          return r;
        }
        var wasCols = stack.pop();
        return wasCols ? ['', '</div>', '', '</div>', ''] : ['', '</div>', ''];
      }
      if (/^\+{3,}\s*$/.test(line) && stack[stack.length - 1]) {
        return ['', '</div>', '', '<div class="col">', ''];
      }
      return undefined;
    });
    while (stack.length) {                                  // close anything left open
      out.push('', '</div>', '');
      if (stack.pop()) out.push('</div>', '');
    }
    return out.join('\n');
  }

  // ── 3. Splitting into slides ────────────────────────────────
  // ## → a section (not a slide of its own), ### → one slide, a lone --- → forced break.
  // With split="h2", ## becomes the slide break and the only section is the document title.
  function split(md, level) {
    var parts = [], slides = [], cur = null, docTitle = '';
    var headRe = level === 'h2' ? /^##\s+(.*)$/ : /^###\s+(.*)$/;
    var partRe = level === 'h2' ? null : /^##\s+(.*)$/;
    var placeholder = false;    // the H1 claims a section slot; the first ## replaces it rather than adding one

    function open(title, cover) {
      var bits = String(title || '').split(/\s+\/\/\s+/);   // "Title // eyebrow subtitle"
      cur = {
        part: Math.max(0, parts.length - 1),
        title: clean(bits[0]),
        kicker: bits[1] ? bits[1].trim() : '',
        cover: !!cover,
        body: []
      };
      slides.push(cur);
    }
    function clean(t) {
      return String(t || '').replace(/^[Pp]?\d+\s*[.、·]\s*/, '').trim();   // drop numbering like "P3. "
    }
    function emit(line) {
      if (!cur) {
        if (!line.trim()) return;        // blank lines before the first heading aren't content, or we'd open a stray slide
        if (parts.length === 0) parts.push(docTitle || '');
        open('', false);
      }
      cur.body.push(line);
    }

    scan(md, function (line, inFence) {
      var m;
      if (inFence) { emit(line); return null; }             // ## / --- inside a code block aren't headings
      if ((m = /^#\s+(.*)$/.exec(line))) {                  // H1: document title + cover slide
        if (!docTitle) docTitle = clean(m[1]);
        if (parts.length === 0) { parts.push(docTitle); placeholder = true; }
        open(m[1], true);
        return null;
      }
      if (partRe && (m = partRe.exec(line))) {
        var name = clean(m[1]).replace(/^(第\s*\d+\s*部分|part\s+\d+)\s*[：:]\s*/i, '');
        if (placeholder) { parts[0] = name; placeholder = false; }
        else parts.push(name);
        cur = null;                                          // the next heading opens the slide
        return null;
      }
      if ((m = headRe.exec(line))) {
        if (parts.length === 0) parts.push(docTitle || '');
        open(m[1], false);
        return null;
      }
      if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {   // hr = forced slide break
        if (cur && cur.body.join('').trim()) { open('', false); }
        return null;
      }
      emit(line);
      return null;
    });

    slides = slides.filter(function (s) {
      return s.title || s.body.join('').trim();
    });
    return { parts: parts, slides: slides, title: docTitle };
  }

  // ── 4. Building the slides ──────────────────────────────────
  function render(md, level) {
    var doc = split(speakerNotes(md), level);
    var deck = document.getElementById('deck');
    var multi = doc.parts.length > 1;

    doc.slides.forEach(function (s, i) {
      var sec = document.createElement('section');
      sec.className = 'slide' + (s.cover ? ' is-cover' : '');
      sec.dataset.part = s.part;
      sec.dataset.title = s.title || L.slideN.replace('{0}', i + 1);

      var html = '';
      if (multi && !s.cover) {
        html += '<div class="eyebrow">' + escapeHtml((s.part + 1) + ' · ' + doc.parts[s.part]) +
                (s.kicker ? ' <b>／ ' + escapeHtml(s.kicker) + '</b>' : '') + '</div>';
      }
      if (s.title) html += (s.cover ? '<h1>' : '<h2>') + escapeHtml(s.title) + (s.cover ? '</h1>' : '</h2>');
      html += marked.parse(fencedDivs(s.body.join('\n')));

      var wrap = document.createElement('div');
      wrap.className = s.cover ? 'cover' : 'inner';
      wrap.innerHTML = html;
      sec.appendChild(wrap);
      deck.appendChild(sec);
    });

    // Every table scrolls horizontally, so a wide one can't blow out the layout.
    Array.prototype.forEach.call(deck.querySelectorAll('table'), function (t) {
      if (t.parentNode.classList.contains('tablewrap')) return;
      var w = document.createElement('div');
      w.className = 'tablewrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });

    // Only decks built with --highlight carry hljs.
    if (window.hljs) {
      Array.prototype.forEach.call(deck.querySelectorAll('pre code'), function (b) {
        try { hljs.highlightElement(b); } catch (err) { /* unknown language: leave it plain */ }
      });
    }

    return doc;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── 5. Navigation ───────────────────────────────────────────
  function nav(doc) {
    var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
    if (!slides.length) return;

    var rail = document.getElementById('rail');
    var bar = document.getElementById('bar');
    var counter = document.getElementById('counter');
    var partname = document.getElementById('partname');
    var overview = document.getElementById('overview');
    var ovgrid = document.getElementById('ovgrid');
    var current = 0;
    var hasNotes = !!document.querySelector('.notes');

    if (doc.parts.length > 1) {
      doc.parts.forEach(function () { rail.appendChild(document.createElement('i')); });
    } else {
      document.body.classList.add('no-rail');     // no sections: reclaim the space kept on the left
    }
    var ticks = rail.querySelectorAll('i');

    slides.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'ovcard';
      b.type = 'button';
      b.innerHTML = '<span class="n">' + pad(i + 1) +
                    (doc.parts.length > 1 ? ' · ' + escapeHtml(doc.parts[+s.dataset.part]) : '') +
                    '</span><span class="t">' + escapeHtml(s.dataset.title) + '</span>';
      b.addEventListener('click', function () { go(i); closeOverview(); });
      ovgrid.appendChild(b);
    });

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function go(n) {
      current = Math.max(0, Math.min(slides.length - 1, n));
      slides.forEach(function (s, i) { s.classList.toggle('current', i === current); });
      var part = +slides[current].dataset.part;
      Array.prototype.forEach.call(ticks, function (t, i) { t.classList.toggle('on', i === part); });
      if (partname) partname.textContent = doc.parts[part] || doc.title || '';
      if (counter) counter.textContent = (current + 1) + ' / ' + slides.length;
      if (bar) bar.style.width = ((current + 1) / slides.length * 100) + '%';
      if (location.hash !== '#' + (current + 1)) history.replaceState(null, '', '#' + (current + 1));
      window.scrollTo(0, 0);
    }

    function closeOverview() { overview.classList.remove('on'); }

    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Escape') { closeOverview(); return; }
      if (overview.classList.contains('on') && e.key !== 'o' && e.key !== 'O') return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': case ' ': go(current + 1); e.preventDefault(); break;
        case 'ArrowLeft': case 'PageUp': go(current - 1); e.preventDefault(); break;
        case 'Home': go(0); e.preventDefault(); break;
        case 'End': go(slides.length - 1); e.preventDefault(); break;
        case 'o': case 'O': overview.classList.toggle('on'); e.preventDefault(); break;
        case 's': case 'S':
          if (hasNotes) { document.body.classList.toggle('show-notes'); e.preventDefault(); }
          break;
      }
    });

    // Click the left or right half to page, which suits a presenter remote or a touchscreen.
    document.addEventListener('click', function (e) {
      if (e.target.closest('a, button, pre, table, .overview')) return;
      if (window.innerWidth < 720) return;
      go(current + (e.clientX > window.innerWidth * 0.5 ? 1 : -1));
    });

    if (!hasNotes) {
      var hint = document.getElementById('notehint');
      if (hint) hint.remove();
    }

    var start = parseInt((location.hash || '').slice(1), 10);
    go(start > 0 ? start - 1 : 0);
  }

  // Fill in the bits of chrome the template leaves empty, in the deck's language.
  function applyChrome() {
    var el = function (id) { return document.getElementById(id); };
    var set = function (id, s) { var n = el(id); if (n) n.textContent = s; };
    set('hint-nav', L.nav);
    set('hint-ov', L.overview);
    set('hint-notes', L.notes);
    set('ov-title', L.ovTitle);
    set('ov-hint', L.ovHint);
    // The speaker-notes label is drawn by CSS ::before, so it travels as a custom property.
    document.documentElement.style.setProperty(
      '--notes-label', '"' + L.notesLabel.replace(/"/g, '\\"') + '"');
  }

  // ── Startup ─────────────────────────────────────────────────
  function boot() {
    var src = document.getElementById('mds-src');
    if (!src) return;
    var md = src.textContent
      .replace(/<\\\/script/gi, '</script')     // undo the escaping done at assembly time
      .replace(/^\s*\n/, '');                   // the template leaves a newline after the tag for readability
    var level = src.dataset.split === 'h2' ? 'h2' : 'h3';

    applyChrome();
    marked.setOptions({ gfm: true, breaks: false });
    var doc = render(md, level);

    if (!document.title || document.title === 'Slides') {
      document.title = src.dataset.title || doc.title || 'Slides';
    }
    nav(doc);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
