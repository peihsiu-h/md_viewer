# MD Viewer

A lightweight Markdown viewer / editor for Windows. **The entire program is one file,
`MdViewer.exe` (about 1.2 MB)** — copy it to any Windows machine and double-click it. No
installer, no browser window, nothing left lying around next to the executable.

Rendering runs on WebView2, the Chromium engine already in Windows, so tables, syntax
highlighting and nested lists look the same as they do on GitHub.

The interface is available in **English and 正體中文**, switchable from the toolbar.

## Install

Download `MdViewer.exe` from the [latest release](../../releases/latest) and run it.
That's the whole installation.

## Usage

Double-click `MdViewer.exe`, or:

```
MdViewer.exe a.md b.md      # open files directly; can also be set as the default .md handler
```

| Action | How |
| --- | --- |
| New tab | `+` at the right of the tab bar, or `Ctrl+T` |
| Close tab | the `×` on the tab, middle-click it, or `Ctrl+W` |
| Open a file | **drag a `.md` into the window**, or `Ctrl+O` |
| Hide / show the editor | the translucent `‹‹` `››` button on the divider, "Editor" in the toolbar, or `Ctrl+E` |
| Save back to the original file | `Ctrl+S` |
| Switch tabs | `Alt+1`–`Alt+9`, `Ctrl+Tab` |
| Find | `Ctrl+F`, or `🔍` in the toolbar; `Enter` / `Shift+Enter` or `F3` step, `Esc` closes |
| Replace | `Ctrl+H` (source only) |
| Print preview | `Ctrl+P` |
| Save a copy as HTML | the `▾` next to "Save" → "Save as HTML…", or `Ctrl+Shift+H` |
| Save a copy as PDF | the `▾` next to "Save" → "Save as PDF…", or `Ctrl+Shift+D` |
| Preview slides in a tab | "Slides" in the toolbar, or `Ctrl+Shift+P` |
| Export slides as HTML | the `▾` next to "Slides" → "Export slides as HTML…", or `Ctrl+Shift+E` |

Dragging files in loads them into the current tab if it is blank, and otherwise opens new
tabs — drop several files and you get several tabs.

On a blank tab the drop hint covers only the preview half, so you can start typing in the
editor on the left at any time.

## Features

- Tabbed, with the editor on the left and a live preview on the right. The divider drags
  to any ratio (double-click for 50/50) and scrolling is synchronised.
- A translucent button on the divider collapses and restores the editor; collapsed, it
  tucks against the left edge. **Each tab remembers its own collapsed state.**
- GFM tables, task lists and strikethrough; syntax highlighting; GitHub-style alert
  blocks (`> [!NOTE]` and friends).
- Checkboxes in the preview can be ticked directly and are written back to the source.
- **Relative-path images render**, and links to a `.md` file next door open in a new tab.
- **File encoding and line endings survive a save** — UTF-8, BOM, Big5, CRLF and LF are
  all preserved exactly as found.
- **You're told when another program changes the file**: on tab switch or when the window
  regains focus, MD Viewer compares against disk and offers to reload. Choosing "keep
  current" stops it asking again for that same version, and the status bar keeps a
  `⚠ a newer version exists on disk` reminder.
- **Tabs come back after a restart.** What was open is recorded in
  `%LOCALAPPDATA%\MdViewer\session.json`; tabs backed by a file are re-read from disk on
  the next launch, so nothing stale is shown, and only unsaved content is kept as a draft.
- **Nine themes** (the `◐` button at the right of the toolbar): match system, GitHub
  Light / Dark, Solarized Light / Dark, Nord, Dracula, One Dark, Gruvbox Dark.
  **Syntax highlighting recolours with the theme.**
- **English / 正體中文 interface** (the `🌐` button), defaulting to your system language
  and remembered in `session.json`.
- **Find, in either half** (`Ctrl+F`). The bar carries a **Source / Preview** switch:
  searching the source finds Markdown syntax itself (`](`, `##`), searching the preview
  finds the words you are reading, and it keeps working with the editor collapsed. Every
  match is highlighted, the current one more strongly, and `Ctrl+H` adds replace — on the
  source, since the preview is a rendered result.
