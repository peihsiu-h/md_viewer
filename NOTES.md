# Development notes

Finished 2026-07-21. External-change detection, a session file, nine themes and slide
export followed on 2026-07-28; previewing slides in a tab on 2026-07-31; the
English / 正體中文 interface on 2026-08-12; saving a document as HTML or PDF on
2026-09-03.

What follows is the *why* behind the design, and the traps hit getting there. Read this
before changing anything. Usage lives in [README.md](README.md).

## Requirements and trade-offs

The requirement was a Markdown viewer that is lightweight but renders properly, with four
features: tabs, editor left / preview right, drag-and-drop, and a collapsible editor.

The first version was a plain web page (three files plus vendor, opened in a browser).
Everything worked, but using it exposed three problems: **too many files, it needs a
browser, and the browser needs an extension.** What was actually wanted was one exe you
can drop on any machine.

The second version became a native WinForms + WebView2 window, reusing the HTML/CSS/JS
from the first, all embedded in the exe.

Three options were weighed:

| Option | Size | Outcome |
| --- | --- | --- |
| **WebView2 + .NET Framework 4.8** | ~1.2 MB | **Chosen.** Both dependencies ship with Windows |
| WebView2 + self-contained .NET 6 | ~70 MB | Not worth 70 MB just to avoid .NET Framework |
| Native hand-drawn Markdown | ~1 MB | The only truly dependency-free option, but tables, highlighting and nested lists all degrade — which defeats "renders properly" |

Going desktop also solved three things the web version could not: drag-and-drop yields
real paths (so files can be saved back), relative-path images display, and files can be
opened from the command line, which allows setting it as the default `.md` handler.

## Traps hit

**1. `cmd.exe` reads .cmd files in the ANSI codepage.** When `build.cmd` was written as
UTF-8 with Chinese comments, the whole script shredded into garbage commands. `build.cmd`
is deliberately ASCII-only; keep it that way. For the same reason PowerShell 5.1 mangles
UTF-8-without-BOM `.ps1` / `.py` files, so **do not use PowerShell for text substitution
on those** — doing so once destroyed the entire test script.

**2. The in-box `csc.exe` is the C# 5 compiler.** No string interpolation, no `?.`, no
expression-bodied members. `src\Program.cs` has to stay C# 5 compatible, or building
requires the .NET SDK's Roslyn and the "builds with nothing installed" property is lost.

