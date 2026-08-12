# Third-Party Notices

MD Viewer bundles the following third-party components. Each remains under its
own license; the terms below apply in addition to the MIT license in
[LICENSE](LICENSE).

## Bundled in the repository and embedded into `MdViewer.exe`

### marked 15.0.7 — MIT

Markdown parser. <https://github.com/markedjs/marked>
File: `src/web/vendor/marked.min.js`

> Copyright (c) 2011-2025, Christopher Jeffrey
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
> FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
> IN THE SOFTWARE.

### DOMPurify 3.2.4 — Apache-2.0 OR MPL-2.0

HTML sanitizer. <https://github.com/cure53/DOMPurify>
File: `src/web/vendor/purify.min.js`

Copyright (c) Cure53 and other contributors. Dual-licensed under the Apache
License 2.0 and the Mozilla Public License 2.0; you may choose either. Full
texts: <https://www.apache.org/licenses/LICENSE-2.0> and
<https://www.mozilla.org/en-US/MPL/2.0/>.

### highlight.js 11.11.1 — BSD-3-Clause

Syntax highlighting. <https://github.com/highlightjs/highlight.js>
File: `src/web/vendor/highlight.min.js`

> Copyright (c) 2006-2024, Josh Goebel and other contributors
> All rights reserved.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice,
>    this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice,
>    this list of conditions and the following disclaimer in the documentation
>    and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its
>    contributors may be used to endorse or promote products derived from this
>    software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
> ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
> LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
> CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
> SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
> INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
> CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
> ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
> POSSIBILITY OF SUCH DAMAGE.

## Fetched at build time, not stored in this repository

### Microsoft.Web.WebView2 1.0.4078.44

`fetch-webview2.ps1` downloads the official NuGet package and copies three
files into `src/lib/`, which `build.cmd` then embeds into the executable:

- `Microsoft.Web.WebView2.Core.dll`
- `Microsoft.Web.WebView2.WinForms.dll`
- `WebView2Loader.dll`

These are covered by the Microsoft Software License Terms for the Microsoft
Edge WebView2 SDK, distributed with the NuGet package. See
<https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4078.44/license>.

The WebView2 **Runtime** itself is not distributed here at all — it ships with
Windows 11 and with Microsoft Edge on Windows 10.
