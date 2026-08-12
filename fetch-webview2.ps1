# Fetch the WebView2 components needed to build, into src\lib\.
# Run once; every build after that works offline.
$ErrorActionPreference = 'Stop'
$ver = '1.0.4078.44'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$lib = Join-Path $root 'src\lib'
$tmp = Join-Path $env:TEMP ('wv2_' + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Force $lib | Out-Null
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$ver/microsoft.web.webview2.$ver.nupkg"
    Write-Host "Downloading Microsoft.Web.WebView2 $ver ..."
    Invoke-WebRequest $url -OutFile "$tmp\pkg.zip" -UseBasicParsing
    Expand-Archive "$tmp\pkg.zip" -DestinationPath "$tmp\x" -Force

    Copy-Item "$tmp\x\lib\net462\Microsoft.Web.WebView2.Core.dll" $lib -Force
    Copy-Item "$tmp\x\lib\net462\Microsoft.Web.WebView2.WinForms.dll" $lib -Force
    Copy-Item "$tmp\x\runtimes\win-x64\native\WebView2Loader.dll" $lib -Force
    Get-ChildItem $lib | Select-Object Name, Length | Format-Table -AutoSize
    Write-Host "Done. Now run build.cmd"
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
