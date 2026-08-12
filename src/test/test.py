# -*- coding: utf-8 -*-
"""MD Viewer end-to-end regression tests.

How it works: MdViewer is launched with --dev (which opens a remote debugging port on
127.0.0.1:9333); the real window is then driven over CDP and the results checked, right
down to simulating file drops with Input.dispatchDragEvent. At the end everything is shut
down and reopened to verify that tabs are restored from session.json.

Requires: pip install websocket-client
Usage:    py src\\test\\test.py
"""
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXE = os.path.join(ROOT, "MdViewer.exe")
WORK = os.path.join(tempfile.gettempdir(), "mdviewer_test")
DEMO = os.path.join(WORK, "demo.md")
OTHER = os.path.join(WORK, "other.md")
CRLF = os.path.join(WORK, "crlf.md")
DECK = os.path.join(WORK, "deck.md")
PIC = os.path.join(WORK, "pic.png")

# 1x1 PNG, only used to confirm relative-path images really do load
PIC_DATA = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

DEMO_MD = """# Rendering demo

An ordinary paragraph with **bold**, *italic*, `inline code`, ~~strikethrough~~ and an
[external link](https://example.com).

## Table with three alignments

| Left | Centre | Right |
|:-----|:------:|------:|
| a    | b      | c     |
| a longer cell | mid | 123 |

## Task list

- [ ] Unfinished item
- [x] Finished item
  - [ ] Nested item

## GFM alerts

> [!NOTE]
> This is a note.

> [!WARNING]
> This is a warning.

## Syntax highlighting

```python
def fib(n: int) -> list:
    a, b = 0, 1
    out = []
    while a < n:
        out.append(a)
        a, b = b, a + b
    return out
```

## Relative-path image

![test image](pic.png)

## Link to a sibling file

[open other.md](other.md)

## Quote and lists

> A quoted line
> A second line

1. First
2. Second
   - Sub-item
   - Another sub-item
"""

OTHER_MD = "# other.md\n\nThe second file, reached from the link in demo.md.\n"

# Deck fixture: cover + 4 slides, covering fenced divs, speaker notes, a relative-path
# image and an external link. "Part 1:" also exercises the section-prefix stripping.
DECK_MD = """# Slides test

## Part 1: Syntax

### P1. Layout

::: cols side
Left column ![pic](pic.png)
+++
::: card
Right column card
:::
:::

> Notes: this is a speaker note.

### P2. Second slide

Body two

### P3. Third slide

[external link](https://example.com)
"""

# Deliberately non-ASCII, so the encoding/round-trip checks are meaningful.
CRLF_TEXT = "# CRLF test\r\n\r\nThis file is CRLF + BOM, with non-ASCII text: 中文測試。\r\n"
APPENDED = "\nAn appended line with non-ASCII: 追加的一行。\n"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail) if detail else ""))


def click_tab(cdp, title):
    cdp.ev("[...document.querySelectorAll('.tab')]"
           ".find(t=>t.textContent.includes(%s)).click()" % json.dumps(title))


def set_lang(cdp, lang):
    """Pin the UI language so the assertions below have a fixed vocabulary."""
    cdp.ev("window.__mdv.applyLang(%s)" % json.dumps(lang))
    time.sleep(0.5)


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.n:
                if "error" in m:
                    raise RuntimeError("%s -> %s" % (method, m["error"]))
                return m

    def ev(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        res = r.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError(json.dumps(res["exceptionDetails"], ensure_ascii=False)[:300])
        return res.get("result", {}).get("value")

    def drop(self, x, y, files):
        data = {"items": [], "files": files, "dragOperationsMask": 1}
        for kind in ("dragEnter", "dragOver", "drop"):
            self.call("Input.dispatchDragEvent", type=kind, x=x, y=y, data=data)
            time.sleep(0.15)


def connect(timeout=30):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            data = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))
            for t in data:
                if t.get("type") == "page" and "mdviewer.local" in t.get("url", ""):
                    return CDP(websocket.create_connection(
                        t["webSocketDebuggerUrl"], timeout=20, suppress_origin=True))
            last = data
        except Exception as e:                                   # noqa: BLE001
            last = e
        time.sleep(0.5)
    raise SystemExit("Could not connect to MdViewer: %s" % (last,))


def make_fixtures():
    if not os.path.isdir(WORK):
        os.makedirs(WORK)
    with open(DEMO, "w", encoding="utf-8", newline="\n") as f:
        f.write(DEMO_MD)
    with open(OTHER, "w", encoding="utf-8", newline="\n") as f:
        f.write(OTHER_MD)
    with open(DECK, "w", encoding="utf-8", newline="\n") as f:
        f.write(DECK_MD)
    with open(CRLF, "wb") as f:                                  # UTF-8 BOM + CRLF
        f.write(b"\xef\xbb\xbf" + CRLF_TEXT.encode("utf-8"))
    with open(PIC, "wb") as f:
        f.write(PIC_DATA)


