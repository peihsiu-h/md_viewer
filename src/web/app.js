/* MD Viewer — UI and rendering
 * File access always goes through the native shell (the WebView2 host); when opened
 * directly in a browser it falls back to browser APIs, which keeps debugging easy.
 * Dependencies: marked, DOMPurify, highlight.js (all in vendor/, embedded in the exe)
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = {
    tabs: $('#tabs'),
    panes: $('#panes'),
    newTab: $('#new-tab'),
    open: $('#btn-open'),
    save: $('#btn-save'),
    saveMore: $('#btn-save-more'),
    saveMenu: $('#save-menu'),
    toggleEditor: $('#btn-toggle-editor'),
    slides: $('#btn-slides'),
    slidesMore: $('#btn-slides-more'),
    slidesMenu: $('#slides-menu'),
    theme: $('#btn-theme'),
    themeMenu: $('#theme-menu'),
    lang: $('#btn-lang'),
    langMenu: $('#lang-menu'),
    fileInput: $('#file-input'),
    stName: $('#st-name'),
    stInfo: $('#st-info'),
    tpl: $('#pane-tpl'),
    slidesTpl: $('#slides-pane-tpl'),
    extDialog: $('#ext-dialog'),
    extBody: $('#ext-body'),
    extWarn: $('#ext-warn'),
    extKeep: $('#ext-keep'),
    extReload: $('#ext-reload'),
  };

  const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdwn|txt)$/i;
  const SESSION_KEY = 'mdviewer.session.v2';
  const SESSION_VER = 3;
  const THEME_KEY = 'mdviewer.theme';
  const LANG_KEY = 'mdviewer.lang';
  const MAX_SESSION_BYTES = 4 * 1024 * 1024;

  const state = { tabs: [], activeId: null, seq: 0, booted: false, lang: 'en' };

  /* ==================== Localisation ====================
   * Two string tables. The active one is chosen from navigator.language on first run
   * and from session.json afterwards; the native shell keeps its own copy of the same
   * choice (see the 'lang' message) so its dialogs match.
   *
   * Static markup carries data-i18n / data-i18n-title / data-i18n-placeholder
   * attributes and is filled in by applyStaticText(); everything generated at runtime
   * goes through tr(). Placeholders are {0}, {1}, … in argument order.
   */

  const LANGS = [
    { id: 'en', label: 'English' },
    { id: 'zh-Hant', label: '正體中文' },
  ];

  const I18N = {
    en: {
      'toolbar.open': 'Open',
      'toolbar.save': 'Save',
      'toolbar.editor': 'Editor',
      'toolbar.slides': 'Slides',
      'toolbar.newTab': 'New tab (Ctrl+T)',
      'toolbar.openTitle': 'Open file (Ctrl+O)',
      'toolbar.saveTitle': 'Save (Ctrl+S)',
      'toolbar.saveMore': 'Save a copy as HTML or PDF',
      'toolbar.editorTitle': 'Hide/show the editor (Ctrl+E)',
      'toolbar.slidesTitle': 'Preview slides in a tab (Ctrl+Shift+P)',
      'toolbar.slidesMore': 'More slide actions',
      'toolbar.theme': 'Theme',
      'toolbar.themeCurrent': 'Theme: {0}',
      'toolbar.lang': 'Language',
      'toolbar.langCurrent': 'Language: {0}',
      'menu.preview': '▷ Preview in a tab',
      'menu.export': '⭳ Export slides as HTML…',
      'menu.saveHtml': '⭳ Save as HTML…',
      'menu.savePdf': '⭳ Save as PDF…',
      'dialog.title': 'File changed on disk',
      'dialog.body': '“{0}” has changed on disk. Load the latest version?',
      'dialog.warn': 'This tab has unsaved changes; reloading will discard them.',
      'dialog.keep': 'Keep current',
      'dialog.reload': 'Load latest',
      'dropzone.title': 'Drop Markdown files here',
      'dropzone.subPre': 'or ',
      'dropzone.button': 'choose a file',
      'dropzone.subPost': ', or just start typing in the editor on the left',
      'editor.placeholder': 'Type Markdown here…',
      'divider.title': 'Drag to resize, double-click to reset',
      'tab.untitled': 'Untitled',
      'tab.welcome': 'Welcome',
      'tab.slides': '{0} (slides)',
      'tab.close': 'Close tab (Ctrl+W)',
      'tab.unsaved': ' (unsaved)',
      'alert.NOTE': 'Note',
      'alert.TIP': 'Tip',
      'alert.IMPORTANT': 'Important',
      'alert.WARNING': 'Warning',
      'alert.CAUTION': 'Caution',
      'link.newTab': 'Open in a new tab',
      'img.broken': '🖼 Image failed to load: {0}',
      'md.parseError': 'Markdown parsing failed:',
      'status.lines': '{0} lines · {1} characters',
      'status.pages': '{0} slides',
      'status.slidesPreview': 'Slide preview',
      'status.slidesSource': ' from: {0}',
      'status.slidesOrphan': ' (source tab closed)',
      'status.unsavedFile': '{0} (not saved to a file yet)',
      'status.newerOnDisk': ' ⚠ a newer version exists on disk',
      'editorToggle.hide': 'Hide the editor (Ctrl+E)',
      'editorToggle.show': 'Show the editor (Ctrl+E)',
      'flash.noEditor': 'Slide tabs have no editor',
      'flash.cantSave': 'Slide tabs cannot be saved — use “Export slides as HTML…”',
      'flash.saved': 'Saved {0}',
      'flash.downloaded': 'Downloaded {0}',
      'flash.exported': 'Exported {0}',
      'flash.savedPdf': 'Wrote {0}',
      'flash.imagesTooBig': 'Some images were left as links — inlining them all would be too large',
      'flash.emptyExport': 'This tab is empty — nothing to export',
      'flash.emptyPreview': 'This tab is empty — nothing to preview',
      'flash.sourceClosed': 'The source tab has been closed',
      'flash.missing': '⚠ File no longer exists: {0}',
      'error.openFailed': 'Could not open the file',
      'error.saveFailed': 'Save failed: {0}',
      'error.exportFailed': 'Export failed: {0}',
      'error.reloadFailed': 'Could not reload the file',
      'error.unknown': 'unknown error',
      'error.buildSlides': 'Could not build the slides: {0}',
      'error.buildDoc': 'Could not build the document: {0}',
      'error.pdfFailed': 'Could not write the PDF: {0}',
      'error.asset': 'Could not read {0}',
      'confirm.closeDirty': '“{0}” has unsaved changes. Close it anyway?',
      'theme.auto': 'Match system',
      'theme.github-light': 'GitHub Light',
      'theme.github-dark': 'GitHub Dark',
    },
    'zh-Hant': {
      'toolbar.open': '開啟',
      'toolbar.save': '儲存',
      'toolbar.editor': '編輯區',
      'toolbar.slides': '投影片',
      'toolbar.newTab': '開新分頁 (Ctrl+T)',
      'toolbar.openTitle': '開啟檔案 (Ctrl+O)',
      'toolbar.saveTitle': '儲存 (Ctrl+S)',
      'toolbar.saveMore': '另存成 HTML 或 PDF',
      'toolbar.editorTitle': '隱藏/展開編輯區 (Ctrl+E)',
      'toolbar.slidesTitle': '在分頁中預覽投影片 (Ctrl+Shift+P)',
      'toolbar.slidesMore': '投影片的其他動作',
      'toolbar.theme': '佈景主題',
      'toolbar.themeCurrent': '佈景主題：{0}',
      'toolbar.lang': '語言',
      'toolbar.langCurrent': '語言：{0}',
      'menu.preview': '▷ 在分頁中預覽',
      'menu.export': '⭳ 匯出投影片 HTML…',
      'menu.saveHtml': '⭳ 另存 HTML…',
      'menu.savePdf': '⭳ 另存 PDF…',
      'dialog.title': '檔案已被其他程式修改',
      'dialog.body': '「{0}」在磁碟上的內容已經變更。要載入最新版本嗎？',
      'dialog.warn': '目前分頁有未儲存的修改，重新載入會蓋掉。',
      'dialog.keep': '保留目前內容',
      'dialog.reload': '載入最新版本',
      'dropzone.title': '把 Markdown 檔案拖曳進來',
      'dropzone.subPre': '或 ',
      'dropzone.button': '選擇檔案',
      'dropzone.subPost': '，也可以在左邊的編輯區直接開始打字',
      'editor.placeholder': '在此輸入 Markdown…',
      'divider.title': '拖曳調整寬度，雙擊重設',
      'tab.untitled': '未命名',
      'tab.welcome': '歡迎',
      'tab.slides': '{0}（投影片）',
      'tab.close': '關閉分頁 (Ctrl+W)',
      'tab.unsaved': '（未儲存）',
      'alert.NOTE': '備註',
      'alert.TIP': '提示',
      'alert.IMPORTANT': '重要',
      'alert.WARNING': '警告',
      'alert.CAUTION': '注意',
      'link.newTab': '在新分頁開啟',
      'img.broken': '🖼 圖片無法載入：{0}',
      'md.parseError': 'Markdown 解析失敗：',
      'status.lines': '{0} 行 · {1} 字元',
      'status.pages': '{0} 頁',
      'status.slidesPreview': '投影片預覽',
      'status.slidesSource': '　來源：{0}',
      'status.slidesOrphan': '　（來源分頁已關閉）',
      'status.unsavedFile': '{0}（尚未儲存到檔案）',
      'status.newerOnDisk': '　⚠ 磁碟上有較新的版本',
      'editorToggle.hide': '隱藏編輯區 (Ctrl+E)',
      'editorToggle.show': '展開編輯區 (Ctrl+E)',
      'flash.noEditor': '投影片分頁沒有編輯區',
      'flash.cantSave': '投影片分頁存不了，要存檔請用「匯出投影片 HTML…」',
      'flash.saved': '已儲存 {0}',
      'flash.downloaded': '已下載 {0}',
      'flash.exported': '已匯出 {0}',
      'flash.savedPdf': '已寫出 {0}',
      'flash.imagesTooBig': '部分圖片維持連結未內嵌 —— 全部內嵌會讓檔案過大',
      'flash.emptyExport': '這個分頁是空的，沒東西可以匯出',
      'flash.emptyPreview': '這個分頁是空的，沒東西可以預覽',
      'flash.sourceClosed': '來源分頁已關閉',
      'flash.missing': '⚠ 檔案已不存在：{0}',
      'error.openFailed': '無法開啟檔案',
      'error.saveFailed': '儲存失敗：{0}',
      'error.exportFailed': '匯出失敗：{0}',
      'error.reloadFailed': '無法重新載入檔案',
      'error.unknown': '未知錯誤',
      'error.buildSlides': '產生投影片失敗：{0}',
      'error.buildDoc': '產生文件失敗：{0}',
      'error.pdfFailed': '無法寫出 PDF：{0}',
      'error.asset': '讀不到 {0}',
      'confirm.closeDirty': '「{0}」尚未儲存，確定關閉？',
      'theme.auto': '跟隨系統',
      'theme.github-light': 'GitHub 淺色',
      'theme.github-dark': 'GitHub 深色',
    },
  };

  const langById = id => LANGS.find(l => l.id === id);

  function tr(key, ...args) {
    const table = I18N[state.lang] || I18N.en;
    const s = table[key] != null ? table[key] : (I18N.en[key] != null ? I18N.en[key] : key);
    return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : m)) : s;
  }

  /* ==================== Native shell bridge ==================== */

  const HOST = (() => {
    const bridge = window.chrome && window.chrome.webview;
    const pending = new Map();
    const queued = [];
    let seq = 0;

    if (bridge) {
      bridge.addEventListener('message', ev => {
        const m = ev.data;
        if (!m) return;
        if (m.id != null && pending.has(m.id)) {
          pending.get(m.id)(m);
          pending.delete(m.id);
          return;
        }
        if (m.cmd === 'openFiles') {
          if (state.booted) openHostFiles(m.files);
          else queued.push(m.files);
          return;
        }
        // Window regained focus → take the chance to check whether this file changed underneath us
        if (m.cmd === 'windowActivated' && state.booted) checkExternal(activeTab());
      });
    }

    return {
      available: !!bridge,
      post(msg) { if (bridge) bridge.postMessage(msg); },
      send(cmd, data) {
        if (!bridge) return Promise.resolve({ ok: false, error: 'no host' });
        const id = ++seq;
        return new Promise(resolve => {
          pending.set(id, resolve);
          bridge.postMessage(Object.assign({ id, cmd }, data || {}));
        });
      },
      // Sending the File objects along is what lets the native side get real dropped paths
      canSendFiles: !!(bridge && bridge.postMessageWithAdditionalObjects),
      sendFiles(cmd, files) {
        const id = ++seq;
        return new Promise(resolve => {
          pending.set(id, resolve);
          bridge.postMessageWithAdditionalObjects({ id, cmd }, files);
        });
      },
      flush() {
        while (queued.length) openHostFiles(queued.shift());
      },
    };
  })();

  /* ==================== Markdown rendering ==================== */

  marked.setOptions({ gfm: true, breaks: false, headerIds: false, mangle: false });

  const ALERT_ICONS = {
    NOTE: 'ℹ️',
    TIP: '💡',
    IMPORTANT: '❗',
    WARNING: '⚠️',
    CAUTION: '🚫',
  };

  function slugify(text, used) {
    let base = text.trim().toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{Letter}\p{Number}\-_]/gu, '');
    if (!base) base = 'section';
    let slug = base, i = 1;
    while (used.has(slug)) slug = `${base}-${++i}`;
    used.add(slug);
    return slug;
  }

  function decorateAlerts(root) {
    root.querySelectorAll('blockquote').forEach(bq => {
      const first = bq.firstElementChild;
      if (!first || first.tagName !== 'P') return;
      const m = first.textContent.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (!m) return;
      const kind = m[1].toUpperCase();
      const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
      const tn = walker.nextNode();
      if (tn) tn.nodeValue = tn.nodeValue.replace(/^\[!\w+\][ \t]*\r?\n?/, '');
      if (!first.textContent.trim() && !first.querySelector('img, code')) first.remove();
      const title = document.createElement('div');
      title.className = 'md-alert-title';
      title.append(ALERT_ICONS[kind] + ' ', tr('alert.' + kind));
      bq.classList.add('md-alert');
      bq.dataset.kind = kind;
      bq.prepend(title);
    });
  }

  function decorateHeadings(root) {
    const used = new Set();
    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      if (!h.id) h.id = slugify(h.textContent, used);
    });
  }

  const isAbsolute = href => /^[a-z][a-z0-9+.-]*:/i.test(href);

  // Resolve a relative href into an absolute filesystem path for the host to open.
  function resolveLocal(tab, href) {
    if (!tab.path) return null;
    const dir = tab.path.replace(/[\\/][^\\/]*$/, '');
    try {
      const u = new URL(href, 'file:///' + dir.replace(/\\/g, '/') + '/');
      return decodeURIComponent(u.pathname.replace(/^\//, '')).replace(/\//g, '\\');
    } catch {
      return null;
    }
  }

  function decorateLinks(root, tab) {
    root.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        a.addEventListener('click', e => {
          e.preventDefault();
          const target = root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }
      if (isAbsolute(href)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return;
      }
      // Points at a sibling .md: open it in a new tab.
      if (MD_EXT.test(href.split(/[?#]/)[0]) && tab.path && HOST.available) {
        a.title = tr('link.newTab');
        a.addEventListener('click', async e => {
          e.preventDefault();
          const full = resolveLocal(tab, href);
          if (!full) return;
          const r = await HOST.send('openPath', { path: full });
          if (r.ok) openHostFiles(r.files);
          else alert(r.error || tr('error.openFailed'));
        });
      }
    });
  }

  function decorateCode(root) {
    root.querySelectorAll('pre > code').forEach(code => {
      const cls = [...code.classList].find(c => c.startsWith('language-'));
      if (!cls) return;
      const lang = cls.slice(9).toLowerCase();
      if (hljs.getLanguage(lang)) {
        try { hljs.highlightElement(code); } catch { /* highlighting failed: leave it plain */ }
      }
    });
  }

  // Rewrite the index-th task item in the source, in order of appearance (skipping code fences).
  function toggleTaskInSource(text, index, checked) {
    const lines = text.split('\n');
    let inFence = false, n = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[ xX](\])/);
      if (!m) continue;
      if (n === index) {
        lines[i] = line.slice(0, m[1].length) + (checked ? 'x' : ' ') + line.slice(m[1].length + 1);
        return lines.join('\n');
      }
      n++;
    }
    return null;
  }

  // The classes are presentation — hide the bullet, pull the box into the margin — so
  // they belong anywhere the document is shown, exported files included. Making the boxes
  // live is the part only the app can offer.
  function markTaskLists(root) {
    root.querySelectorAll('li > input[type="checkbox"]').forEach(cb => {
      const li = cb.parentElement;
      li.classList.add('task-list-item');
      if (li.parentElement) li.parentElement.classList.add('contains-task-list');
    });
  }

  function decorateTaskLists(root, tab) {
    root.querySelectorAll('li > input[type="checkbox"]').forEach((cb, i) => {
      cb.disabled = false;
      cb.addEventListener('change', () => {
        const next = toggleTaskInSource(tab.pane.editor.value, i, cb.checked);
        if (next == null) { cb.checked = !cb.checked; return; }
        setEditorValue(tab, next);
      });
    });
  }

  // Relative-path images: load them through the virtual origin the host maps for us.
  function decorateImages(root, tab) {
    root.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (src && !isAbsolute(src) && tab.base) {
        try { img.src = new URL(encodeURI(src), tab.base).href; } catch { /* leave as-is */ }
      }
      img.addEventListener('error', () => {
        img.replaceWith(Object.assign(document.createElement('span'), {
          className: 'broken-img',
          textContent: tr('img.broken', src),
        }));
      }, { once: true });
    });
  }

  // Markdown → sanitised DOM, plus the decorations that make sense anywhere the document
  // is shown. The rest (links, task lists, images) only make sense inside the app and are
  // added by render(); "Save as HTML" stops here, so both routes share one pipeline.
  function renderInto(node, src) {
    let html;
    try {
      html = marked.parse(src);
    } catch (err) {
      html = `<pre>${tr('md.parseError')}\n${String(err && err.message || err)}</pre>`;
    }
    node.innerHTML = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['align', 'checked', 'disabled', 'start', 'colspan', 'rowspan'],
    });
    decorateAlerts(node);
    decorateHeadings(node);
    decorateCode(node);
    markTaskLists(node);
    return node;
  }

  function render(tab) {
    if (tab.kind === 'slides') return;              // slide tabs live in an iframe, not here
    const view = renderInto(tab.pane.preview, tab.pane.editor.value);
    decorateLinks(view, tab);
    decorateTaskLists(view, tab);
    decorateImages(view, tab);
    updateStatus();
  }

  // Content changed by the program rather than the user (e.g. ticking a task item).
  function setEditorValue(tab, text) {
    const top = tab.pane.previewWrap.scrollTop;
    tab.pane.editor.value = text;
    tab.dirty = text !== tab.savedText;
    updateTabLabel(tab);
    updateEmptyState(tab);
    render(tab);
    tab.pane.previewWrap.scrollTop = top;
    scheduleSessionSave();
  }

  /* ==================== Tabs ==================== */

  function makePane() {
    const node = el.tpl.content.firstElementChild.cloneNode(true);
    applyStaticText(node);
    return {
      root: node,
      editor: $('.editor', node),
      editorWrap: $('.editor-wrap', node),
      divider: $('.divider', node),
      previewWrap: $('.preview-wrap', node),
      preview: $('.preview', node),
      dzOpen: $('.dz-open', node),
      dropzone: $('.dropzone', node),
      editorToggle: $('.editor-toggle', node),
    };
  }

  function makeSlidesPane() {
    const node = el.slidesTpl.content.firstElementChild.cloneNode(true);
    applyStaticText(node);
    return { root: node, frame: $('.slides-frame', node) };
  }

  // Tabs whose name is generated rather than taken from a file (Untitled, Welcome, the
  // slide previews) remember how to rebuild it so a language switch can relabel them.
  const autoName = (key, arg) => (key ? tr('tab.' + key, arg) : null);

  function createTab({ name = null, nameKey = null, nameArg = null, text = '', path = null, base = null, activate = true, ratio = 50, editorVisible = true, mtime = null, size = -1, kind = 'md', sourceId = null } = {}) {
    const id = `t${++state.seq}`;
    const isSlides = kind === 'slides';
    const pane = isSlides ? makeSlidesPane() : makePane();
    const tab = {
      id, path, base, pane, kind, sourceId,
      name: name != null ? name : (autoName(nameKey, nameArg) || tr('tab.untitled')),
      nameKey, nameArg,
      dirty: false,
      editorVisible,
      ratio,
      savedText: text,
      renderTimer: null,
      syncLock: 0,
      mtime, size,          // on-disk timestamp when opened, used to spot external edits
      ignoreStamp: null,    // the version the user chose to keep; don't ask about it again
      checking: false,
    };

    if (!isSlides) pane.editor.value = text;
    el.panes.appendChild(pane.root);

    const btn = document.createElement('div');
    btn.className = 'tab' + (isSlides ? ' kind-slides' : '');
    btn.dataset.id = id;
    btn.innerHTML = '<span class="dot"></span><span class="title"></span>';
    const close = document.createElement('button');
    close.className = 'close';
    close.title = tr('tab.close');
    close.textContent = '×';
    close.addEventListener('mousedown', e => e.stopPropagation());
    close.addEventListener('click', e => { e.stopPropagation(); closeTab(id); });
    btn.appendChild(close);
    btn.addEventListener('click', () => activateTab(id));
    btn.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
    el.tabs.appendChild(btn);
    tab.el = btn;

    if (!isSlides) {
      wirePane(tab);
      state.tabs.push(tab);
      applyEditorVisibility(tab);
      updateEmptyState(tab);
      render(tab);
    } else {
      state.tabs.push(tab);
    }
    updateTabLabel(tab);
    if (activate) activateTab(id);
    scheduleSessionSave();
    return tab;
  }

  function updateTabLabel(tab) {
    $('.title', tab.el).textContent = tab.name;
    tab.el.title = (tab.path || tab.name) + (tab.dirty ? tr('tab.unsaved') : '');
    tab.el.classList.toggle('dirty', tab.dirty);
    reportTitle();
  }

  function activateTab(id) {
    const tab = getTab(id);
    if (!tab) return;
    state.activeId = id;
    state.tabs.forEach(t => {
      t.el.classList.toggle('active', t.id === id);
      t.pane.root.hidden = t.id !== id;
    });
    tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    el.toggleEditor.classList.toggle('on', tab.kind !== 'slides' && tab.editorVisible);
    updateStatus();
    reportTitle();
    // Arrow keys are handled by the runtime inside the iframe; without focus, no paging.
    if (tab.kind === 'slides') focusSlides(tab);
    else if (tab.editorVisible) tab.pane.editor.focus({ preventScroll: true });
    saveSession();
    checkExternal(tab);            // deliberately not awaited: don't let disk I/O slow the switch
  }

  function closeTab(id) {
    const idx = state.tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const tab = state.tabs[idx];
    if (tab.dirty && !confirm(tr('confirm.closeDirty', tab.name))) return;
    tab.el.remove();
    tab.pane.root.remove();
    state.tabs.splice(idx, 1);
    if (!state.tabs.length) {
      createTab({ nameKey: 'untitled' });
      return;
    }
    if (state.activeId === id) activateTab(state.tabs[Math.min(idx, state.tabs.length - 1)].id);
    saveSession();
  }

  const getTab = id => state.tabs.find(t => t.id === id);
  const activeTab = () => getTab(state.activeId);

  function isBlank(tab) {
    if (tab.kind === 'slides') return false;        // never a drop/open target
    return !tab.path && !tab.pane.editor.value.trim();
  }

  function updateEmptyState(tab) {
    if (tab.kind === 'slides') return;
    tab.pane.root.classList.toggle('empty', isBlank(tab));
  }

  /* ==================== Pane wiring ==================== */

  function wirePane(tab) {
    const p = tab.pane;

    p.editor.addEventListener('input', () => {
      const changed = p.editor.value !== tab.savedText;
      if (changed !== tab.dirty) { tab.dirty = changed; updateTabLabel(tab); }
      updateEmptyState(tab);
      clearTimeout(tab.renderTimer);
      const delay = p.editor.value.length > 200000 ? 400 : 130;
      tab.renderTimer = setTimeout(() => render(tab), delay);
      scheduleSessionSave();
    });

    // Tab key indents (via execCommand so undo still works)
    p.editor.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    });

    // Proportional scroll sync
    const sync = (from, to) => {
      if (!tab.editorVisible) return;
      if (Date.now() < tab.syncLock) return;
      const fMax = from.scrollHeight - from.clientHeight;
      const tMax = to.scrollHeight - to.clientHeight;
      if (fMax <= 0 || tMax <= 0) return;
      tab.syncLock = Date.now() + 120;
      to.scrollTop = (from.scrollTop / fMax) * tMax;
      tab.syncLock = Date.now() + 60;
    };
    p.editor.addEventListener('scroll', () => sync(p.editor, p.previewWrap));
    p.previewWrap.addEventListener('scroll', () => sync(p.previewWrap, p.editor));

    // Divider drag
    let dragging = false;
    p.divider.addEventListener('pointerdown', e => {
      dragging = true;
      p.divider.classList.add('dragging');
      p.divider.setPointerCapture(e.pointerId);
    });
    p.divider.addEventListener('pointermove', e => {
      if (!dragging) return;
      const rect = p.root.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      tab.ratio = Math.min(85, Math.max(15, pct));
      applyRatio(tab);
    });
    const stop = e => {
      if (!dragging) return;
      dragging = false;
      p.divider.classList.remove('dragging');
      try { p.divider.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      scheduleSessionSave();
    };
    p.divider.addEventListener('pointerup', stop);
    p.divider.addEventListener('pointercancel', stop);
    p.divider.addEventListener('dblclick', () => { tab.ratio = 50; applyRatio(tab); scheduleSessionSave(); });

    p.dzOpen.addEventListener('click', () => openFiles());
    p.editorToggle.addEventListener('click', () => toggleEditor(tab));

    let depth = 0;
    p.root.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth++;
      p.root.classList.add('dragover');
    });
    p.root.addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    p.root.addEventListener('dragleave', () => {
      if (--depth <= 0) { depth = 0; p.root.classList.remove('dragover'); }
    });
    p.root.addEventListener('drop', async e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();                 // handled here; don't fall through to the window handler
      depth = 0;
      p.root.classList.remove('dragover');
      await dropFiles([...e.dataTransfer.files], tab);
    });
  }

  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  function applyRatio(tab) {
    if (tab.kind === 'slides') return;
    tab.pane.editorWrap.style.width = `${tab.ratio}%`;
    // The floating button rides the divider; when the editor is collapsed it sits at the left edge.
    tab.pane.editorToggle.style.left = tab.editorVisible ? `calc(${tab.ratio}% - 11px)` : '0';
    // The empty-tab drop hint covers only the preview side, so the editor stays clickable and typable.
    tab.pane.dropzone.style.left = tab.editorVisible ? `${tab.ratio}%` : '0';
  }

  function applyEditorVisibility(tab) {
    if (tab.kind === 'slides') return;
    tab.pane.root.classList.toggle('no-editor', !tab.editorVisible);
    const btn = tab.pane.editorToggle;
    btn.textContent = tab.editorVisible ? '‹‹' : '››';
    btn.title = tr(tab.editorVisible ? 'editorToggle.hide' : 'editorToggle.show');
    applyRatio(tab);
    if (tab.id === state.activeId) el.toggleEditor.classList.toggle('on', tab.editorVisible);
  }

  function toggleEditor(tab) {
    if (!tab) return;
    if (tab.kind === 'slides') { flash(tr('flash.noEditor')); return; }
    tab.editorVisible = !tab.editorVisible;
    applyEditorVisibility(tab);
    if (tab.editorVisible) tab.pane.editor.focus({ preventScroll: true });
    scheduleSessionSave();
  }

  /* ==================== Files ==================== */

  // Dropped files: hand them to the native side first so we get real paths (needed to
  // save back to the original file); only fall back to reading contents if that fails.
  async function dropFiles(files, tab) {
    if (!files.length) return;

    if (HOST.canSendFiles) {
      const r = await HOST.sendFiles('dropFiles', files);
      if (r.ok && r.files && r.files.length) {
        let target = tab && isBlank(tab) && !tab.dirty ? tab : null;
        for (const f of r.files) {
          loadInto(target, f);
          target = null;
        }
        return;
      }
    }

    let target = tab && isBlank(tab) && !tab.dirty ? tab : null;
    for (const f of files) {
      loadInto(target, { name: f.name, text: await f.text() });
      target = null;
    }
  }

  // Files pushed in by the host: fill the current tab if it's blank, otherwise open new ones.
  function openHostFiles(files) {
    if (!files || !files.length) return;
    const cur = activeTab();
    let target = cur && isBlank(cur) && !cur.dirty ? cur : null;
    for (const f of files) {
      loadInto(target, f);
      target = null;
    }
  }

  function loadInto(tab, file) {
    const { name, text, path = null, base = null, mtime = null, size = -1 } = file;
    if (tab) {
      tab.name = name;
      tab.nameKey = null;                 // it has a real filename now
      tab.nameArg = null;
      tab.path = path;
      tab.base = base;
      tab.savedText = text;
      tab.dirty = false;
      // The stamp must be updated before activateTab, or the stale one gets compared
      // and the file looks like it changed externally.
      tab.mtime = mtime;
      tab.size = size;
      tab.ignoreStamp = null;
      tab.pane.editor.value = text;
      tab.pane.editor.scrollTop = 0;
      tab.pane.previewWrap.scrollTop = 0;
      updateTabLabel(tab);
      updateEmptyState(tab);
      render(tab);
      activateTab(tab.id);
    } else {
      createTab({ name, text, path, base, mtime, size });
    }
    saveSession();
  }

  async function openFiles() {
    if (HOST.available) {
      const r = await HOST.send('open');
      if (r.ok) openHostFiles(r.files);
      return;
    }
    el.fileInput.click();
  }

  el.fileInput.addEventListener('change', async () => {
    const cur = activeTab();
    let target = cur && isBlank(cur) ? cur : null;
    for (const f of el.fileInput.files) {
      loadInto(target, { name: f.name, text: await f.text() });
      target = null;
    }
    el.fileInput.value = '';
  });

  async function saveTab(tab) {
    if (tab.kind === 'slides') { flash(tr('flash.cantSave')); return; }
    const text = tab.pane.editor.value;

    if (HOST.available) {
      const r = await HOST.send('save', { path: tab.path, name: tab.name, text });
      if (r.cancelled) return;
      if (!r.ok) { alert(tr('error.saveFailed', r.error || tr('error.unknown'))); return; }
      tab.path = r.path;
      tab.base = r.base || tab.base;
      tab.mtime = r.mtime;          // remember what we just wrote, so it isn't read back as an external edit
      tab.size = r.size;
      tab.ignoreStamp = null;
      markSaved(tab, text, r.name);
      flash(tr('flash.saved', tab.name));
      return;
    }

    // Browser fallback: download
    const name = MD_EXT.test(tab.name) ? tab.name : `${tab.name}.md`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    markSaved(tab, text, name);
    flash(tr('flash.downloaded', name));
  }

  /* ==================== Slides ==================== */

  // Splitting into slides and rendering them happens entirely inside the produced HTML,
  // in slides/slides.js; this side only assembles the file. Those three assets come from
  // the md2slides companion tool, which builds decks from the command line off the same
  // copies — which is why both routes produce identical output.
  //
  // The three helpers below are shared with "Save as HTML" further down.

  // Embedded assets: served from the virtual origin by the host, or straight off the file
  // system when this page is opened in a plain browser for debugging.
  const grabAsset = async p => {
    const r = await fetch(p);
    if (!r.ok) throw new Error(tr('error.asset', p));
    return r.text();
  };

  const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Fill a {{PLACEHOLDER}} template. One pass, and in function form — a plain
  // String.replace would treat $& / $1 inside the asset contents as substitution
  // patterns, and a series of them would only ever replace the first {{TITLE}}.
  // Both builders come through here, so that trap has only one place left to live.
  const fill = (template, vals) =>
    template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vals ? vals[k] : m));

  let slidesAssets = null;
  async function loadSlidesAssets() {
    if (slidesAssets) return slidesAssets;
    const [template, css, runtime, marked] = await Promise.all([
      grabAsset('slides/template.html'),
      grabAsset('slides/slides.css'),
      grabAsset('slides/slides.js'),
      grabAsset('vendor/marked.min.js'),
    ]);
    slidesAssets = { template, css, runtime, marked };
    return slidesAssets;
  }

  function deckTitle(text, fallback) {
    const m = /^#\s+(.*)$/m.exec(text);
    const t = m ? m[1].replace(/^[Pp]?\d+\s*[.、·]\s*/, '').trim() : '';
    return t || fallback;
  }

  async function buildSlides(text, title) {
    const a = await loadSlidesAssets();
    return fill(a.template, {
      LANG: state.lang,
      TITLE: escAttr(title),
      SPLIT: 'h3',
      CSS: a.css,
      MARKDOWN: text.replace(/<\/script/gi, '<\\/script'),
      MARKED: a.marked,
      RUNTIME: a.runtime,
    });
  }

  // Pressing "Slides" or "Export" while on a slide tab acts on its source tab.
  function sourceOf(tab) {
    if (!tab || tab.kind !== 'slides') return tab || null;
    const origin = getTab(tab.sourceId);
    if (!origin) flash(tr('flash.sourceClosed'));
    return origin || null;
  }

  async function exportSlides(tab) {
    tab = sourceOf(tab);
    if (!tab) return;
    const text = tab.pane.editor.value;
    if (!text.trim()) { flash(tr('flash.emptyExport')); return; }

    const stem = tab.name.replace(/\.[^.]+$/, '');
    let html;
    try {
      html = await buildSlides(text, deckTitle(text, stem));
    } catch (e) {
      alert(tr('error.buildSlides', e.message));
      return;
    }

    const name = stem + '.slides.html';
    if (HOST.available) {
      const r = await HOST.send('export', { name, text: html, dir: tab.path || '' });
      if (r.cancelled) return;
      if (!r.ok) { alert(tr('error.exportFailed', r.error || tr('error.unknown'))); return; }
      flash(tr('flash.exported', r.name));
      return;
    }
    downloadFile(name, html);
  }

  // No native shell (the page opened directly in a browser for debugging): hand the file
  // to the browser instead of to a save dialog.
  function downloadFile(name, html) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    flash(tr('flash.downloaded', name));
  }

  /* ---------- Previewing in a tab ----------
   * The output of buildSlides() goes into a same-origin srcdoc iframe. The runtime is
   * written on the assumption that the whole page is the deck (it uses document,
   * position:fixed, 100vh), and an iframe happens to hand it exactly that: its own
   * document and viewport, so not a single line of it needs changing. Same-origin also
   * lets the parent reach into contentDocument, which is how focus forwarding and the
   * tests work.
   */

  // Only the in-app preview passes through here; exported files are left alone so they
  // stay identical to what md2slides produces.
  function inAppTweaks(html, base) {
    // The runtime calls history.replaceState('#n') on every page turn, which misbehaves
    // on about:srcdoc. Deep links are pointless in-app, so stub it out — that also keeps
    // the WebView's back history clean.
    const shim = '<script>history.replaceState=function(){};history.pushState=function(){};<\/script>\n';
    let out = html.replace('<script type="text/markdown"', shim + '<script type="text/markdown"');
    // Only with a base: relative images then resolve through the existing __local virtual
    // origin, so they look the same as in the main preview pane.
    if (base) {
      out = out.replace('<meta charset="utf-8">',
        `<meta charset="utf-8">\n<base href="${base.replace(/"/g, '&quot;')}">`);
    }
    return out;
  }

  const slidesDoc = tab =>
    (tab && tab.kind === 'slides' && tab.pane.frame.contentDocument) || null;

  function focusSlides(tab) {
    const w = tab.pane.frame.contentWindow;
    if (w) { try { w.focus(); } catch { /* not loaded yet; the load handler retries */ } }
  }

  function wireSlidesFrame(tab) {
    const doc = slidesDoc(tab);
    if (!doc) return;
    // External links go through the existing NewWindowRequested → system browser path,
    // matching decorateLinks() in the main preview.
    doc.querySelectorAll('a[href]').forEach(a => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(a.getAttribute('href') || '')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
    });
    // Ctrl+W / Ctrl+T / Alt+digit must keep working while focus is inside the iframe.
    // The runtime's own handler drops modified events up front, so the two don't fight.
    doc.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey,
        shiftKey: e.shiftKey, metaKey: e.metaKey, bubbles: true, cancelable: true,
      }));
    });
  }

  function currentSlide(tab) {
    const doc = slidesDoc(tab);
    if (!doc) return 0;
    return Math.max(0, [...doc.querySelectorAll('.slide')].findIndex(s => s.classList.contains('current')));
  }

  // Walk the runtime to slide n on its own terms. The page index lives in its closure, so
  // setting the class from outside just desynchronises the two and the next arrow key
  // jumps back.
  function gotoSlide(tab, n) {
    const doc = slidesDoc(tab);
    if (!doc) return;
    for (let i = 0; i < n; i++) {
      doc.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'ArrowRight', bubbles: true, cancelable: true }));
    }
  }

  async function openSlidesTab(tab) {
    const src = sourceOf(tab);
    if (!src) return;

    const text = src.pane.editor.value;
    if (!text.trim()) { flash(tr('flash.emptyPreview')); return; }

    const stem = src.name.replace(/\.[^.]+$/, '');
    let html;
    try {
      html = inAppTweaks(await buildSlides(text, deckTitle(text, stem)), src.base);
    } catch (e) {
      alert(tr('error.buildSlides', e.message));
      return;
    }

    // One slide tab per source: pressing the button again regenerates that same tab.
    let deck = state.tabs.find(x => x.kind === 'slides' && x.sourceId === src.id);
    const back = deck ? currentSlide(deck) : 0;
    if (deck) {
      deck.nameArg = stem;
      deck.name = tr('tab.slides', stem);
      updateTabLabel(deck);
    } else {
      deck = createTab({ kind: 'slides', sourceId: src.id, nameKey: 'slides', nameArg: stem, activate: false });
    }

    deck.pane.frame.addEventListener('load', () => {
      wireSlidesFrame(deck);
      gotoSlide(deck, back);                       // land back on the slide we were on, when regenerating
      if (deck.id === state.activeId) { focusSlides(deck); updateStatus(); }
    }, { once: true });
    deck.pane.frame.srcdoc = html;
    activateTab(deck.id);
  }

  /* ==================== Saving as a document (HTML / PDF) ====================
   * Not a deck: a snapshot of the document exactly as the preview renders it. The whole
   * of style.css is inlined rather than a trimmed-down export stylesheet — the app-chrome
   * rules match nothing in a bare document, and one stylesheet means the exported file
   * can never drift from what the app shows. All nine themes travel with it, so writing
   * data-skin on <html> is all it takes to keep the colours the user picked.
   */

  // export.html is the page skeleton: <html> attributes, the two <style> blocks and the
  // article the body drops into. It deliberately carries no comment naming a placeholder,
  // because fill() would substitute it there too — the first draft shipped style.css twice
  // that way. Keep any explanation here instead.
  let docAssets = null;
  async function loadDocAssets() {
    if (docAssets) return docAssets;
    const [template, css] = await Promise.all([
      grabAsset('export.html'),
      grabAsset('style.css'),
    ]);
    docAssets = { template, css };
    return docAssets;
  }

  // Local images become data URIs, so what gets sent really is a single file. Past the
  // budget the rest keep their relative paths: a broken link beats a 200 MB attachment.
  const INLINE_IMAGE_BUDGET = 32 * 1024 * 1024;

  async function inlineImages(root, tab) {
    if (!tab.base) return 0;
    let budget = INLINE_IMAGE_BUDGET, skipped = 0;
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (!src || isAbsolute(src)) continue;
      let blob;
      try {
        const r = await fetch(new URL(encodeURI(src), tab.base).href);
        if (!r.ok) continue;                    // missing on disk: leave the relative path
        blob = await r.blob();
      } catch {
        continue;
      }
      const cost = Math.ceil(blob.size * 4 / 3);   // base64 overhead
      if (cost > budget) { skipped++; continue; }
      try {
        img.src = await new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
        budget -= cost;
      } catch { /* unreadable: leave the relative path */ }
    }
    return skipped;
  }

  async function buildDocument(text, title, tab) {
    const a = await loadDocAssets();
    const root = document.documentElement;
    // renderInto() only, not render(): the app-only decorations (live checkboxes, links
    // that open tabs, images pointed at the virtual origin) have no meaning in a file.
    const box = renderInto(document.createElement('div'), text);
    const skipped = await inlineImages(box, tab);
    if (skipped) flash(tr('flash.imagesTooBig'));
    return fill(a.template, {
      LANG: state.lang,
      SKIN: root.dataset.skin || 'github-light',
      DARK: root.dataset.dark || '0',
      TITLE: escAttr(title),
      CSS: a.css,
      BODY: box.innerHTML,
    });
  }

  // `path` is only ever passed by src/test/test.py: given one the host writes straight
  // away instead of opening a save dialog, which CDP cannot click.
  async function exportDocument(tab, path) {
    tab = sourceOf(tab);
    if (!tab) return;
    const text = tab.pane.editor.value;
    if (!text.trim()) { flash(tr('flash.emptyExport')); return; }

    const stem = tab.name.replace(/\.[^.]+$/, '');
    let html;
    try {
      html = await buildDocument(text, deckTitle(text, stem), tab);
    } catch (e) {
      alert(tr('error.buildDoc', e.message));
      return;
    }

    const name = stem + '.html';
    if (HOST.available) {
      const r = await HOST.send('export',
        { name, text: html, dir: tab.path || '', kind: 'doc', path: path || '' });
      if (r.cancelled) return;
      if (!r.ok) { alert(tr('error.exportFailed', r.error || tr('error.unknown'))); return; }
      flash(tr('flash.exported', r.name));
      return;
    }
    downloadFile(name, html);
  }

  /* ---------- PDF ----------
   * The host prints this very page (PrintToPdfAsync), so the @media print rules in
   * style.css are what shapes the output and the tab being exported has to be the visible
   * one. A dark theme would come out as pale grey text on white paper — backgrounds are
   * one thing, but --fg is still the theme's — so the skin is dropped for the duration:
   * :root carrying no data-skin *is* GitHub Light (see the top of style.css).
   */
  let forcingLight = 0;

  function forceLightSkin() {
    const root = document.documentElement;
    const skin = root.dataset.skin, dark = root.dataset.dark;
    delete root.dataset.skin;
    root.dataset.dark = '0';
    forcingLight++;
    return () => {
      forcingLight--;
      if (skin === undefined) delete root.dataset.skin; else root.dataset.skin = skin;
      if (dark === undefined) delete root.dataset.dark; else root.dataset.dark = dark;
    };
  }

  // Ctrl+P lands on the same stylesheet, so give it the same treatment. Printing to PDF
  // may raise these events too; the guard keeps that from restoring the theme out from
  // under exportPdf's own restore, which would leave the app stuck in the light palette.
  let printRestore = null;
  window.addEventListener('beforeprint', () => {
    if (!forcingLight) printRestore = forceLightSkin();
  });
  window.addEventListener('afterprint', () => {
    if (printRestore) { printRestore(); printRestore = null; }
  });

  async function exportPdf(tab, path) {
    tab = sourceOf(tab);
    if (!tab) return;
    if (!tab.pane.editor.value.trim()) { flash(tr('flash.emptyExport')); return; }
    if (tab.id !== state.activeId) activateTab(tab.id);

    const name = tab.name.replace(/\.[^.]+$/, '') + '.pdf';
    if (!HOST.available) { window.print(); return; }   // browser fallback: print to PDF by hand

    const restore = forceLightSkin();
    try {
      const r = await HOST.send('printPdf', { name, dir: tab.path || '', path: path || '' });
      if (r.cancelled) return;
      if (!r.ok) { alert(tr('error.pdfFailed', r.error || tr('error.unknown'))); return; }
      flash(tr('flash.savedPdf', r.name));
    } finally {
      restore();
    }
  }

  function markSaved(tab, text, name) {
    tab.savedText = text;
    tab.dirty = false;
    if (name) tab.name = name;
    updateTabLabel(tab);
    updateEmptyState(tab);
    saveSession();
  }

  /* ==================== External-change detection ==================== */

  const stampOf = f => (f && f.mtime) ? `${f.mtime}|${f.size}` : null;

  let dialogOpen = false;

  // Ask whether to load the newer version from disk. Deliberately an in-page dialog
  // rather than the native confirm(): confirm() blocks the whole WebView synchronously
  // (which stops automated tests dead) and cannot show the filename or the warning.
  function askReload(tab, stamp) {
    return new Promise(resolve => {
      dialogOpen = true;
      el.extBody.textContent = tr('dialog.body', tab.name);
      el.extWarn.hidden = !tab.dirty;
      el.extDialog.hidden = false;
      el.extReload.focus();

      const done = reload => {
        el.extDialog.hidden = true;
        document.removeEventListener('keydown', onKey, true);
        dialogOpen = false;
        if (!reload) tab.ignoreStamp = stamp;      // don't ask again about this same version
        resolve(reload);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      };
      el.extKeep.onclick = () => done(false);
      el.extReload.onclick = () => done(true);
      document.addEventListener('keydown', onKey, true);
    });
  }

  async function checkExternal(tab) {
    if (!tab || !tab.path || !HOST.available || tab.checking || dialogOpen) return;
    tab.checking = true;
    try {
      const r = await HOST.send('stat', { paths: [tab.path] });
      const f = r.ok && r.files && r.files[0];
      if (!f) return;

      if (!f.exists) {
        if (tab.id === state.activeId) flash(tr('flash.missing', tab.name));
        return;
      }

      const stamp = stampOf(f);
      if (!tab.mtime) { tab.mtime = f.mtime; tab.size = f.size; return; }   // no baseline yet: record one
      if (stamp === stampOf(tab) || stamp === tab.ignoreStamp) return;

      if (await askReload(tab, stamp)) {
        const got = await HOST.send('openPath', { path: tab.path });
        if (!getTab(tab.id)) return;                       // tab was closed while we were asking
        if (got.ok && got.files && got.files.length) loadInto(tab, got.files[0]);
        else alert(got.error || tr('error.reloadFailed'));
      } else {
        updateStatus();
      }
    } catch { /* file temporarily locked or similar: ask again next time we switch back */ }
    finally { tab.checking = false; }
  }

  /* ==================== Status bar / title ==================== */

  let flashTimer = null;
  function flash(msg) {
    el.stInfo.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(updateStatus, 2000);
  }

  function updateStatus() {
    const tab = activeTab();
    if (!tab) return;
    if (tab.kind === 'slides') {
      const src = getTab(tab.sourceId);
      el.stName.textContent = tr('status.slidesPreview')
        + (src ? tr('status.slidesSource', src.path || src.name) : tr('status.slidesOrphan'));
      const doc = slidesDoc(tab);
      const n = doc ? doc.querySelectorAll('.slide').length : 0;
      el.stInfo.textContent = n ? tr('status.pages', n) : '';
      return;
    }
    const text = tab.pane.editor.value;
    const lines = text ? text.split('\n').length : 0;
    el.stName.textContent = (tab.dirty ? '● ' : '')
      + (tab.path || tr('status.unsavedFile', tab.name))
      + (tab.ignoreStamp ? tr('status.newerOnDisk') : '');
    el.stInfo.textContent = tr('status.lines', lines, text.length);
  }

  function reportTitle() {
    const tab = activeTab();
    HOST.post({
      cmd: 'title',
      text: tab ? (tab.dirty ? '● ' : '') + tab.name : '',
      dirty: state.tabs.filter(t => t.dirty).length,
    });
  }

  /* ==================== Dropdown menus ====================
   * Theme, language, slides and save all use the same dropdown. Registering them here
   * keeps "opening one closes the others", the click-anywhere-else handler and Escape as
   * a single list, instead of one more branch in each of those three places per menu.
   */

  const MENUS = [];
  function registerMenu(menu, caret) {
    const entry = {
      isOpen: () => !menu.hidden,
      close: () => {
        menu.hidden = true;
        if (caret) caret.classList.remove('on');
      },
      toggle: () => {
        const wasOpen = !menu.hidden;
        closeMenus();
        if (wasOpen) return;
        menu.hidden = false;
        if (caret) caret.classList.add('on');
      },
    };
    MENUS.push(entry);
    return entry;
  }
  const closeMenus = () => MENUS.forEach(m => m.close());
  const anyMenuOpen = () => MENUS.some(m => m.isOpen());

  document.addEventListener('click', closeMenus);

  /* ==================== Theme ==================== */

  // sw = the [background, accent] pair used for the menu swatch; the palettes themselves
  // live in style.css under :root[data-skin="..."]. Themes named after an existing scheme
  // keep that name verbatim in every language; the rest come from the string table.
  const THEMES = [
    { id: 'auto' },
    { id: 'github-light', dark: false, sw: ['#ffffff', '#0969da'] },
    { id: 'github-dark', dark: true, sw: ['#0d1117', '#4493f8'] },
    { id: 'solarized-light', name: 'Solarized Light', dark: false, sw: ['#fdf6e3', '#268bd2'] },
    { id: 'solarized-dark', name: 'Solarized Dark', dark: true, sw: ['#002b36', '#268bd2'] },
    { id: 'nord', name: 'Nord', dark: true, sw: ['#2e3440', '#88c0d0'] },
    { id: 'dracula', name: 'Dracula', dark: true, sw: ['#282a36', '#bd93f9'] },
    { id: 'one-dark', name: 'One Dark', dark: true, sw: ['#282c34', '#61afef'] },
    { id: 'gruvbox-dark', name: 'Gruvbox Dark', dark: true, sw: ['#282828', '#83a598'] },
  ];
  const LEGACY_THEME = { light: 'github-light', dark: 'github-dark' };   // values written by older builds
  const themeLabel = th => th.name || tr('theme.' + th.id);

  const themeById = id => THEMES.find(t => t.id === id);
  const systemSkin = () =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'github-dark' : 'github-light';

  function applyTheme(mode) {
    const id = themeById(mode) ? mode : (LEGACY_THEME[mode] || 'auto');
    const skin = id === 'auto' ? systemSkin() : id;
    const root = document.documentElement;
    root.dataset.theme = id;                       // what the user picked (may be 'auto') → menu tick
    root.dataset.skin = skin;                      // the resolved theme → every colour rule
    root.dataset.dark = themeById(skin).dark ? '1' : '0';
    el.theme.title = tr('toolbar.themeCurrent', themeLabel(themeById(id)));
    renderThemeMenu();
    try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
    saveSession();
  }

  function renderThemeMenu() {
    const cur = document.documentElement.dataset.theme;
    el.themeMenu.textContent = '';
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.className = 'theme-item' + (t.id === cur ? ' on' : '');
      b.type = 'button';
      b.dataset.id = t.id;
      const sw = document.createElement('span');
      sw.className = 'sw';
      const [bg, accent] = t.sw || THEMES[systemSkin() === 'github-dark' ? 2 : 1].sw;
      sw.style.setProperty('--sw-bg', bg);
      sw.style.setProperty('--sw-accent', accent);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = themeLabel(t);
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = '✓';
      b.append(sw, name, tick);
      b.addEventListener('click', () => { applyTheme(t.id); closeMenus(); });
      el.themeMenu.appendChild(b);
      if (t.id === 'auto') el.themeMenu.appendChild(
        Object.assign(document.createElement('div'), { className: 'theme-sep' }));
    }
  }

  const themeMenu = registerMenu(el.themeMenu);

  el.theme.addEventListener('click', e => { e.stopPropagation(); themeMenu.toggle(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (document.documentElement.dataset.theme === 'auto') applyTheme('auto');
  });

  /* ==================== Language ==================== */

  const defaultLang = () =>
    /^zh\b/i.test(navigator.language || '') ? 'zh-Hant' : 'en';

  // Fill in everything the markup declares statically. Kept separate from applyLang() so
  // boot() can run it once before the first render.
  //
  // Panes are cloned from a <template>, whose content lives in a separate document
  // fragment that document.querySelectorAll() does not reach — so makePane() calls this
  // on each freshly cloned node. Panes already in the DOM are covered by the document-wide
  // pass on a language switch.
  function applyStaticText(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(node => {
      node.textContent = tr(node.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(node => {
      node.title = tr(node.dataset.i18nTitle);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
      node.placeholder = tr(node.dataset.i18nPlaceholder);
    });
  }

  // Tabs whose name we generated ourselves get relabelled; an untouched Welcome tab also
  // gets its body swapped, since nothing of the user's can be lost that way.
  function refreshAutoNames() {
    for (const tab of state.tabs) {
      if (!tab.nameKey) continue;
      tab.name = autoName(tab.nameKey, tab.nameArg);
      if (tab.nameKey === 'welcome' && !tab.dirty && tab.kind === 'md') {
        tab.pane.editor.value = WELCOME();
        tab.savedText = tab.pane.editor.value;
        render(tab);
      }
      updateTabLabel(tab);
    }
  }

  function applyLang(id) {
    state.lang = langById(id) ? id : defaultLang();
    document.documentElement.lang = state.lang;
    applyStaticText();
    el.lang.title = tr('toolbar.langCurrent', langById(state.lang).label);
    renderLangMenu();
    renderThemeMenu();
    el.theme.title = tr('toolbar.themeCurrent',
      themeLabel(themeById(document.documentElement.dataset.theme || 'auto')));
    refreshAutoNames();
    // Alert labels are baked into the rendered HTML, so every preview needs redrawing.
    for (const tab of state.tabs) if (tab.kind === 'md') render(tab);
    updateStatus();
    // Keep the native shell's dialogs in the same language.
    HOST.post({ cmd: 'lang', lang: state.lang });
    try { localStorage.setItem(LANG_KEY, state.lang); } catch { /* ignore */ }
    saveSession();
  }

  function renderLangMenu() {
    el.langMenu.textContent = '';
    for (const l of LANGS) {
      const b = document.createElement('button');
      b.className = 'lang-item' + (l.id === state.lang ? ' on' : '');
      b.type = 'button';
      b.dataset.id = l.id;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = l.label;
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = '✓';
      b.append(name, tick);
      b.addEventListener('click', () => { applyLang(l.id); closeMenus(); });
      el.langMenu.appendChild(b);
    }
  }

  const langMenu = registerMenu(el.langMenu);

  el.lang.addEventListener('click', e => { e.stopPropagation(); langMenu.toggle(); });

  /* ==================== Toolbar / shortcuts ==================== */

  el.newTab.addEventListener('click', () => createTab({ nameKey: 'untitled' }));
  el.open.addEventListener('click', () => openFiles());
  el.save.addEventListener('click', () => { const t = activeTab(); if (t) saveTab(t); });
  el.toggleEditor.addEventListener('click', () => toggleEditor(activeTab()));

  // Menu items act on the active tab; both dropdowns share this wiring.
  const onMenuPick = (menu, actions) => menu.addEventListener('click', e => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    closeMenus();
    const t = activeTab();
    const act = actions[item.dataset.act];
    if (t && act) act(t);
  });

  /* ---------- The save button and its dropdown ---------- */

  const saveMenu = registerMenu(el.saveMenu, el.saveMore);
  el.saveMore.addEventListener('click', e => { e.stopPropagation(); saveMenu.toggle(); });
  onMenuPick(el.saveMenu, { html: exportDocument, pdf: exportPdf });

  /* ---------- The slides button and its dropdown ---------- */

  const slidesMenu = registerMenu(el.slidesMenu, el.slidesMore);
  el.slides.addEventListener('click', () => { const t = activeTab(); if (t) openSlidesTab(t); });
  el.slidesMore.addEventListener('click', e => { e.stopPropagation(); slidesMenu.toggle(); });
  onMenuPick(el.slidesMenu, { preview: openSlidesTab, export: exportSlides });

  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape' && anyMenuOpen()) { e.preventDefault(); closeMenus(); return; }
    if (ctrl && !e.shiftKey && key === 's') { e.preventDefault(); const t = activeTab(); if (t) saveTab(t); return; }
    if (ctrl && key === 'o') { e.preventDefault(); openFiles(); return; }
    // Must exclude shift, or Ctrl+Shift+E (export) gets eaten by the editor toggle first.
    if (ctrl && !e.shiftKey && key === 'e') { e.preventDefault(); el.toggleEditor.click(); return; }
    // Ctrl+Shift+P has to come before Ctrl+P, otherwise print swallows it.
    if (ctrl && e.shiftKey && key === 'p') {
      e.preventDefault(); const t = activeTab(); if (t) openSlidesTab(t); return;
    }
    if (ctrl && e.shiftKey && key === 'e') {
      e.preventDefault(); const t = activeTab(); if (t) exportSlides(t); return;
    }
    if (ctrl && e.shiftKey && key === 'h') {
      e.preventDefault(); const t = activeTab(); if (t) exportDocument(t); return;
    }
    if (ctrl && e.shiftKey && key === 'd') {
      e.preventDefault(); const t = activeTab(); if (t) exportPdf(t); return;
    }
    if (ctrl && !e.shiftKey && key === 'p') { e.preventDefault(); window.print(); return; }
    if ((ctrl && (key === 't' || key === 'n')) || (e.altKey && key === 'n')) {
      e.preventDefault(); createTab({ nameKey: 'untitled' }); return;
    }
    if ((ctrl && key === 'w') || (e.altKey && key === 'w')) {
      e.preventDefault(); if (state.activeId) closeTab(state.activeId); return;
    }
    if (e.altKey && /^[1-9]$/.test(e.key)) {
      const t = state.tabs[Number(e.key) - 1];
      if (t) { e.preventDefault(); activateTab(t.id); }
      return;
    }
    if (ctrl && e.key === 'Tab') {
      const i = state.tabs.findIndex(t => t.id === state.activeId);
      if (i >= 0 && state.tabs.length > 1) {
        e.preventDefault();
        const n = (i + (e.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length;
        activateTab(state.tabs[n].id);
      }
    }
  });

  // Dropping outside a pane (on the tab bar or status bar) opens files too, and catching
  // it here stops an unhandled drop from making the WebView navigate to the file.
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    await dropFiles([...e.dataTransfer.files], activeTab());
  });

  window.addEventListener('beforeunload', saveSession);

  /* ==================== Session persistence ==================== */

  let sessionTimer = null;
  function scheduleSessionSave() {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(saveSession, 700);
  }

  // Tabs backed by a file and not modified are stored as just a path and re-read on the
  // next launch; only unsaved content is kept as a draft. The authoritative copy goes to
  // %LOCALAPPDATA%\MdViewer\session.json (visible, backup-able); localStorage is only a
  // fallback for debugging in a plain browser.
  function saveSession() {
    if (!state.booted) return;
    let payload;
    try {
      let bytes = 0;
      const tabs = [];
      for (const tab of state.tabs) {
        if (tab.kind === 'slides') continue;        // derived view: not restored on reopen
        const text = tab.pane.editor.value;
        const keepText = tab.dirty || !tab.path;
        if (keepText) {
          bytes += text.length;
          if (bytes > MAX_SESSION_BYTES) continue;
        }
        tabs.push({
          name: tab.name, path: tab.path, text: keepText ? text : null,
          nameKey: tab.nameKey, nameArg: tab.nameArg,
          ratio: tab.ratio, editorVisible: tab.editorVisible, dirty: tab.dirty,
          active: tab.id === state.activeId,
        });
      }
      payload = JSON.stringify({
        v: SESSION_VER,
        theme: document.documentElement.dataset.theme || 'auto',
        lang: state.lang,
        tabs,
      });
    } catch { return; }

    HOST.post({ cmd: 'sessionSave', text: payload });
    try { localStorage.setItem(SESSION_KEY, payload); } catch { /* quota: ignore */ }
  }

  async function readSession() {
    if (HOST.available) {
      const r = await HOST.send('sessionLoad');
      if (r.ok && r.text) {
        try { return JSON.parse(r.text); } catch { /* corrupt: fall back to localStorage */ }
      }
    }
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  async function restoreSession(data) {
    if (!data || !Array.isArray(data.tabs) || !data.tabs.length) return false;

    const fresh = new Map();
    if (HOST.available) {
      const paths = data.tabs.filter(t => t.path).map(t => t.path);
      if (paths.length) {
        const r = await HOST.send('reopen', { paths });
        if (r.ok) for (const f of r.files) fresh.set(f.path, f);
      }
    }

    let activeId = null;
    for (const saved of data.tabs) {
      const f = saved.path ? fresh.get(saved.path) : null;
      if (saved.path && !f && !saved.dirty) continue;  // file is gone and there's no draft
      const text = (saved.dirty || !f) ? (saved.text || '') : f.text;
      // A generated name is rebuilt in the current language rather than restored verbatim.
      const nameKey = (!saved.path && saved.nameKey) ? saved.nameKey : null;
      const tab = createTab({
        name: (f && f.name) || (nameKey ? null : saved.name) || null,
        nameKey,
        nameArg: saved.nameArg || null,
        text,
        path: saved.path || null,
        base: f ? f.base : null,
        ratio: typeof saved.ratio === 'number' ? saved.ratio : 50,
        editorVisible: saved.editorVisible !== false,
        activate: false,
        mtime: f ? f.mtime : null,
        size: f ? f.size : -1,
      });
      if (saved.dirty) {
        tab.savedText = f ? f.text : '';
        tab.dirty = tab.pane.editor.value !== tab.savedText;
        updateTabLabel(tab);
      }
      if (saved.active) activeId = tab.id;
    }
    if (!state.tabs.length) return false;
    activateTab(activeId || state.tabs[0].id);
    return true;
  }

  /* ==================== Startup ==================== */

  const WELCOME_DOC = {
    en: [
      '# MD Viewer',
      '',
      'A lightweight, offline Markdown viewer that renders faithfully.',
      'The whole program is a single .exe.',
      '',
      '## Getting started',
      '',
      '| Action | How |',
      '| --- | --- |',
      '| New tab | `+` at the right of the tab bar, or `Ctrl+T` |',
      '| Close tab | the `×` on the tab, middle-click, or `Ctrl+W` |',
      '| Open a file | **drag a `.md` into the window**, or `Ctrl+O` |',
      '| Hide/show the editor | "Editor" in the toolbar, or `Ctrl+E` |',
      '| Save back to the file | `Ctrl+S` |',
      '| Switch tabs | `Alt+1`–`Alt+9`, `Ctrl+Tab` |',
      '',
      '> [!TIP]',
      '> Drag the divider to change the split; double-click it to go back to 50 / 50.',
      '',
      '## Supported syntax',
      '',
      '- [x] GFM tables, strikethrough (~~like this~~), task lists (tick them right here)',
      '- [x] Syntax highlighting, GitHub-style alert blocks',
      '- [x] Relative-path images, links to `.md` files next door',
      '- [ ] Not supported: math formulas and Mermaid diagrams',
      '',
      '```python',
      'def hello(name: str) -> str:',
      '    return f"Hello, {name}!"',
      '```',
      '',
      '> [!NOTE]',
      '> File encoding and line endings (CRLF / LF) are preserved exactly; saving will',
      '> not rewrite the whole file.',
      '',
    ],
    'zh-Hant': [
      '# MD Viewer',
      '',
      '輕量、離線、渲染確實的 Markdown 檢視器。整個程式就是一個 exe。',
      '',
      '## 快速上手',
      '',
      '| 操作 | 方式 |',
      '| --- | --- |',
      '| 開新分頁 | 分頁列最右邊的 `+`，或 `Ctrl+T` |',
      '| 關閉分頁 | 分頁上的 `×`、中鍵、或 `Ctrl+W` |',
      '| 開啟檔案 | 把 `.md` **拖曳進視窗**，或 `Ctrl+O` |',
      '| 隱藏／展開編輯區 | 工具列「編輯區」，或 `Ctrl+E` |',
      '| 儲存回原檔 | `Ctrl+S` |',
      '| 切換分頁 | `Alt+1`～`Alt+9`、`Ctrl+Tab` |',
      '',
      '> [!TIP]',
      '> 中間的分隔線可以左右拖曳調整比例，雙擊回到 50 / 50。',
      '',
      '## 支援的語法',
      '',
      '- [x] GFM 表格、刪除線（~~像這樣~~）、任務清單（這裡可以直接勾）',
      '- [x] 程式碼高亮、GitHub 樣式的提示區塊',
      '- [x] 相對路徑的圖片、相鄰 `.md` 的連結',
      '- [ ] 尚未支援：數學公式與 Mermaid 圖',
      '',
      '```python',
      'def hello(name: str) -> str:',
      '    return f"Hello, {name}!"',
      '```',
      '',
      '> [!NOTE]',
      '> 檔案編碼與換行（CRLF／LF）會照原樣保留，不會因為存檔就整份被改掉。',
      '',
    ],
  };

  const WELCOME = () => (WELCOME_DOC[state.lang] || WELCOME_DOC.en).join('\n');

  (async function boot() {
    // Apply the localStorage theme and language synchronously first, so a dark theme
    // doesn't flash white and the first paint isn't in the wrong language.
    try { applyTheme(localStorage.getItem(THEME_KEY) || 'auto'); } catch { applyTheme('auto'); }
    try { applyLang(localStorage.getItem(LANG_KEY) || defaultLang()); } catch { applyLang('en'); }

    const data = await readSession();
    if (data && data.theme) applyTheme(data.theme);   // session.json is authoritative
    if (data && data.lang) applyLang(data.lang);

    const restored = await restoreSession(data);
    if (!restored) {
      const tab = createTab({ nameKey: 'welcome', text: WELCOME() });
      tab.savedText = tab.pane.editor.value;
    }
    state.booted = true;
    HOST.flush();          // deliver files that arrived before we were ready
    reportTitle();
  })();

  // For src/test/test.py: every export opens a native save dialog that CDP cannot click,
  // so the tests call these directly (the exporters take a path that skips the dialog)
  // and exercise the real code rather than a reimplementation of it.
  window.__mdv = {
    buildSlides, buildDocument, deckTitle, openSlidesTab,
    exportDocument, exportPdf, activeTab, applyLang, state,
  };
})();