**3. `SetVirtualHostNameToFolderMapping` never took over requests on this runtime,** so
relative-path images were all broken. The API call succeeds and requests really do go to
the virtual domain, but nothing ever answers (tried both `.mdlocal` and the `.example`
TLD from Microsoft's own docs).
It now **serves them directly**: `MapFolder()` assigns a number to each folder, images are
rewritten to `https://mdviewer.local/__local/<number>/<relative path>`, and the existing
`WebResourceRequested` handler intercepts and reads the file (`ServeLocalFile()`, which
blocks `..\` traversal). Same origin, fully under our control, and no betting on runtime
behaviour.

**4. `JavaScriptSerializer` deserialises nested JSON arrays into `ArrayList`, not
`object[]`.** After `Deserialize<Dictionary<string, object>>()`, `Get(m, "paths") as
object[]` is **always null**. `CmdReopen()` was written that way from the start, so
"re-read files when restoring tabs" had never actually run — nobody noticed because the
drafts were still in localStorage, which made it look like restoring worked. Everything
now goes through `StrList()`, which reads values via `IEnumerable`. Use it for any array
arriving from the web side.

**5. The drop hint on a blank tab covered the editor too.** `.dropzone` is
`position:absolute; inset:0; z-index:5` with an opaque background, so as soon as
`.pane.empty` applied it covered the entire pane, `<textarea>` included. A freshly opened
tab still accepted typing because `activateTab()` calls `editor.focus()`, but one click on
the pane handed focus to that non-focusable div and typing stopped working entirely —
while the hint still said "or just start typing".
The fix makes the hint **cover only the preview side**: `applyRatio()` also sets
`dropzone.style.left` (returning to 0 only when the editor is collapsed), and
`.pane.dragover .dropzone { left: 0 !important }` restores the full-pane highlight while
dragging. Do not reach for `pointer-events: none` instead — that kills the "choose a file"
button and leaves no visible caret, because the editor underneath is still covered by an
opaque background.

**6. Drag-and-drop: `AllowExternalDrop = false` is a dead end.** The original idea was to
let WinForms receive the drop and read real paths, but WebView2 refused it and the web
side had no handler registered either, so **nobody caught it** and dropping did nothing at
all.
The correct route is the WebView2 API built for this: the web side handles `drop` as usual
(keeping the drag highlight), passes the `File` objects to the native side with
`postMessageWithAdditionalObjects`, and the native side reads `CoreWebView2File.Path`
(`CmdDropFiles()`). If the runtime is too old to supply it, the web side falls back to
reading contents directly — only then saving needs a "save as".

## Architecture

- **Single file**: the two managed DLLs are embedded as resources and loaded through
  `AssemblyResolve`; the native `WebView2Loader.dll` is extracted on first run to
  `%LOCALAPPDATA%\MdViewer\native\<version>\` and picked up via `SetDllDirectory`.
  Everything under `src\web\` is embedded too and served from `https://mdviewer.local/`
  by `WebResourceRequested`.
- **A virtual https origin rather than `NavigateToString`**: the latter gives an
  `about:blank` origin, which disables `localStorage` (used for tab drafts).
- **Session restore strategy**: tabs with a path and no modifications store only the path
  and ask the native side to `reopen` them on launch, so nothing stale is displayed; only
  unsaved drafts are stored in full.
- **The authoritative tab record is `%LOCALAPPDATA%\MdViewer\session.json`**, with
  `localStorage` kept only as a fallback for debugging in a plain browser (both get the
  same JSON). The problem with localStorage was that it lives inside the WebView2 profile
  folder: invisible, un-backup-able, and gone the moment the profile is cleared (which
  `test.py` does every run). Writes go **to a .tmp first, then `File.Move`**, so a crash
  mid-write cannot leave half a JSON document.
- **External-change detection**: `ReadOne()` / `CmdSave()` / `CmdStat()` all return
  `mtime` + `size`; the web side stores them as the tab's baseline stamp and compares on
  **tab activation** (`activateTab`) and **when the window regains focus**.
  - `mtime` travels as an `ToString("o")` ISO string rather than ticks: ticks are around
    `6.4e17`, past the `2^53` JS can represent exactly, so `JavaScriptSerializer` would
    lose precision and comparisons would flap.
  - Window focus uses WinForms' `Form.Activated` to send `windowActivated` to the web
    side, not the web side's `window.onfocus` — inside WebView2 the latter does not
    reliably follow the window.
  - After our own `Ctrl+S`, the returned stamp must be written back to the tab, or the
    next switch back reads our own save as an external change.
  - Choosing "keep current" records that version in `tab.ignoreStamp` so the same version
    is never queried twice; changing the file again (a different stamp) asks again.
- **Saving preserves the original**: `Decode()` / `WriteTextFile()` remember each file's
  encoding (UTF-8 / BOM / system default for non-UTF-8, which covers Big5) and line-ending
  style. The web side always works in LF and the original CRLF / LF is restored on write.
- **`AreBrowserAcceleratorKeysEnabled = false`** disables Chromium's Ctrl+R / Ctrl+P and
  friends so the shortcuts can be defined here (which is why the desktop build can use
  `Ctrl+T` / `Ctrl+W`, whereas the web version had to fall back to `Alt+N` / `Alt+W`).
- **Themes split "choice" from "appearance" across three root attributes**: `data-theme`
  is the raw user choice (possibly `auto`, used only for the menu tick and for saving),
  `data-skin` is the resolved theme (never `auto`; **every colour rule keys off this
  alone**), and `data-dark` is `1`/`0` for the few rules that need light/dark (currently
  only GFM alert colours).
  Splitting them this way let the duplicated dark-mode variables inside
  `@media (prefers-color-scheme: dark)` be deleted outright — `auto` is resolved by JS to
  `github-dark` / `github-light` and written into `data-skin`. **Do not go back to keying
  off the theme id** (`[data-theme="dark"] ...`); with eight themes that explodes.
- **Syntax highlighting reads `--hl-*` variables, and the two vendored hljs stylesheets are
  gone.** It used to be `hljs-light.min.css` / `hljs-dark.min.css` as two `<link>` elements
  toggled with `disabled`, which does not scale past two themes. The token groups in the
  two files turned out to be identical apart from the colours, so they were merged into the
  ruleset at the bottom of `style.css`. `fetch-webview2.ps1` only fetches the WebView2
  DLLs and never touched those two files, so deleting them had no side effects.
  **Move the colours only, not hljs's `pre code.hljs { padding:1em }`** — `.markdown-body
  pre code` already owns that layout, the two have equal specificity, and whichever comes
  last wins, so bringing it across starts a fight.
- **The theme is stored in `session.json` too**, for the same reason as the tabs. Startup
  deliberately goes "apply the localStorage theme synchronously → `await readSession()` and
  override", so a dark theme does not flash white on open. **session.json outranks
  localStorage**, which means compatibility checks on old values cannot use
  `location.reload()` (`beforeunload` writes session.json straight back); the process has
  to be killed with `taskkill /f` and the file deleted.
- **Localisation** lives in one `I18N` table in `app.js` with `en` and `zh-Hant` columns,
  reached through `tr(key, ...args)` with `{0}`-style placeholders.
  - The helper is called `tr`, not `t`, on purpose: `t` is used as a tab variable in a
    dozen arrow functions in this file and would shadow it.
  - Static markup declares `data-i18n` / `data-i18n-title` / `data-i18n-placeholder` and
    `applyStaticText()` fills it in; anything generated at runtime calls `tr()` directly.
  - Alert labels are baked into rendered HTML, so `applyLang()` has to re-`render()` every
    Markdown tab, not just repaint the chrome.
  - Tabs whose names we generated (Untitled, Welcome, the slide previews) carry
    `nameKey` / `nameArg` so `refreshAutoNames()` can relabel them on a language switch;
    tabs named after a real file keep that name. An untouched Welcome tab also has its
    body swapped, which is safe precisely because it is untouched.
  - The native side keeps its own small table (`static class L`), seeded from
    `CultureInfo.CurrentUICulture` and updated by a `lang` message whenever the web side
    switches. Failures that happen before the WebView exists can only use the OS culture,
    which is accepted.
- **Slide export: the parser is not in this project.** "Slides" in the toolbar converts the
  current Markdown into a single self-contained HTML file, but **paging, fenced divs and
  rendering all happen inside the produced file, in `src\web\slides\slides.js`**;
  `buildSlides()` only assembles template + CSS + marked + Markdown.
  - Those three files (`template.html` / `slides.css` / `slides.js`) are **copies**. They
    come from the md2slides companion tool, whose command-line converter reads the same
    originals, which is what keeps the two entry points producing identical decks.
    **Changes must be made upstream and copied back**, and the companion tool's own test
    suite run afterwards (26 checks, using headless Edge to actually execute the runtime —
    a static comparison cannot verify a parser).
  - Placeholder substitution is **one regex pass** (`/\{\{(\w+)\}\}/g` plus the function
    form), never a series of `String.replace` calls: firstly `{{TITLE}}` appears twice and
    only the first would be replaced, and secondly `$&` and `$1` inside the CSS/JS assets
    would be eaten as substitution patterns.
  - The `Ctrl+Shift+P` check **must sit before `Ctrl+P`**, and `Ctrl+P` needs
    `!e.shiftKey` — without that exclusion, print swallowed export entirely.
  - `CmdExport()` deliberately bypasses `WriteTextFile()`: that reuses the source file's
    remembered encoding and line endings (possibly Big5 + CRLF), whereas exported HTML must
    always be UTF-8 without a BOM.
  - `window.__mdv` exists only for the tests: export opens a native SaveFileDialog that CDP
    cannot click (clicking hangs the whole WebView), so `test.py` calls `buildSlides()`
    itself and then issues an `export` command carrying a `path`, mirroring `CmdSave`'s
    behaviour when given one.
  - Slide chrome (footer hints, overview, the speaker-note label) follows `<html lang>`,
    which `buildSlides()` sets from the current UI language. The note label is drawn by a
    CSS `::before`, so it travels as the `--notes-label` custom property rather than as
    text.
- **Previewing slides in a tab uses a same-origin `srcdoc` iframe holding the output of
  `buildSlides()`.** The runtime is written on the assumption that the whole page is the
  deck (it uses `document`, `location`, `position:fixed`, `100vh`), and an iframe hands it
  exactly that — its own document and viewport — so **not one line of the runtime needed
  changing, and the C# side was not touched at all**. Same-origin additionally lets the
  parent reach `contentDocument`, which is how focus forwarding, external-link rewriting
  and `test.py` all work, with no separate CDP target for the iframe.
  - The tab model gained `tab.kind` (`'md'` / `'slides'`) and `tab.sourceId`. Slide tabs
    have no editor or preview, so every function that touches `tab.pane.editor` must check
    `kind` first (`render` / `updateStatus` / `isBlank` / `applyRatio` /
    `applyEditorVisibility` / `toggleEditor` / `saveTab` / `saveSession`). `isBlank()`
    always returns `false` for slide tabs, so drops and file opens never target them.
  - **One slide tab per source**; pressing the button again regenerates it. `sourceOf()`
    makes "Slides" and "Export" act on the source when pressed from a slide tab.
  - **The in-app build injects two extra things** (`inAppTweaks()`; exported files skip
    this and stay identical to the companion tool's output):
    - `history.replaceState` / `pushState` become no-ops. The runtime calls
      `replaceState('#n')` on every page turn, which is a known landmine on
      `about:srcdoc`, and deep links are pointless in-app — this also keeps the WebView's
      back history clean.
    - With a `tab.base`, a `<base href>` line is inserted so relative-path images resolve
      through the existing `__local` origin. That actually beats the exported file, which
      only finds images if it sits in the same folder as them.
  - **Returning to the previous slide after regenerating is done by dispatching `n`
    `ArrowRight` events at the iframe** so the runtime's own `go()` updates its state. The
    page index lives in its closure; changing `.slide.current` from outside merely
    desynchronises the two and the next arrow key jumps back. The clean fix would be
    `data-start` support in the runtime, but that means changing the upstream original,
    syncing the command-line converter and re-running its 26 checks — not worth it for
    behaviour only this app has.
  - Paging needs focus inside the iframe, so `activateTab()` calls `focusSlides()` for
    slide tabs. Conversely, with focus in the iframe the main window stops receiving
    `Ctrl+W` / `Ctrl+T`, so a handler on the iframe's document forwards any modified
    keystroke to the parent document; the runtime's own keydown handler drops modified
    events up front, so the two never fight.
  - `Ctrl+Shift+E` (export) only works because **`Ctrl+E` (collapse editor) also carries
    `!e.shiftKey`** — the same trap as `Ctrl+P` / `Ctrl+Shift+P` above.
  - Slide tabs are **not written to `session.json`** (a derived view; not restored). There
    is a test watching specifically for that.
  - In tests, `document.querySelector('.slides-frame')` must be written as
    `.pane:not([hidden]) .slides-frame`: with several slide tabs open the former grabs
    somebody else's iframe. Written the first way, it picked up the one left behind by the
    previous check, and the symptom was slide counts and content that matched nothing.
- **"Save as HTML" is the preview, not a deck.** It goes through the same pipeline the
  preview does — `renderInto()`, which is what `render()` was split into — and simply stops
  before the three decorations that only mean anything inside the app: links that open
  tabs, live checkboxes, and images pointed at the virtual origin. Everything else (alerts,
  heading ids, highlighting, the task-list classes) is presentation and travels with it.
  - **The whole of `style.css` is inlined**, not a trimmed-down export stylesheet. A second
    copy of the `.markdown-body` and `--hl-*` rules would drift within a release or two —
    the slides assets already show what maintaining copies costs — whereas the app-chrome
    rules match nothing in a bare document, so the price is about 20 KB of dead CSS. All
    nine palettes come along, which is why keeping the user's theme costs nothing beyond
    writing `data-skin` on `<html>`.
  - `src\web\export.html` is the template, filled by the same single-pass `fill()` helper
    as the deck. **Do not name a placeholder in that file's comments** — the pass
    substitutes it there too, which is how the first draft shipped `style.css` twice.
  - Relative images become data URIs, fetched back through the same `__local` origin the
    preview uses, so the file really is one file. Past a 32 MB budget the rest keep their
    relative paths: a broken link beats an unsendable attachment.
- **"Save as PDF" prints the live page** with `CoreWebView2.PrintToPdfAsync`, so the
  `@media print` rules are what shape it and the tab being exported has to be the visible
  one (`exportPdf()` activates it first). An offscreen WebView2 holding the exported HTML
  would make the two outputs identical, but WebView2's rendering while the control is not
  visible is not something to bet on, and it would need its own copy of the
  `WebResourceRequested` plumbing just to see the images.
  - **The print rules were broken before any of this.** `.pane` is `position:absolute;
    inset:0` inside an `overflow:hidden` `#panes`, so paper output was clipped to the first
    page — `Ctrl+P` had never printed a long file properly. The `@media print` block now
    puts that whole stack back to static/visible. `test.py` counts `/Type /Page` in the
    produced PDF for exactly this reason.
  - **The theme is forced light for the duration.** Backgrounds aside, `--fg` on a dark
    theme is pale grey, which on white paper is nearly invisible. Rather than duplicating
    the light palette inside a print block, `forceLightSkin()` just removes `data-skin`:
    `:root` with none *is* GitHub Light. `beforeprint` / `afterprint` do the same for
    `Ctrl+P`, behind a counter — a `beforeprint` raised by the PDF print itself must not
    restore the theme out from under `exportPdf()`'s own restore, or the app is left stuck
    in the light palette.
  - **Paper size comes from the OS, not from WebView2.** `CoreWebView2PrintSettings`
    defaults to 8.5x11 everywhere, which is wrong outside North America — the first PDF
    out of this came back as Letter on a machine set to Taiwan. `ApplyPaperSize()` asks
    Windows instead (`GetLocaleInfoEx` / `LOCALE_IPAPERSIZE`: 1 = Letter, 5 = Legal,
    anything else A-series) and falls back to A4. Reading the default printer's page setup
    would have been the other route, but that answers a different question and is wrong on
    a machine with no printer installed.
  - The window visibly flips to the light palette while the save dialog is up. That is the
    price of doing it in one round trip, and it doubles as a preview of the output.
- **All four dropdowns register in one `MENUS` list.** Adding the save menu the old way
  meant editing four separate lists — each menu's open handler, the click-anywhere-else
  handler and Escape. `registerMenu()` / `closeMenus()` make it one line per menu.
- **Dialogs are hand-rolled rather than native `confirm()`**: `confirm()` blocks the entire
  WebView synchronously, taking CDP down with it, which makes that path permanently
  untestable. The in-page modal (`#ext-dialog`) can also show the filename and a red
  "unsaved changes" warning. The `confirm()` still inside `closeTab()` is a leftover, which
  is why the tests clear tabs before closing them.

## Verification

`py src\test\test.py` — **123 end-to-end checks**. It generates its own fixtures and shuts
the program down when finished.

It launches `MdViewer.exe --dev` (which opens a remote debugging port on `127.0.0.1:9333`)
and drives the real window over CDP, checking both the DOM and the files on disk.
**Drag-and-drop is tested automatically** by feeding real file paths through
`Input.dispatchDragEvent`. Whether a blank tab accepts typing is verified by really
clicking with `Input.dispatchMouseEvent` and then `Input.insertText` — a plain JS
`.focus()` cannot detect being covered by an overlay. At the end it shuts everything down,
**deletes the WebView2 profile as well**, and reopens to confirm tabs were restored from
`session.json` rather than localStorage.

**Never let a test press an export shortcut.** `Ctrl+Shift+E` / `Ctrl+Shift+H` /
`Ctrl+Shift+D` all open a native `SaveFileDialog`, which CDP cannot click and which blocks
the whole WebView until it is dismissed — the run just hangs. Every exporter therefore
takes an optional `path` that skips the dialog (`CmdSave` has always done the same), and
the tests drive the real functions through `window.__mdv` with one.

Requires `pip install websocket-client`. Rebuild with `build.cmd` and run this after
changing anything under `src\`.

> Three things it cannot cover have been checked by hand with throwaway scripts: the drag
> and drop CDP simulates happens at the Chromium layer, whereas a real OS drop adds an
> OLE→WebView2 conversion on top; the "check the file when switching back to the window"
> path runs off `Form.Activated`, which CDP cannot trigger and which needs `AppActivate`;
> and the compatibility mapping for old theme values (`light` / `dark`) can only be
> isolated by killing the process and deleting the file first, because session.json
> outranks localStorage.

## If you change things later

- **Adding math / Mermaid**: left out on purpose — KaTeX brings fonts and Mermaid is around
  3 MB, both larger than the whole program. If you really want them, put them in
  `src\web\vendor\` and post-process after `render()`.
- **Adding a theme**: add a row to `THEMES` in `app.js` (`id`, optional `name` for schemes
  with a proper name, `dark`, and the two swatch colours) and a
  `:root[data-skin="<id>"]` block in `style.css` (UI variables plus `--hl-*`). Themes
  without a `name` take their label from the `theme.<id>` entry in the string table.
  Nothing else needs touching.
- **Adding a language**: add a column to `I18N` and an entry to `LANGS` in `app.js`, a
  matching table in `static class L` in `Program.cs`, and a `STRINGS` entry in
  `src\web\slides\slides.js` (upstream first — see below).
- **Changing slide layout or syntax**: change the originals in the md2slides companion
  tool, run its `py test.py`, then copy `template.html`, `slides.css` and `slides.js` back
  into `src\web\slides\` and rebuild. **Do not change only the copies here** — the
  command-line converter will drift away. The in-app preview and the export share one
  output, so both change together.
- **Changing how an exported document looks**: `src\web\export.html` holds only the
  standalone-page overrides — the app shell's flex/fixed-height layout undone, and the
  centred column. Everything else comes from the inlined `style.css`, so a change to the
  Markdown or highlighting rules shows up in exports with no second edit. Keep it that way.
- **Changing the UI**: only `src\web\` is involved; the C# does not need touching.
- **Changing the icon**: `make-icon.ps1` produces `src\app.ico`.
- **The exe is x64 only.** ARM64 needs different native DLLs in `src\lib\` and a
  `/platform` change.