- **A document can be handed on as HTML or PDF** (the `▾` next to "Save"):
  - "Save as HTML…" (`Ctrl+Shift+H`) writes the document exactly as the preview shows it,
    in **one self-contained file** — the stylesheet is inlined and **relative-path images
    are embedded**, so it can simply be emailed. It keeps the theme you are using.
  - "Save as PDF…" (`Ctrl+Shift+D`) prints through the WebView2 engine, so there is no
    print dialog to sit through. The PDF is **always light**, whatever the current theme,
    and the paper size follows your Windows region (A4, or Letter in North America).
- **Markdown converts to slides**, with both routes sharing one output:
  - "Slides" (`Ctrl+Shift+P`) **pages through the deck in a new tab** without saving
    first. Arrow keys page, `O` shows an overview, `S` reveals speaker notes. Edit the
    Markdown, press it again, and the same tab regenerates and stays on the slide you
    were on.
  - `▾` → "Export slides as HTML…" (`Ctrl+Shift+E`) writes a single self-contained HTML
    file with no external dependencies — mail it to someone or print it to PDF.
  - `##` starts a section, `###` starts a slide, and `::: cols` / `::: card` / `::: note`
    handle layout. A `> Notes:` blockquote becomes a speaker note shown only when `S` is
    pressed. See [Slide syntax](#slide-syntax) below.
- Window position and size are remembered.

Settings and caches live only in `%LOCALAPPDATA%\MdViewer\`; nothing is written next to
the executable:

```
session.json   open tabs, theme and language (plain JSON — readable and backup-able)
window.txt     window position and size
debug.log      only written in --dev mode
WebView2\      WebView2 runtime cache
native\        WebView2Loader.dll, extracted on first run
```

## Slide syntax

A deck is ordinary Markdown. The structure comes from heading levels:

| Markup | Result |
| --- | --- |
| `# Title` | document title and cover slide |
| `## Name` | a section (does not produce a slide of its own) |
| `### Name` | one slide |
| `---` on its own line | a forced slide break |
| `### Name // kicker` | slide title with an eyebrow subtitle |
| `> Notes: …` | speaker note, revealed with `S` |

Fenced divs handle layout:

````markdown
::: cols side
Left column
+++
::: card
A card in the right column
:::
:::

::: note
A callout. `::: note teal` gives the alternative colour.
:::
````

Slide chrome (the footer hints, the overview, the speaker-note label) follows the
application language.

## Requirements

Windows 10 1903+ or Windows 11. Both dependencies ship with the OS, so there is nothing
extra to install:

- **.NET Framework 4.x** — included with Windows.
- **WebView2 Runtime** — built into Windows 11; deployed with Edge on Windows 10. If it
  is somehow missing, the program says so and tells you what to install.

> Note: the window is a native one, not a browser. The WebView2 engine does spawn its own
> `msedgewebview2.exe` child process, which is how the engine is built.

## Building from source

```
powershell -ExecutionPolicy Bypass -File fetch-webview2.ps1   # first time only (downloads the WebView2 SDK)
build.cmd
```

This uses the `csc.exe` that ships with Windows — no Visual Studio, no .NET SDK.

```
src\Program.cs   native shell: window, file I/O, drag and drop, the bridge to the web side
src\web\         the UI, embedded into the exe (index.html / style.css / app.js + vendor,
                 and export.html, the "Save as HTML" template)
src\web\slides\  slide template and runtime (see the note below)
src\lib\         WebView2 components, also embedded (fetched, not stored in this repo)
src\app.ico      application icon (produced by make-icon.ps1)
src\test\test.py end-to-end regression tests
```

Everything under `src\web\` and the DLLs are embedded as resources and served at runtime
from `https://mdviewer.local/` by the program itself, which is why only the single
executable needs distributing.

Run the regression tests after any change (needs `pip install websocket-client`):

```
py src\test\test.py
```

Design decisions and the traps hit along the way are recorded in [NOTES.md](NOTES.md).

### Debugging

`MdViewer.exe --dev <file>` opens DevTools (F12), writes diagnostics to
`%LOCALAPPDATA%\MdViewer\debug.log`, and exposes a remote debugging port on
`127.0.0.1:9333` for CDP-driven automation.

## Known limitations

- No math (KaTeX) and no Mermaid diagrams. Both are far larger than the whole program, so
  they are left out deliberately.
- x64 only.

## License

[MIT](LICENSE). Bundled third-party components and their licenses are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
