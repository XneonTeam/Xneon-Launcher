param(
  [Parameter(Mandatory = $true)][string]$BunExecutable,
  [string]$ArtifactsDirectory = (Join-Path $env:LOCALAPPDATA 'Temp\opencode\nfd-smoke'),
  [string]$Runner
)

# UI Automation управляет только окнами дочернего тестового процесса.
# PowerShell здесь не создаёт диалог: его открывает проверяемый Bun FFI-адаптер.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
if (!$Runner) { $Runner = Join-Path $PSScriptRoot 'native-save-dialog.smoke.mjs' }
$Runner = [IO.Path]::GetFullPath($Runner)
$BunExecutable = [IO.Path]::GetFullPath($BunExecutable)
$artifacts = Join-Path $ArtifactsDirectory ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null

function Wait-NativeDialog($child) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$child.Id
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    if ($child.HasExited) { throw "Dialog process exited: $($child.ExitCode)" }
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
      [System.Windows.Automation.TreeScope]::Children, $condition
    )
    if ($window -and $window.Current.ClassName -eq '#32770') { return $window }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Native save dialog did not appear'
}

function Find-Control($window, [string]$id) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id
  )
  $control = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if (!$control) { throw "Native dialog control is missing: $id" }
  return $control
}

foreach ($mode in @('cancel', 'save')) {
  $destination = Join-Path $artifacts 'nfd-native-save.zip'
  $stdout = Join-Path $artifacts "$mode.stdout.json"
  $stderr = Join-Path $artifacts "$mode.stderr.txt"
  $arguments = @('--no-env-file', ('"' + $Runner + '"'), ('"' + $destination + '"'))
  $child = Start-Process -FilePath $BunExecutable -ArgumentList $arguments -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $null = $child.Handle
  try {
    $window = Wait-NativeDialog $child
    $rectangle = $window.Current.BoundingRectangle
    $image = New-Object Drawing.Bitmap([int]$rectangle.Width, [int]$rectangle.Height)
    $graphics = [Drawing.Graphics]::FromImage($image)
    try {
      $graphics.CopyFromScreen([int]$rectangle.X, [int]$rectangle.Y, 0, 0, $image.Size)
      $image.Save((Join-Path $artifacts "$mode.png"))
    } finally { $graphics.Dispose(); $image.Dispose() }

    if ($mode -eq 'save') {
      $edit = Find-Control $window '1001'
      $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $value.SetValue($destination)
      $button = Find-Control $window '1'
    } else { $button = Find-Control $window '2' }
    $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    if (!$child.WaitForExit(15000)) { throw 'Native dialog did not close' }
    $child.WaitForExit()
    if ($child.ExitCode -ne 0) { throw (Get-Content -LiteralPath $stderr -Raw) }
    $report = Get-Content -LiteralPath $stdout -Raw | ConvertFrom-Json
    if ($report.backend -ne 'ffi') { throw "Unexpected backend: $($report.backend)" }
    if ($mode -eq 'cancel' -and (!$report.result.canceled -or $report.result.filePath)) { throw 'Cancellation contract failed' }
    if ($mode -eq 'save' -and ($report.result.canceled -or $report.result.filePath -ne $destination)) { throw 'Save path contract failed' }
    if (Test-Path -LiteralPath $destination) { throw 'Dialog unexpectedly wrote the export file itself' }
    [Console]::WriteLine("$mode : ffi, native #32770, contract verified; library=$($report.library)")
  } finally {
    if (!$child.HasExited) { $child.Kill(); $child.WaitForExit() }
    $child.Dispose()
  }
}
[Console]::WriteLine("Artifacts: $artifacts")
