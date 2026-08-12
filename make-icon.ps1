# Generate src\app.ico (256x256 PNG-compressed icon). Run only when the icon needs changing.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$size = 256

$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'

# rounded dark slab
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 46
$path.AddArc(0, 0, $r, $r, 180, 90)
$path.AddArc($size - $r, 0, $r, $r, 270, 90)
$path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
$path.AddArc(0, $size - $r, $r, $r, 90, 90)
$path.CloseFigure()
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point $size, $size),
    [System.Drawing.Color]::FromArgb(255, 33, 41, 54),
    [System.Drawing.Color]::FromArgb(255, 17, 22, 30))
$g.FillPath($bg, $path)

# "M" wordmark
$font = New-Object System.Drawing.Font('Segoe UI', 118, [System.Drawing.FontStyle]::Bold, 'Pixel')
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 236, 241, 247))
$g.DrawString('M', $font, $white, ($size / 2), 26, $fmt)

# download-style arrow (markdown mark)
$accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 88, 166, 255))
$pen = New-Object System.Drawing.Pen $accent, 20
$pen.StartCap = 'Round'
$g.DrawLine($pen, ($size / 2), 158, ($size / 2), 208)
$tri = @(
    (New-Object System.Drawing.Point ([int]($size / 2 - 34)), 196),
    (New-Object System.Drawing.Point ([int]($size / 2 + 34)), 196),
    (New-Object System.Drawing.Point ([int]($size / 2)), 240)
)
$g.FillPolygon($accent, $tri)
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$bmp.Dispose()

# wrap the PNG in an .ico container
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)      # ICONDIR
$w.Write([byte]0); $w.Write([byte]0)                               # 0 means 256 px
$w.Write([byte]0); $w.Write([byte]0)
$w.Write([uint16]1); $w.Write([uint16]32)
$w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png)
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'src\app.ico'), $out.ToArray())
Write-Output ("src\app.ico written ({0} bytes)" -f $out.Length)
