// MD Viewer — a single-executable Markdown viewer / editor
// Shell: WinForms + WebView2. UI and rendering: HTML/CSS/JS embedded in the exe.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MdViewer
{
    // Strings for the native dialogs. The web UI owns the language setting and pushes it
    // down with the 'lang' message; until that arrives we go by the OS UI culture, which
    // is the best we can do for failures that happen before the WebView is even up.
    // (C# 5: no string interpolation, no ?. — the in-box csc.exe is all we build with.)
    static class L
    {
        static bool zh = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh";

        static readonly Dictionary<string, string> En = new Dictionary<string, string>
        {
            { "err.wv2Prepare", "Could not prepare the WebView2 components:\n" },
            { "err.wv2Runtime",
              "Could not start the WebView2 runtime.\n\n" +
              "This program needs the Microsoft Edge WebView2 Runtime (built into\n" +
              "Windows 11; a free download from Microsoft on Windows 10).\n\nDetails: " },
            { "err.readFailed", "Could not read: " },
            { "err.notFound", "File not found: " },
            { "err.pdfEngine", "the print engine reported a failure" },
            { "filter.open", "Markdown files|*.md;*.markdown;*.mdown;*.mkd;*.mdwn;*.txt|All files|*.*" },
            { "filter.save", "Markdown files|*.md;*.markdown|Text files|*.txt|All files|*.*" },
            { "filter.export", "HTML slides|*.html;*.htm|All files|*.*" },
            { "filter.exportDoc", "HTML document|*.html;*.htm|All files|*.*" },
            { "filter.pdf", "PDF document|*.pdf|All files|*.*" },
            { "file.untitled", "Untitled.md" },
            { "file.slides", "slides.html" },
            { "file.doc", "document.html" },
            { "file.pdf", "document.pdf" },
            { "confirm.unsaved", "{0} tab(s) still have unsaved changes. Close anyway?" },
        };

        static readonly Dictionary<string, string> Zh = new Dictionary<string, string>
        {
            { "err.wv2Prepare", "無法準備 WebView2 元件：\n" },
            { "err.wv2Runtime",
              "無法啟動 WebView2 執行環境。\n\n" +
              "本程式需要 Microsoft Edge WebView2 Runtime（Windows 11 內建，\n" +
              "Windows 10 可從 Microsoft 官網免費安裝）。\n\n詳細訊息：" },
            { "err.readFailed", "無法讀取：" },
            { "err.notFound", "找不到檔案：" },
            { "err.pdfEngine", "列印引擎回報失敗" },
            { "filter.open", "Markdown 檔案|*.md;*.markdown;*.mdown;*.mkd;*.mdwn;*.txt|所有檔案|*.*" },
            { "filter.save", "Markdown 檔案|*.md;*.markdown|文字檔|*.txt|所有檔案|*.*" },
            { "filter.export", "HTML 投影片|*.html;*.htm|所有檔案|*.*" },
            { "filter.exportDoc", "HTML 文件|*.html;*.htm|所有檔案|*.*" },
            { "filter.pdf", "PDF 文件|*.pdf|所有檔案|*.*" },
            { "file.untitled", "未命名.md" },
            { "file.slides", "投影片.html" },
            { "file.doc", "文件.html" },
            { "file.pdf", "文件.pdf" },
            { "confirm.unsaved", "還有 {0} 個分頁尚未儲存，確定要關閉嗎？" },
        };

        public static void Set(string lang)
        {
            if (string.IsNullOrEmpty(lang)) return;
            zh = lang.StartsWith("zh", StringComparison.OrdinalIgnoreCase);
        }

        public static string T(string key)
        {
            Dictionary<string, string> table = zh ? Zh : En;
            string s;
            if (table.TryGetValue(key, out s)) return s;
            if (En.TryGetValue(key, out s)) return s;
            return key;
        }

        public static string T(string key, object arg0)
        {
            return string.Format(T(key), arg0);
        }
    }

    static class Program
    {
        internal const string AppHost = "mdviewer.local";
        internal const string AppOrigin = "https://" + AppHost + "/";

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetDllDirectory(string path);

        [STAThread]
        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            try
            {
                PrepareNativeLoader();
            }
            catch (Exception ex)
            {
                MessageBox.Show(L.T("err.wv2Prepare") + ex.Message, "MD Viewer",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            Run(args);
        }

        // Kept separate so the WebView2 types are only resolved after AssemblyResolve is wired up.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Run(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(args));
        }

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs e)
        {
            string simple = new AssemblyName(e.Name).Name;
            byte[] data = Resource("lib/" + simple + ".dll");
            return data == null ? null : Assembly.Load(data);
        }

        // WebView2Loader.dll is native, so it has to exist on disk before P/Invoke can load it.
        static void PrepareNativeLoader()
        {
            string dir = Path.Combine(DataDir, "native",
                Assembly.GetExecutingAssembly().GetName().Version.ToString());
            string dll = Path.Combine(dir, "WebView2Loader.dll");
            if (!File.Exists(dll))
            {
                Directory.CreateDirectory(dir);
                byte[] data = Resource("lib/WebView2Loader.dll");
                string tmp = dll + "." + Guid.NewGuid().ToString("N") + ".tmp";
                File.WriteAllBytes(tmp, data);
                try { File.Move(tmp, dll); }
                catch { try { File.Delete(tmp); } catch { } }   // another instance got there first
            }
            SetDllDirectory(dir);
        }

        internal static string DataDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MdViewer");
            }
        }

        internal static byte[] Resource(string name)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) return null;
                using (var ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }
    }

    class MainForm : Form
    {
        readonly WebView2 web = new WebView2();
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        readonly string[] startupArgs;
        const string LocalPrefix = "__local/";
        readonly Dictionary<string, int> folderIds =
            new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        readonly List<string> folderRoots = new List<string>();
        readonly Dictionary<string, TextFormat> fileFormats =
            new Dictionary<string, TextFormat>(StringComparer.OrdinalIgnoreCase);
        int dirtyCount;
        bool devMode;
        bool ready;

        struct TextFormat
        {
            public Encoding Encoding;
            public bool Bom;
            public bool Crlf;
        }

        public MainForm(string[] args)
        {
            var files = new List<string>();
            foreach (string a in args)
            {
                if (a.Equals("--dev", StringComparison.OrdinalIgnoreCase)) devMode = true;
                else files.Add(a);
            }
            startupArgs = files.ToArray();

            json.MaxJsonLength = int.MaxValue;
            Text = "MD Viewer";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            BackColor = Color.FromArgb(13, 17, 23);
            MinimumSize = new Size(520, 360);
            StartPosition = FormStartPosition.Manual;
            Bounds = LoadBounds();

            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(13, 17, 23);
            Controls.Add(web);


            Shown += delegate { InitWebView(); };
            Activated += OnActivated;
            FormClosing += OnFormClosing;
        }

        /* ---------------- WebView2 initialisation ---------------- */

        async void InitWebView()
        {
            try
            {
                string browserArgs = "--disable-features=msSmartScreenProtection";
                if (devMode) browserArgs += " --remote-debugging-port=9333";
                var options = new CoreWebView2EnvironmentOptions(browserArgs);
                var env = await CoreWebView2Environment.CreateAsync(
                    null, Path.Combine(Program.DataDir, "WebView2"), options);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                MessageBox.Show(L.T("err.wv2Runtime") + ex.Message,
                    "MD Viewer", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            CoreWebView2 core = web.CoreWebView2;
            CoreWebView2Settings s = core.Settings;
            s.AreBrowserAcceleratorKeysEnabled = false;   // leaves Ctrl+T/W/N/P for us to handle
            s.AreDevToolsEnabled = devMode;
            s.IsStatusBarEnabled = false;
            s.IsSwipeNavigationEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.IsGeneralAutofillEnabled = false;

            // The web side receives the drop (so the drag hint works) and hands the File
            // objects back here, which is where the real paths come from.
            try { web.AllowExternalDrop = true; }
            catch (Exception ex) { Log("AllowExternalDrop: " + ex.Message); }

            core.AddWebResourceRequestedFilter(Program.AppOrigin + "*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += OnWebResourceRequested;
            core.WebMessageReceived += OnWebMessage;
            core.NewWindowRequested += OnNewWindowRequested;
            core.NavigationStarting += OnNavigationStarting;
            core.NavigationCompleted += OnNavigationCompleted;

            core.Navigate(Program.AppOrigin + "index.html");
        }

        void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            var env = web.CoreWebView2.Environment;
            string path;
            try
            {
                path = new Uri(e.Request.Uri).AbsolutePath.TrimStart('/');
            }
            catch
            {
                return;
            }
            if (path.Length == 0) path = "index.html";

            if (path.StartsWith(LocalPrefix, StringComparison.Ordinal))
            {
                if (!ServeLocalFile(path, e))
                    e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
                return;
            }

            byte[] data = Program.Resource("web/" + path);
            if (data == null)
            {
                e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
                return;
            }
            e.Response = env.CreateWebResourceResponse(new MemoryStream(data), 200, "OK",
                "Content-Type: " + MimeOf(path) + "\r\nCache-Control: no-cache");
        }

        static string MimeOf(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".gif": return "image/gif";
                case ".webp": return "image/webp";
                case ".avif": return "image/avif";
                case ".bmp": return "image/bmp";
                case ".ico": return "image/x-icon";
                case ".woff2": return "font/woff2";
                case ".woff": return "font/woff";
                default: return "application/octet-stream";
            }
        }

        void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            // Stay on our own page; hand every other link to the system browser.
            if (e.Uri.StartsWith(Program.AppOrigin, StringComparison.OrdinalIgnoreCase)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        }

        void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            OpenExternal(e.Uri);
        }

        static void OpenExternal(string uri)
        {
            if (!uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
            try { Process.Start(uri); } catch { }
        }

        void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            ready = true;
            if (startupArgs.Length > 0) SendFiles(startupArgs, true);
        }

        // Window regained focus → tell the web side to check whether the current tab's file
        // changed underneath it. This uses WinForms' Activated rather than the web side's
        // window.onfocus, because inside WebView2 the latter doesn't reliably track the
        // window (it may not fire at all when you click back in); this signal does.
        void OnActivated(object sender, EventArgs e)
        {
            if (!ready) return;
            var msg = new Dictionary<string, object>();
            msg["cmd"] = "windowActivated";
            Post(msg);
        }

        /* ---------------- Messaging with the web side ---------------- */

        void Post(Dictionary<string, object> msg)
        {
            if (web.CoreWebView2 == null) return;
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(msg));
        }

        void Reply(object id, Dictionary<string, object> data)
        {
            data["id"] = id;
            Post(data);
        }

        void ReplyError(object id, string message)
        {
            var d = new Dictionary<string, object>();
            d["ok"] = false;
            d["error"] = message;
            Reply(id, d);
        }

        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            Dictionary<string, object> m;
            try
            {
                m = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
            }
            catch
            {
                return;
            }
            object id = Get(m, "id");
            string cmd = Str(Get(m, "cmd"));

            switch (cmd)
            {
                case "dropFiles": CmdDropFiles(id, e); break;
                case "open": CmdOpen(id); break;
                case "save": CmdSave(id, m); break;
                case "export": CmdExport(id, m); break;
                case "printPdf": CmdPrintPdf(id, m); break;
                case "reopen": CmdReopen(id, m); break;
                case "title": CmdTitle(m); break;
                case "openPath": CmdOpenPath(id, m); break;
                case "stat": CmdStat(id, m); break;
                case "sessionSave": CmdSessionSave(m); break;
                case "sessionLoad": CmdSessionLoad(id); break;
                case "lang": L.Set(Str(Get(m, "lang"))); break;
                case "quit": Close(); break;
            }
        }

        // The web side forwards the dropped File objects, which is the only way to get real paths.
        void CmdDropFiles(object id, CoreWebView2WebMessageReceivedEventArgs e)
        {
            var paths = new List<string>();
            try
            {
                foreach (object o in e.AdditionalObjects)
                {
                    var file = o as CoreWebView2File;
                    if (file != null) paths.Add(file.Path);
                }
            }
            catch (Exception ex)
            {
                Log("dropFiles failed: " + ex.Message);       // older runtimes don't support this
            }

            var r = new Dictionary<string, object>();
            r["ok"] = true;
            r["files"] = ReadAll(Expand(paths).ToArray(), true);
            Reply(id, r);
        }

        void CmdOpen(object id)
        {
            using (var dlg = new OpenFileDialog())
            {
                dlg.Filter = L.T("filter.open");
                dlg.Multiselect = true;
                var d = new Dictionary<string, object>();
                if (dlg.ShowDialog(this) != DialogResult.OK)
                {
                    d["ok"] = false;
                    d["cancelled"] = true;
                    Reply(id, d);
                    return;
                }
                d["ok"] = true;
                d["files"] = ReadAll(dlg.FileNames);
                Reply(id, d);
            }
        }

        void CmdSave(object id, Dictionary<string, object> m)
        {
            string path = Str(Get(m, "path"));
            string name = Str(Get(m, "name"));
            string text = Str(Get(m, "text"));

            if (string.IsNullOrEmpty(path))
            {
                using (var dlg = new SaveFileDialog())
                {
                    dlg.Filter = L.T("filter.save");
                    dlg.DefaultExt = "md";
                    dlg.FileName = string.IsNullOrEmpty(name) ? L.T("file.untitled")
                        : (Path.HasExtension(name) ? name : name + ".md");
                    if (dlg.ShowDialog(this) != DialogResult.OK)
                    {
                        var c = new Dictionary<string, object>();
                        c["ok"] = false;
                        c["cancelled"] = true;
                        Reply(id, c);
                        return;
                    }
                    path = dlg.FileName;
                }
            }

            try
            {
                WriteTextFile(path, text);
            }
            catch (Exception ex)
            {
                ReplyError(id, ex.Message);
                return;
            }

            var r = new Dictionary<string, object>();
            r["ok"] = true;
            r["path"] = path;
            r["name"] = Path.GetFileName(path);
            r["base"] = MapFolder(Path.GetDirectoryName(path));
            Stamp(path, r);           // return the post-write timestamp, so our own save isn't read back as an external edit
            Reply(id, r);
        }

        // Where an exported file should go. Returns false, having replied "cancelled", when
        // the user backs out. An explicit path shows no dialog at all — that is the route
        // the automated tests take, since CDP cannot click native dialogs.
        bool AskSavePath(object id, Dictionary<string, object> m,
                         string filterKey, string ext, string fallbackKey, out string chosen)
        {
            chosen = Str(Get(m, "path"));
            if (!string.IsNullOrEmpty(chosen)) return true;

            string name = Str(Get(m, "name"));
            string near = Str(Get(m, "dir"));
            using (var dlg = new SaveFileDialog())
            {
                dlg.Filter = L.T(filterKey);
                dlg.DefaultExt = ext;
                dlg.FileName = string.IsNullOrEmpty(name) ? L.T(fallbackKey) : name;
                // Default to sitting next to the source .md
                try
                {
                    if (!string.IsNullOrEmpty(near))
                    {
                        string dir = Path.GetDirectoryName(near);
                        if (Directory.Exists(dir)) dlg.InitialDirectory = dir;
                    }
                }
                catch { }

                if (dlg.ShowDialog(this) != DialogResult.OK)
                {
                    var c = new Dictionary<string, object>();
                    c["ok"] = false;
                    c["cancelled"] = true;
                    Reply(id, c);
                    return false;
                }
                chosen = dlg.FileName;
                return true;
            }
        }

        // Export: the web side has already assembled the whole file, so all this does is
        // pick a location and write UTF-8. 'kind' says whether that content is a slide
        // deck or a plain document, which only changes the dialog's wording.
        void CmdExport(object id, Dictionary<string, object> m)
        {
            string text = Str(Get(m, "text"));
            bool doc = Str(Get(m, "kind")) == "doc";
            string path;
            if (!AskSavePath(id, m, doc ? "filter.exportDoc" : "filter.export", "html",
                             doc ? "file.doc" : "file.slides", out path)) return;

            try
            {
                // Deliberately not WriteTextFile(): that reuses the source file's remembered
                // encoding and line endings, whereas exported HTML must always be UTF-8
                // without a BOM so it opens cleanly for whoever receives it.
                byte[] body = new UTF8Encoding(false).GetBytes(text);
                using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    fs.Write(body, 0, body.Length);
                }
            }
            catch (Exception ex)
            {
                ReplyError(id, ex.Message);
                return;
            }

            var r = new Dictionary<string, object>();
            r["ok"] = true;
            r["path"] = path;
            r["name"] = Path.GetFileName(path);
            Reply(id, r);
        }

        // Save as PDF. WebView2 prints the page it is currently showing, so by the time
        // this runs the web side has already made the exported tab the visible one and
        // dropped the theme's skin; the @media print rules in style.css take the app
        // chrome away and let the document flow across pages.
        // Which paper this user actually prints on. WebView2's print settings default to
        // 8.5x11 everywhere, which is wrong outside North America; Windows knows the answer
        // (LOCALE_IPAPERSIZE: 1 = Letter, 5 = Legal, everything else A-series), so ask it.
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern int GetLocaleInfoEx(string localeName, uint lcType, out int value, int cch);

        const uint LOCALE_IPAPERSIZE = 0x0000100A;
        const uint LOCALE_RETURN_NUMBER = 0x20000000;

        static void ApplyPaperSize(CoreWebView2PrintSettings ps)
        {
            double w = 8.27, h = 11.69;                 // A4, the sane default for most of the world
            try
            {
                int paper;
                if (GetLocaleInfoEx(null, LOCALE_IPAPERSIZE | LOCALE_RETURN_NUMBER,
                                    out paper, 2) != 0)
                {
                    if (paper == 1) { w = 8.5; h = 11.0; }        // Letter
                    else if (paper == 5) { w = 8.5; h = 14.0; }   // Legal
                }
            }
            catch { }
            ps.PageWidth = w;
            ps.PageHeight = h;
        }

        async void CmdPrintPdf(object id, Dictionary<string, object> m)
        {
            string path;
            if (!AskSavePath(id, m, "filter.pdf", "pdf", "file.pdf", out path)) return;

            try
            {
                CoreWebView2PrintSettings ps = web.CoreWebView2.Environment.CreatePrintSettings();
                ps.ShouldPrintBackgrounds = true;      // code blocks and tables keep their fills
                ApplyPaperSize(ps);
                ps.MarginTop = 0.4;
                ps.MarginBottom = 0.4;
                ps.MarginLeft = 0.5;
                ps.MarginRight = 0.5;
                bool ok = await web.CoreWebView2.PrintToPdfAsync(path, ps);
                if (!ok)
                {
                    ReplyError(id, L.T("err.pdfEngine"));
                    return;
                }
            }
            catch (Exception ex)
            {
                ReplyError(id, ex.Message);
                return;
            }

            var pr = new Dictionary<string, object>();
            pr["ok"] = true;
            pr["path"] = path;
            pr["name"] = Path.GetFileName(path);
            Reply(id, pr);
        }

        // Report the current on-disk state of these paths; the web side uses it to tell
        // whether a file was changed by another program.
        void CmdStat(object id, Dictionary<string, object> m)
        {
            var list = new List<object>();
            foreach (string p in StrList(Get(m, "paths")))
            {
                var d = new Dictionary<string, object>();
                d["path"] = p;
                d["exists"] = File.Exists(p);
                Stamp(p, d);
                list.Add(d);
            }
            var r = new Dictionary<string, object>();
            r["ok"] = true;
            r["files"] = list;
            Reply(id, r);
        }

        // mtime travels as an ISO string rather than ticks: ticks are around 6.4e17, past
        // the 2^53 that JS can represent exactly, so they'd lose precision in transit.
        static void Stamp(string path, Dictionary<string, object> d)
        {
            try
            {
                var fi = new FileInfo(path);
                if (!fi.Exists) { d["mtime"] = null; d["size"] = -1; return; }
                d["mtime"] = fi.LastWriteTimeUtc.ToString("o", CultureInfo.InvariantCulture);
                d["size"] = fi.Length;
            }
            catch
            {
                d["mtime"] = null;
                d["size"] = -1;
            }
        }

        // When restoring last session's tabs, unmodified files are re-read from disk so
        // nothing stale is shown.
        void CmdReopen(object id, Dictionary<string, object> m)
        {
            List<string> paths = StrList(Get(m, "paths"));
            var r = new Dictionary<string, object>();
            r["ok"] = true;
            r["files"] = ReadAll(paths.ToArray(), true);
            Reply(id, r);
        }

        void CmdOpenPath(object id, Dictionary<string, object> m)
        {
            string path = Str(Get(m, "path"));
            var r = new Dictionary<string, object>();
            if (!File.Exists(path))
            {
                r["ok"] = false;
                r["error"] = L.T("err.notFound") + path;
                Reply(id, r);
                return;
            }
            r["ok"] = true;
            r["files"] = ReadAll(new string[] { path });
            Reply(id, r);
        }

        void CmdTitle(Dictionary<string, object> m)
        {
            string t = Str(Get(m, "text"));
            object dirty = Get(m, "dirty");
            dirtyCount = dirty == null ? 0 : Convert.ToInt32(dirty, CultureInfo.InvariantCulture);
            Text = string.IsNullOrEmpty(t) ? "MD Viewer" : t + " — MD Viewer";
        }

        /* ---------------- File access ---------------- */

        List<object> ReadAll(string[] paths, bool skipMissing = false)
        {
            var list = new List<object>();
            foreach (string p in paths)
            {
                try
                {
                    if (skipMissing && !File.Exists(p)) continue;
                    list.Add(ReadOne(p));
                }
                catch (Exception ex)
                {
                    if (skipMissing) continue;
                    MessageBox.Show(L.T("err.readFailed") + p + "\n" + ex.Message, "MD Viewer",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            return list;
        }

        Dictionary<string, object> ReadOne(string path)
        {
            string full = Path.GetFullPath(path);
            byte[] raw = File.ReadAllBytes(full);
            TextFormat fmt;
            string text = Decode(raw, out fmt);
            fileFormats[full] = fmt;

            var d = new Dictionary<string, object>();
            d["path"] = full;
            d["name"] = Path.GetFileName(full);
            d["text"] = text;
            d["base"] = MapFolder(Path.GetDirectoryName(full));
            Stamp(full, d);
            return d;
        }

        static string Decode(byte[] raw, out TextFormat fmt)
        {
            fmt = new TextFormat();
            fmt.Bom = raw.Length >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF;

            string text;
            if (fmt.Bom || IsUtf8(raw))
            {
                fmt.Encoding = new UTF8Encoding(false);
                text = new UTF8Encoding(false).GetString(raw, fmt.Bom ? 3 : 0, raw.Length - (fmt.Bom ? 3 : 0));
            }
            else
            {
                // Not UTF-8 (Big5 / ANSI, say): use the system default encoding and write it back the same way.
                fmt.Encoding = Encoding.Default;
                text = Encoding.Default.GetString(raw);
            }

            fmt.Crlf = text.IndexOf("\r\n", StringComparison.Ordinal) >= 0;
            return text.Replace("\r\n", "\n").Replace("\r", "\n");   // the web side always works in LF
        }

        static bool IsUtf8(byte[] b)
        {
            int i = 0;
            while (i < b.Length)
            {
                int n;
                if (b[i] < 0x80) { i++; continue; }
                else if ((b[i] & 0xE0) == 0xC0) n = 1;
                else if ((b[i] & 0xF0) == 0xE0) n = 2;
                else if ((b[i] & 0xF8) == 0xF0) n = 3;
                else return false;

                if (i + n >= b.Length) return false;
                for (int k = 1; k <= n; k++)
                    if ((b[i + k] & 0xC0) != 0x80) return false;
                i += n + 1;
            }
            return true;
        }

        void WriteTextFile(string path, string text)
        {
            string full = Path.GetFullPath(path);
            TextFormat fmt;
            if (!fileFormats.TryGetValue(full, out fmt))
            {
                fmt = new TextFormat();
                fmt.Encoding = new UTF8Encoding(false);
                fmt.Bom = false;
                fmt.Crlf = Environment.NewLine == "\r\n";
            }

            string outText = text.Replace("\r\n", "\n");
            if (fmt.Crlf) outText = outText.Replace("\n", "\r\n");

            byte[] body = fmt.Encoding.GetBytes(outText);
            using (var fs = new FileStream(full, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                if (fmt.Bom) fs.Write(new byte[] { 0xEF, 0xBB, 0xBF }, 0, 3);
                fs.Write(body, 0, body.Length);
            }
            fileFormats[full] = fmt;
        }

        // Makes relative-path images in Markdown work: each containing folder gets a number,
        // and https://mdviewer.local/__local/<number>/<relative path> is then mapped back to
        // the real file by ServeLocalFile below. Same origin as the page, and no dependence
        // on virtual host name mapping.
        string MapFolder(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return null;
            string full = Path.GetFullPath(dir);
            int id;
            if (!folderIds.TryGetValue(full, out id))
            {
                id = folderRoots.Count;
                folderRoots.Add(full);
                folderIds[full] = id;
                Log("folder " + id + " -> " + full);
            }
            return Program.AppOrigin + LocalPrefix + id + "/";
        }

        // Serve __local/<number>/<relative path>, restricted to files under that number's folder.
        bool ServeLocalFile(string path, CoreWebView2WebResourceRequestedEventArgs e)
        {
            string rest = path.Substring(LocalPrefix.Length);
            int slash = rest.IndexOf('/');
            int id;
            if (slash <= 0 || !int.TryParse(rest.Substring(0, slash), NumberStyles.Integer,
                                            CultureInfo.InvariantCulture, out id)) return false;
            if (id < 0 || id >= folderRoots.Count) return false;

            string root = folderRoots[id];
            string rel = Uri.UnescapeDataString(rest.Substring(slash + 1)).Replace('/', '\\');
            string full;
            try { full = Path.GetFullPath(Path.Combine(root, rel)); }
            catch { return false; }

            // Block ..\ and anything else that escapes the folder.
            if (!full.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) return false;
            if (!File.Exists(full)) return false;

            byte[] data;
            try { data = File.ReadAllBytes(full); }
            catch { return false; }

            e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(
                new MemoryStream(data), 200, "OK", "Content-Type: " + MimeOf(full));
            return true;
        }

        /* ---------------- File listing ---------------- */

        // Folders expand into the .md files inside them; paths that don't exist are skipped.
        static List<string> Expand(IEnumerable<string> paths)
        {
            var real = new List<string>();
            foreach (string p in paths)
            {
                if (string.IsNullOrEmpty(p)) continue;
                if (Directory.Exists(p))
                {
                    real.AddRange(Directory.GetFiles(p, "*.md", SearchOption.TopDirectoryOnly));
                }
                else if (File.Exists(p)) real.Add(p);
            }
            return real;
        }

        void SendFiles(string[] paths, bool startup)
        {
            if (!ready) return;
            List<string> real = Expand(paths);
            if (real.Count == 0) return;

            var msg = new Dictionary<string, object>();
            msg["cmd"] = "openFiles";
            msg["startup"] = startup;
            msg["files"] = ReadAll(real.ToArray());
            Post(msg);
        }

        /* ---------------- Session file ---------------- */

        // Which tabs are open is recorded in %LOCALAPPDATA%\MdViewer\session.json and read
        // back by the web side on the next launch. A real file rather than localStorage:
        // localStorage hides inside the WebView2 profile folder, where it can't be seen or
        // backed up, and clearing the profile takes every tab with it.
        string SessionFile { get { return Path.Combine(Program.DataDir, "session.json"); } }

        void CmdSessionSave(Dictionary<string, object> m)
        {
            string text = Str(Get(m, "text"));
            if (text == null) return;
            string path = SessionFile;
            string tmp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                Directory.CreateDirectory(Program.DataDir);
                File.WriteAllText(tmp, text, new UTF8Encoding(false));
                // Write to a temp file and move it into place, so a crash mid-write can't
                // leave half a JSON document behind.
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
            }
            catch (Exception ex)
            {
                Log("sessionSave: " + ex.Message);
                try { if (File.Exists(tmp)) File.Delete(tmp); }
                catch { }
            }
        }

        void CmdSessionLoad(object id)
        {
            var r = new Dictionary<string, object>();
            try
            {
                if (File.Exists(SessionFile))
                {
                    r["ok"] = true;
                    r["text"] = File.ReadAllText(SessionFile, new UTF8Encoding(false));
                }
                else
                {
                    r["ok"] = false;
                }
            }
            catch (Exception ex)
            {
                Log("sessionLoad: " + ex.Message);
                r["ok"] = false;
            }
            Reply(id, r);
        }

        /* ---------------- Window state ---------------- */

        void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (dirtyCount > 0 && e.CloseReason != CloseReason.WindowsShutDown)
            {
                DialogResult r = MessageBox.Show(this,
                    L.T("confirm.unsaved", dirtyCount),
                    "MD Viewer", MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (r != DialogResult.Yes) { e.Cancel = true; return; }
            }
            SaveBounds();
        }

        string BoundsFile { get { return Path.Combine(Program.DataDir, "window.txt"); } }

        Rectangle LoadBounds()
        {
            Rectangle def = new Rectangle(80, 60, 1280, 820);
            try
            {
                string[] parts = File.ReadAllText(BoundsFile).Split(',');
                var r = new Rectangle(
                    int.Parse(parts[0], CultureInfo.InvariantCulture),
                    int.Parse(parts[1], CultureInfo.InvariantCulture),
                    int.Parse(parts[2], CultureInfo.InvariantCulture),
                    int.Parse(parts[3], CultureInfo.InvariantCulture));
                if (r.Width < 400 || r.Height < 300) return def;
                foreach (Screen sc in Screen.AllScreens)
                    if (sc.WorkingArea.IntersectsWith(r)) return r;   // monitor layout changed: fall back to the default
                return def;
            }
            catch
            {
                return def;
            }
        }

        void SaveBounds()
        {
            try
            {
                Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                Directory.CreateDirectory(Program.DataDir);
                File.WriteAllText(BoundsFile, string.Format(CultureInfo.InvariantCulture,
                    "{0},{1},{2},{3}", r.X, r.Y, r.Width, r.Height));
            }
            catch { }
        }

        /* ---------------- Helpers ---------------- */

        // Diagnostics are only written in --dev mode.
        void Log(string line)
        {
            if (!devMode) return;
            try
            {
                Directory.CreateDirectory(Program.DataDir);
                File.AppendAllText(Path.Combine(Program.DataDir, "debug.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff") + "  " + line + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch { }
        }

        static object Get(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) ? v : null;
        }

        static string Str(object o)
        {
            return o == null ? null : o as string ?? Convert.ToString(o, CultureInfo.InvariantCulture);
        }

        // Note: JavaScriptSerializer deserialises nested JSON arrays into ArrayList, not
        // object[], so they can only be read through IEnumerable. Never write
        // `as object[]` here — it always yields null.
        static List<string> StrList(object o)
        {
            var list = new List<string>();
            var seq = o as System.Collections.IEnumerable;
            if (seq == null || o is string) return list;
            foreach (object item in seq)
            {
                string s = Str(item);
                if (!string.IsNullOrEmpty(s)) list.Add(s);
            }
            return list;
        }
    }
}