def main():
    if not os.path.isfile(EXE):
        raise SystemExit("%s not found; run build.cmd first" % EXE)

    make_fixtures()
    udf = os.path.join(os.environ["LOCALAPPDATA"], "MdViewer", "WebView2")
    subprocess.run(["taskkill", "/f", "/im", "MdViewer.exe"], capture_output=True)
    time.sleep(1.5)
    if os.path.isdir(udf):                                       # clear last run's drafts
        subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", udf], capture_output=True)
    old_sess = os.path.join(os.environ["LOCALAPPDATA"], "MdViewer", "session.json")
    if os.path.isfile(old_sess):
        os.remove(old_sess)

    subprocess.Popen([EXE, "--dev", DEMO, CRLF])
    cdp = connect()
    time.sleep(2.5)
    # The default language follows the OS, so pin English for the rest of the run.
    set_lang(cdp, "en")

    # ---------- Tabs and rendering ----------
    tabs = cdp.ev("[...document.querySelectorAll('.tab .title')].map(t=>t.textContent)")
    check("files on the command line each get a tab", tabs == ["Welcome", "demo.md", "crlf.md"], tabs)

    cdp.ev("[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('demo.md')).click()")
    time.sleep(0.5)

    dom = cdp.ev("""(() => {
      const p = document.querySelector('.pane:not([hidden])');
      const q = s => p.querySelector(s);
      const img = q('.preview img');
      const ext = q('.preview a[href^="https://example.com"]');
      return {
        th: [...p.querySelectorAll('.preview th')].map(t=>t.getAttribute('align')),
        tasks: p.querySelectorAll('.preview li.task-list-item').length,
        alerts: [...p.querySelectorAll('.preview .md-alert')].map(a=>a.dataset.kind),
        alertLabel: (q('.preview .md-alert-title') || {}).textContent,
        hljs: !!q('.preview pre code .hljs-keyword'),
        imgSrc: img ? img.src : null,
        imgLoaded: img ? img.naturalWidth > 0 : false,
        broken: q('.preview .broken-img') ? q('.preview .broken-img').textContent : null,
        strike: !!q('.preview del'),
        extLink: ext ? ext.target : null,
        status: document.querySelector('#st-name').textContent
      };
    })()""")
    check("table alignments", dom["th"] == ["left", "center", "right"], dom["th"])
    check("task list (including nested)", dom["tasks"] == 3, dom["tasks"])
    check("GFM alerts", dom["alerts"] == ["NOTE", "WARNING"], dom["alerts"])
    check("alert label is localised", "Note" in (dom["alertLabel"] or ""), dom["alertLabel"])
    check("syntax highlighting", dom["hljs"])
    check("strikethrough", dom["strike"])
    check("external links open elsewhere", dom["extLink"] == "_blank", dom["extLink"])
    check("relative image rewritten to the local file origin",
          (dom["imgSrc"] or "").endswith("/pic.png") and "__local/" in (dom["imgSrc"] or ""),
          dom["imgSrc"] or dom["broken"])
    check("relative image actually loads", dom["imgLoaded"], dom["broken"])
    check("status bar shows the real path", dom["status"].endswith("demo.md"), dom["status"])

    # ---------- Ticking a task item ----------
    cdp.ev("document.querySelector('.pane:not([hidden]) .preview li.task-list-item input').click()")
    time.sleep(0.4)
    src = cdp.ev("document.querySelector('.pane:not([hidden]) .editor').value")
    check("ticking a checkbox writes back to the source", "- [x] Unfinished item" in src)
    check("ticking marks the tab unsaved", cdp.ev("!!document.querySelector('.tab.active.dirty')"))

    # ---------- Saving back to the original file ----------
    before = open(DEMO, "rb").read()
    cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))")
    time.sleep(1.2)
    after = open(DEMO, "rb").read()
    check("Ctrl+S writes straight back to the file",
          b"- [x] Unfinished item" in after and before != after)
    check("dirty marker cleared after saving",
          not cdp.ev("!!document.querySelector('.tab.active.dirty')"))
    check("an LF file stays LF", b"\r\n" not in after)

    # ---------- Encoding and line endings preserved ----------
    cdp.ev("[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('crlf.md')).click()")
    time.sleep(0.4)
    cdp.ev("""(() => {
      const e = document.querySelector('.pane:not([hidden]) .editor');
      e.value = e.value + %s;
      e.dispatchEvent(new Event('input', {bubbles:true}));
    })()""" % json.dumps(APPENDED))
    time.sleep(0.4)
    cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))")
    time.sleep(1.2)
    raw = open(CRLF, "rb").read()
    check("CRLF line endings preserved",
          raw.count(b"\r\n") >= 4 and b"\n" not in raw.replace(b"\r\n", b""))
    check("UTF-8 BOM preserved", raw.startswith(b"\xef\xbb\xbf"))
    check("non-ASCII content written back correctly",
          APPENDED.strip().encode("utf-8") in raw)

    # ---------- Link to a sibling .md ----------
    cdp.ev("[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('demo.md')).click()")
    time.sleep(0.3)
    cdp.ev("""[...document.querySelectorAll('.pane:not([hidden]) .preview a')]
              .find(a=>a.textContent.includes('other.md')).click()""")
    time.sleep(1.2)
    tabs = cdp.ev("[...document.querySelectorAll('.tab .title')].map(t=>t.textContent)")
    check("clicking a sibling .md link opens a new tab", "other.md" in tabs, tabs)

    # ---------- External-change detection ----------
    time.sleep(1.1)                                              # make sure mtime differs
    with open(DEMO, "a", encoding="utf-8", newline="\n") as f:
        f.write("\nFirst line added by another program.\n")
    click_tab(cdp, "demo.md")
    time.sleep(1.5)
    check("external change detected on tab switch",
          cdp.ev("!document.querySelector('#ext-dialog').hidden"))

    cdp.ev("document.querySelector('#ext-reload').click()")
    time.sleep(1.5)
    st = cdp.ev("""(() => ({
      val: document.querySelector('.pane:not([hidden]) .editor').value,
      hidden: document.querySelector('#ext-dialog').hidden,
      dirty: !!document.querySelector('.tab.active.dirty')
    }))()""")
    check("'load latest' reads the new content from disk",
          "First line added by another program." in st["val"])
    check("dialog closes and nothing is marked unsaved after reloading",
          st["hidden"] and not st["dirty"], st)

    cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))")
    time.sleep(1.2)
    click_tab(cdp, "crlf.md")
    time.sleep(0.5)
    click_tab(cdp, "demo.md")
    time.sleep(1.5)
    check("our own save is not mistaken for an external change",
          cdp.ev("document.querySelector('#ext-dialog').hidden"))

    time.sleep(1.1)
    with open(DEMO, "a", encoding="utf-8", newline="\n") as f:
        f.write("\nSecond line added by another program.\n")
    click_tab(cdp, "crlf.md")
    time.sleep(0.5)
    click_tab(cdp, "demo.md")
    time.sleep(1.5)
    check("a second external change asks again",
          cdp.ev("!document.querySelector('#ext-dialog').hidden"))
    cdp.ev("document.querySelector('#ext-keep').click()")
    time.sleep(0.6)
    st = cdp.ev("""(() => ({
      val: document.querySelector('.pane:not([hidden]) .editor').value,
      status: document.querySelector('#st-name').textContent
    }))()""")
    check("'keep current' does not overwrite the editor",
          "Second line added by another program." not in st["val"])
    check("status bar warns a newer version exists", "\u26a0" in st["status"], st["status"])
    click_tab(cdp, "crlf.md")
    time.sleep(0.5)
    click_tab(cdp, "demo.md")
    time.sleep(1.5)
    check("the same version is not queried twice",
          cdp.ev("document.querySelector('#ext-dialog').hidden"))

    # ---------- A blank tab can be typed into ----------
    cdp.ev("document.querySelector('#new-tab').click()")
    time.sleep(0.5)
    geo = cdp.ev("""(() => {
      const p = document.querySelector('.pane:not([hidden])');
      const r = p.querySelector('.editor').getBoundingClientRect();
      return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + 40),
              dzLeft: p.querySelector('.dropzone').style.left};
    })()""")
    check("blank-tab drop hint covers only the preview side", geo["dzLeft"] == "50%", geo["dzLeft"])

    # Click the editor with a real mouse event — this used to be swallowed by the
    # full-pane .dropzone, after which typing stopped working entirely.
    for kind in ("mousePressed", "mouseReleased"):
        cdp.call("Input.dispatchMouseEvent", type=kind, x=geo["x"], y=geo["y"],
                 button="left", clickCount=1)
    time.sleep(0.4)
    check("clicking a blank tab's editor gives it focus",
          cdp.ev("document.activeElement.classList.contains('editor')"),
          cdp.ev("document.activeElement.className"))

    cdp.call("Input.insertText", text="# Typing test\n\nA new tab can be typed into directly.")
    time.sleep(0.6)
    st = cdp.ev("""(() => {
      const p = document.querySelector('.pane:not([hidden])');
      const h = p.querySelector('.preview h1');
      return {val: p.querySelector('.editor').value,
              empty: p.classList.contains('empty'),
              h1: h ? h.textContent : null};
    })()""")
    check("a blank tab accepts typing", "Typing test" in (st["val"] or ""), st["val"])
    check("the drop hint disappears once you type", not st["empty"])
    check("typing renders into the preview live", st["h1"] == "Typing test", st["h1"])

    # Clear it and close, so no unsaved tab is left to disturb later checks.
    cdp.ev("""(() => {
      const e = document.querySelector('.pane:not([hidden]) .editor');
      e.value = ''; e.dispatchEvent(new Event('input', {bubbles:true}));
    })()""")
    time.sleep(0.4)
    check("clearing brings the drop hint back",
          cdp.ev("document.querySelector('.pane:not([hidden])').classList.contains('empty')"))
    cdp.ev("document.querySelector('.tab.active .close').click()")
    time.sleep(0.5)

    # ---------- Drag and drop (with real file paths) ----------
    check("no dialog left over before the drop tests",
          cdp.ev("document.querySelector('#ext-dialog').hidden"))
    cdp.call("Input.setInterceptDrags", enabled=False)
    cdp.ev("document.querySelector('#new-tab').click()")
    time.sleep(0.4)
    check("+ opens a blank tab showing the drop hint",
          cdp.ev("document.querySelector('.pane:not([hidden])').classList.contains('empty')"))
    box = cdp.ev("""(() => {
      const r = document.querySelector('.pane:not([hidden])').getBoundingClientRect();
      return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)};
    })()""")
    cdp.drop(box["x"], box["y"], [DEMO])
    time.sleep(1.5)
    st = cdp.ev("""(() => ({
      active: document.querySelector('.tab.active .title').textContent,
      status: document.querySelector('#st-name').textContent,
      hasContent: document.querySelector('.pane:not([hidden]) .editor').value.length > 0,
      imgOk: (() => { const i = document.querySelector('.pane:not([hidden]) .preview img');
                      return i ? i.naturalWidth > 0 : null; })()
    }))()""")
    check("a dropped file loads into the blank tab",
          st["active"] == "demo.md" and st["hasContent"], st["active"])
    check("dropping yields a real path (so it can be saved back)",
          st["status"].endswith("demo.md"), st["status"])
    check("relative images work after a drop too", st["imgOk"] is True, st["imgOk"])

    cdp.drop(box["x"], box["y"], [OTHER])
    time.sleep(1.5)
    check("dropping onto a tab with content opens a new tab",
          cdp.ev("document.querySelector('.tab.active .title').textContent") == "other.md")

    cdp.ev("document.querySelector('#new-tab').click()")
    time.sleep(0.4)
    cdp.drop(box["x"], box["y"], [DEMO, OTHER])
    time.sleep(2.0)
    tabs = cdp.ev("[...document.querySelectorAll('.tab .title')].map(t=>t.textContent)")
    check("dropping several files opens several tabs",
          tabs.count("demo.md") == 3 and tabs.count("other.md") == 3, tabs)

    # ---------- Collapsing the editor ----------
    cdp.ev("document.querySelector('#new-tab').click()")
    time.sleep(0.4)
    cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,bubbles:true}))")
    time.sleep(0.3)
    check("Ctrl+E collapses the editor",
          cdp.ev("document.querySelector('.pane:not([hidden])').classList.contains('no-editor')"))
    cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,bubbles:true}))")
    time.sleep(0.3)
    check("Ctrl+E expands it again",
          not cdp.ev("document.querySelector('.pane:not([hidden])').classList.contains('no-editor')"))

    check("the floating button shows the collapse arrow by default",
          cdp.ev("document.querySelector('.pane:not([hidden]) .editor-toggle').textContent") == "\u2039\u2039")
    check("the floating button is translucent",
          float(cdp.ev("getComputedStyle(document.querySelector('.pane:not([hidden]) .editor-toggle')).opacity")) < 1)
    cdp.ev("document.querySelector('.pane:not([hidden]) .editor-toggle').click()")
    time.sleep(0.3)
    st = cdp.ev("""(() => {
      const p = document.querySelector('.pane:not([hidden])');
      const b = p.querySelector('.editor-toggle');
      return {hidden: p.classList.contains('no-editor'), label: b.textContent, left: b.style.left,
              editorShown: getComputedStyle(p.querySelector('.editor-wrap')).display};
    })()""")
    check("the floating button collapses the editor", st["hidden"] and st["editorShown"] == "none", st)
    check("collapsed, the arrow flips and hugs the left edge",
          st["label"] == "\u203a\u203a" and st["left"] == "0px", st)
    cdp.ev("document.querySelector('.pane:not([hidden]) .editor-toggle').click()")
    time.sleep(0.3)
    st2 = cdp.ev("""(() => {
      const p = document.querySelector('.pane:not([hidden])');
      const b = p.querySelector('.editor-toggle');
      return {hidden: p.classList.contains('no-editor'), label: b.textContent, left: b.style.left};
    })()""")
    check("the floating button expands it again",
          not st2["hidden"] and st2["label"] == "\u2039\u2039" and "calc" in st2["left"], st2)

    cdp.ev("document.querySelector('.pane:not([hidden]) .editor-toggle').click()")
    time.sleep(0.3)
    cdp.ev("[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('demo.md')).click()")
    time.sleep(0.3)
    other_open = not cdp.ev("document.querySelector('.pane:not([hidden])').classList.contains('no-editor')")
    cdp.ev("[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('Untitled')).click()")
    time.sleep(0.3)
    still_hidden = cdp.ev("document.querySelector('.pane:not([hidden])').classList.contains('no-editor')")
    check("collapsed state is per-tab", other_open and still_hidden,
          "demo expanded=%s / Untitled collapsed=%s" % (other_open, still_hidden))

    # ---------- Closing a tab ----------
    before_n = cdp.ev("document.querySelectorAll('.tab').length")
    cdp.ev("document.querySelector('.tab.active .close').click()")
    time.sleep(0.4)
    after_n = cdp.ev("document.querySelectorAll('.tab').length")
    check("x closes the tab", after_n == before_n - 1, "%s -> %s" % (before_n, after_n))

    # ---------- Themes ----------
    click_tab(cdp, "demo.md")                                    # needs a code block to check highlighting
    time.sleep(1.2)
    cdp.ev("document.querySelector('#btn-theme').click()")
    time.sleep(0.4)
    menu = cdp.ev("""(() => {
      const m = document.querySelector('#theme-menu');
      return {open: !m.hidden,
              items: [...m.querySelectorAll('.theme-item .name')].map(n=>n.textContent),
              ticked: [...m.querySelectorAll('.theme-item.on .name')].map(n=>n.textContent)};
    })()""")
    check("the theme button opens the menu", menu["open"])
    check("the menu lists 9 themes", len(menu["items"]) == 9, menu["items"])
    check("the current theme is ticked", menu["ticked"] == ["Match system"], menu["ticked"])

    cdp.ev("document.querySelector('#theme-menu .theme-item[data-id=\"dracula\"]').click()")
    time.sleep(0.5)
    st = cdp.ev("""(() => {
      const r = document.documentElement, cs = getComputedStyle(document.body);
      const kw = document.querySelector('.pane:not([hidden]) .preview .hljs-keyword');
      return {theme: r.dataset.theme, skin: r.dataset.skin, dark: r.dataset.dark,
              bg: cs.backgroundColor, menuOpen: !document.querySelector('#theme-menu').hidden,
              kw: kw ? getComputedStyle(kw).color : null};
    })()""")
    check("picking Dracula sets all three root attributes",
          st["theme"] == "dracula" and st["skin"] == "dracula" and st["dark"] == "1", st)
    check("the Dracula background reaches the page", st["bg"] == "rgb(40, 42, 54)", st["bg"])
    check("the menu closes after picking a theme", not st["menuOpen"])
    # This also proves highlighting survived deleting the vendored hljs stylesheets.
    check("syntax highlighting recolours with the theme", st["kw"] == "rgb(255, 121, 198)", st["kw"])

    cdp.ev("document.querySelector('#btn-theme').click()")
    time.sleep(0.3)
    cdp.ev("document.querySelector('#theme-menu .theme-item[data-id=\"solarized-light\"]').click()")
    time.sleep(0.5)
    st = cdp.ev("""(() => {
      const r = document.documentElement;
      const kw = document.querySelector('.pane:not([hidden]) .preview .hljs-keyword');
      return {skin: r.dataset.skin, dark: r.dataset.dark,
              bg: getComputedStyle(document.body).backgroundColor,
              kw: kw ? getComputedStyle(kw).color : null};
    })()""")
    check("switching to a light theme flips data-dark to 0",
          st["skin"] == "solarized-light" and st["dark"] == "0", st)
    check("the Solarized Light background reaches the page", st["bg"] == "rgb(253, 246, 227)", st["bg"])
    check("highlighting switches to the Solarized palette", st["kw"] == "rgb(133, 153, 0)", st["kw"])

    cdp.ev("document.querySelector('#btn-theme').click()")
    time.sleep(0.3)
    cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
    time.sleep(0.3)
    check("Esc closes the theme menu", cdp.ev("document.querySelector('#theme-menu').hidden"))

    # ---------- Language ----------
    cdp.ev("document.querySelector('#btn-lang').click()")
    time.sleep(0.4)
    lmenu = cdp.ev("""(() => {
      const m = document.querySelector('#lang-menu');
      return {open: !m.hidden,
              items: [...m.querySelectorAll('.lang-item')].map(b=>b.dataset.id),
              ticked: [...m.querySelectorAll('.lang-item.on')].map(b=>b.dataset.id)};
    })()""")
    check("the language button opens the menu", lmenu["open"])
    check("the menu lists both languages",
          lmenu["items"] == ["en", "zh-Hant"], lmenu["items"])
    check("the current language is ticked", lmenu["ticked"] == ["en"], lmenu["ticked"])

    cdp.ev("document.querySelector('#new-tab').click()")            # a generated tab name to relabel
    time.sleep(0.4)
    cdp.ev("document.querySelector('#btn-lang').click()")
    time.sleep(0.3)
    cdp.ev("document.querySelector('#lang-menu .lang-item[data-id=\"zh-Hant\"]').click()")
    time.sleep(0.8)
    zh = cdp.ev("""(() => ({
      htmlLang: document.documentElement.lang,
      open: document.querySelector('#btn-open').textContent,
      slides: document.querySelector('#btn-slides').textContent,
      info: document.querySelector('#st-info').textContent,
      tabs: [...document.querySelectorAll('.tab .title')].map(t=>t.textContent),
      menuOpen: !document.querySelector('#lang-menu').hidden,
    }))()""")
    check("switching language sets <html lang>", zh["htmlLang"] == "zh-Hant", zh["htmlLang"])
    check("toolbar labels follow the language",
          zh["open"] == "\u958b\u555f" and zh["slides"] == "\u6295\u5f71\u7247", zh)
    check("the status bar follows the language",
          zh["info"].endswith("\u5b57\u5143"), zh["info"])
    check("generated tab names are relabelled",
          "\u672a\u547d\u540d" in zh["tabs"], zh["tabs"])
    check("the menu closes after picking a language", not zh["menuOpen"])

    cdp.ev("document.querySelector('#btn-lang').click()")
    time.sleep(0.3)
    cdp.ev("document.querySelector('#lang-menu .lang-item[data-id=\"en\"]').click()")
    time.sleep(0.8)
    back = cdp.ev("""(() => ({
      open: document.querySelector('#btn-open').textContent,
      tabs: [...document.querySelectorAll('.tab .title')].map(t=>t.textContent),
    }))()""")
    check("switching back to English restores the labels",
          back["open"] == "Open" and "Untitled" in back["tabs"], back)
    cdp.ev("document.querySelector('.tab.active .close').click()")
    time.sleep(0.4)

    # ---------- Exporting slides ----------
    check("the toolbar has a Slides button",
          cdp.ev("!!document.querySelector('#btn-slides')"))

    assets = cdp.ev("""(async () => {
      const out = {};
      for (const p of ['slides/template.html','slides/slides.css','slides/slides.js']) {
        const r = await fetch(p);
        out[p] = r.ok ? (await r.text()).length : 0;
      }
      return out;
    })()""")
    check("all three slides/ assets are embedded and reachable",
          all(v > 500 for v in assets.values()), assets)

    # Ctrl+Shift+P must reach the slide preview and not be swallowed by Ctrl+P's print.
    printed = cdp.ev("""(() => {
      window.__printed = false;
      const orig = window.print;
      window.print = () => { window.__printed = true; };
      document.dispatchEvent(new KeyboardEvent('keydown',
        {key:'P', ctrlKey:true, shiftKey:true, bubbles:true}));
      window.print = orig;
      return window.__printed;
    })()""")
    check("Ctrl+Shift+P is not intercepted by print", printed is False, printed)
    time.sleep(1.5)
    # That keystroke already opened a slide tab; close it, or later checks grab its iframe.
    cdp.ev("""(() => {
      const t = [...document.querySelectorAll('.tab.kind-slides')];
      t.forEach(x => x.querySelector('.close').click());
      return t.length;
    })()""")
    time.sleep(0.5)

    SLIDES_MD = ("# Export test\n\n## Part 1: Syntax\n\n### P1. One slide\n\n"
                 "::: cols side\nLeft column\n+++\n::: card\nRight column card\n:::\n:::\n\n"
                 "> Notes: note content.\n")
    out_html = os.path.join(WORK, "export.slides.html")
    if os.path.isfile(out_html):
        os.remove(out_html)

    r = cdp.ev("""(async () => {
      const md = %s;
      const html = await window.__mdv.buildSlides(md, window.__mdv.deckTitle(md, 'x'));
      const reply = await new Promise(res => {
        const h = e => {
          if (e.data && e.data.id === 987654) {
            chrome.webview.removeEventListener('message', h); res(e.data);
          }
        };
        chrome.webview.addEventListener('message', h);
        chrome.webview.postMessage({id: 987654, cmd: 'export', path: %s, text: html});
      });
      return { len: html.length, reply };
    })()""" % (json.dumps(SLIDES_MD), json.dumps(out_html)))

    check("buildSlides produces a complete single-file deck", r["len"] > 50000, "%d bytes" % r["len"])
    check("the export command writes the file out",
          r["reply"].get("ok") and os.path.isfile(out_html), r["reply"])

    written = ""
    if os.path.isfile(out_html):
        with open(out_html, encoding="utf-8") as f:
            written = f.read()
    check("the exported HTML carries the deck skeleton and inlined markdown",
          'class="deck"' in written and 'id="mds-src"' in written and "Export test" in written)
    check("runtime and marked are both inlined (no external references)",
          "mds-src" in written and "marked" in written
          and not re.search(r'(?:src|href)="https?://', written))
    check("the exported deck carries the current UI language",
          'lang="en"' in written, written[:120])

    bad = cdp.ev("""(async () => await new Promise(res => {
      const h = e => {
        if (e.data && e.data.id === 987655) {
          chrome.webview.removeEventListener('message', h); res(e.data);
        }
      };
      chrome.webview.addEventListener('message', h);
      chrome.webview.postMessage({id: 987655, cmd: 'export',
        path: 'Z:\\\\no-such-dir\\\\x.html', text: 'x'});
    }))()""")
    check("an unwritable path reports an error instead of crashing",
          bad.get("ok") is False and bool(bad.get("error")), bad)

    # ---------- Previewing slides in a tab ----------
    # The deck runs in a same-origin srcdoc iframe, so contentDocument can be inspected
    # straight from the main frame; no separate CDP target is needed for the iframe.
    menu = cdp.ev("""(() => {
      document.querySelector('#btn-slides-more').click();
      return {
        open: !document.querySelector('#slides-menu').hidden,
        items: [...document.querySelectorAll('#slides-menu .menu-item')].map(b => b.dataset.act),
      };
    })()""")
    check("the slides button has a dropdown with preview and export",
          menu["open"] and menu["items"] == ["preview", "export"], menu)
    cdp.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
    time.sleep(0.3)
    check("Esc closes the slides menu", cdp.ev("document.querySelector('#slides-menu').hidden"))

    cdp.ev("document.querySelector('#new-tab').click()")
    time.sleep(0.4)
    box = cdp.ev("""(() => {
      const r = document.querySelector('.pane:not([hidden])').getBoundingClientRect();
      return {x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)};
    })()""")
    cdp.drop(box["x"], box["y"], [DECK])
    time.sleep(1.5)

    n_before = cdp.ev("document.querySelectorAll('.tab').length")
    # Ctrl+Shift+P is preview; export moved to Ctrl+Shift+E.
    cdp.ev("""document.dispatchEvent(new KeyboardEvent('keydown',
        {key:'P', ctrlKey:true, shiftKey:true, bubbles:true}))""")
    time.sleep(2.0)

    st = cdp.ev("""(() => {
      const f = document.querySelector('.pane:not([hidden]) .slides-frame');
      const d = f && f.contentDocument;
      const id = i => d && d.getElementById(i) ? d.getElementById(i).textContent : null;
      return {
        nTabs: document.querySelectorAll('.tab').length,
        active: document.querySelector('.tab.active .title').textContent,
        marked: document.querySelector('.tab.active').classList.contains('kind-slides'),
        slides: d ? d.querySelectorAll('.slide').length : -1,
        cols: d ? d.querySelectorAll('.cols').length : -1,
        cards: d ? d.querySelectorAll('.card').length : -1,
        notes: d ? d.querySelectorAll('.notes').length : -1,
        counter: d ? (d.getElementById('counter') || {}).textContent : null,
        base: d ? (d.querySelector('base') || {}).href : null,
        img: d ? [...d.querySelectorAll('img')].map(i => i.naturalWidth) : null,
        link: d ? (d.querySelector('a[href^="https"]') || {}).target : null,
        deckLang: d ? d.documentElement.lang : null,
        hintNav: id('hint-nav'),
        ovTitle: id('ov-title'),
        part: id('partname'),
        status: document.querySelector('#st-name').textContent,
        info: document.querySelector('#st-info').textContent,
      };
    })()""")
    check("Ctrl+Shift+P opens a slide tab", st["nTabs"] == n_before + 1 and st["marked"], st["nTabs"])
    check("the slide tab is named after its source", st["active"] == "deck (slides)", st["active"])
    check("the iframe splits into the right number of slides (cover + 3)", st["slides"] == 4, st["slides"])
    check("fenced divs and speaker notes both render",
          st["cols"] == 1 and st["cards"] == 1 and st["notes"] == 1, st)
    check("an injected <base> routes relative images to the local file origin",
          bool(st["base"]) and "__local/" in st["base"], st["base"])
    check("relative images inside the deck really load", st["img"] == [1], st["img"])
    check("external links in the deck go to the system browser", st["link"] == "_blank", st["link"])
    check("the status bar shows the source and the slide count",
          st["status"].endswith("deck.md") and st["info"] == "4 slides", st)
    check("the deck inherits the UI language", st["deckLang"] == "en", st["deckLang"])
    check("slide chrome is localised", st["hintNav"] == "navigate" and st["ovTitle"] == "Overview", st)
    check("the 'Part 1:' prefix is stripped from the section name",
          st["part"] == "Syntax", st["part"])

    turn = cdp.ev("""(() => {
      const d = document.querySelector('.pane:not([hidden]) .slides-frame').contentDocument;
      for (let i = 0; i < 2; i++) {
        d.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
      }
      return {
        current: [...d.querySelectorAll('.slide')].findIndex(s => s.classList.contains('current')),
        counter: (d.getElementById('counter') || {}).textContent,
        parentHash: location.hash,
      };
    })()""")
    check("arrow keys page inside the iframe",
          turn["current"] == 2 and turn["counter"] == "3 / 4", turn)
    # The runtime calls history.replaceState('#n') per page turn; in-app it is a no-op.
    check("paging does not pollute the main window's URL", turn["parentHash"] == "", turn["parentHash"])

    # Edit the source and press again: the same tab regenerates, on the same slide.
    again = cdp.ev("""(async () => {
      [...document.querySelectorAll('.tab')]
        .find(t => t.querySelector('.title').textContent === 'deck.md').click();
      await new Promise(r => setTimeout(r, 300));
      const ed = document.querySelector('.pane:not([hidden]) .editor');
      ed.value = ed.value.replace('Body two', 'Body two, edited');
      ed.dispatchEvent(new Event('input', {bubbles:true}));
      await new Promise(r => setTimeout(r, 400));
      document.querySelector('#btn-slides').click();
      await new Promise(r => setTimeout(r, 1800));
      const d = document.querySelector('.pane:not([hidden]) .slides-frame').contentDocument;
      return {
        nTabs: document.querySelectorAll('.tab').length,
        current: [...d.querySelectorAll('.slide')].findIndex(s => s.classList.contains('current')),
        updated: d.body.textContent.includes('Body two, edited'),
      };
    })()""")
    check("pressing again updates the same slide tab rather than adding more",
          again["nTabs"] == n_before + 1, again["nTabs"])
    check("the regenerated deck picks up the edit", again["updated"], again)
    check("regenerating stays on the slide you were on", again["current"] == 2, again["current"])

    check("slide tabs cannot be saved (it points at export instead)", cdp.ev("""(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'s', ctrlKey:true, bubbles:true}));
      return document.querySelector('#st-info').textContent.includes('Export');
    })()"""))

    # ---------- Session file (close and reopen restores tabs) ----------
    sess = os.path.join(os.environ["LOCALAPPDATA"], "MdViewer", "session.json")
    time.sleep(1.2)
    check("session.json is created under %LOCALAPPDATA%\\MdViewer", os.path.isfile(sess), sess)
    paths, names, theme, lang = [], [], None, None
    if os.path.isfile(sess):
        with open(sess, encoding="utf-8") as f:
            data = json.load(f)
        paths = [t.get("path") for t in data.get("tabs", [])]
        names = [t.get("name") for t in data.get("tabs", [])]
        theme = data.get("theme")
        lang = data.get("lang")
    check("session.json records the real paths of open files", DEMO in paths, paths)
    check("slide tabs are not written to session.json (derived view, not restored)",
          not any("(slides)" in (n or "") for n in names), names)
    check("session.json records the theme", theme == "solarized-light", theme)
    check("session.json records the language", lang == "en", lang)

    subprocess.run(["taskkill", "/f", "/im", "MdViewer.exe"], capture_output=True)
    time.sleep(1.5)
    # Clear the WebView2 profile (i.e. localStorage). Restoring anyway proves session.json
    # is the source.
    if os.path.isdir(udf):
        subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", udf], capture_output=True)
    subprocess.Popen([EXE, "--dev"])                              # no file arguments this time
    cdp = connect()
    time.sleep(3.5)
    st = cdp.ev("""(() => ({
      tabs: [...document.querySelectorAll('.tab .title')].map(t=>t.textContent),
      dialog: document.querySelector('#ext-dialog').hidden,
      skin: document.documentElement.dataset.skin,
      lang: document.documentElement.lang,
      open: document.querySelector('#btn-open').textContent
    }))()""")
    check("tabs are restored on reopen (from session.json)",
          "demo.md" in st["tabs"] and "crlf.md" in st["tabs"], st["tabs"])
    check("the theme is restored too (localStorage was wiped)",
          st["skin"] == "solarized-light", st["skin"])
    check("the language is restored too (localStorage was wiped)",
          st["lang"] == "en" and st["open"] == "Open", st)
    click_tab(cdp, "demo.md")
    time.sleep(1.5)
    st2 = cdp.ev("""(() => ({
      val: document.querySelector('.pane:not([hidden]) .editor').value,
      status: document.querySelector('#st-name').textContent,
      dialog: document.querySelector('#ext-dialog').hidden
    }))()""")
    check("restored tabs re-read the latest content from disk",
          "Second line added by another program." in st2["val"]
          and st2["status"].endswith("demo.md"), st2["status"])
    check("restored content matches disk, so no spurious prompt", st2["dialog"])

    subprocess.run(["taskkill", "/f", "/im", "MdViewer.exe"], capture_output=True)
    passed = sum(1 for _, ok in results if ok)
    print("\n%d/%d passed" % (passed, len(results)))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
