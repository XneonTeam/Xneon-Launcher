import { dlopen, linkSymbols, ptr, read, type Pointer } from "bun:ffi"
import { execFile, spawnSync } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { queryGpuAdapters } from "./gpu"

const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
const exec = promisify(execFile)
const startup = ["-NoProfile", "-NonInteractive"]
export function getGpuAdapters() {
  return queryGpuAdapters(process.platform, async () => {
    const { stdout } = await exec(powershell, [...startup, "-Command",
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController -ErrorAction Stop | Select-Object Name,PNPDeviceID | ConvertTo-Json -Compress",
    ], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 })
    return stdout
  })
}
const dpapi = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Security; $bytes = [Convert]::FromBase64String([Console]::ReadLine()); $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser;"

function protect(value: Buffer, operation: "Protect" | "Unprotect") {
  if (process.platform !== "win32") throw new Error("OS secret storage is unavailable")
  const command = dpapi + " [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::" + operation + "($bytes, $null, $scope))"
  const result = spawnSync(powershell, [...startup, "-Command", command], {
    input: value.toString("base64") + "\n", encoding: "utf8", windowsHide: true, timeout: 15000,
  })
  if (result.status !== 0 || !result.stdout?.trim()) throw new Error("Windows DPAPI operation failed")
  return Buffer.from(result.stdout.trim(), "base64")
}

export const safeStorage = {
  isEncryptionAvailable: () => process.platform === "win32",
  encryptString: (value: string) => protect(Buffer.from(value), "Protect"),
  decryptString: (value: Buffer) => protect(value, "Unprotect").toString("utf8"),
  async encryptStringAsync(value: string) { return this.encryptString(value) },
  async decryptStringAsync(value: Buffer) { return { result: this.decryptString(value) } },
}

export function setWindowsAppUserModelId(id: string): void {
  if (process.platform !== "win32") return
  const shell = dlopen("shell32.dll", {
    SetCurrentProcessExplicitAppUserModelID: { args: ["ptr"], returns: "i32" },
  })
  try {
    const wideId = Buffer.from(id + "\0", "utf16le")
    const result = shell.symbols.SetCurrentProcessExplicitAppUserModelID(ptr(wideId))
    if (result < 0) console.warn("[Desktop] Could not set the Windows AppUserModelID:", result)
  } finally {
    shell.close()
  }
}

const launcherIconPath = path.join(path.dirname(process.execPath), "..", "Resources", "app.ico")

export function enableWindowsWindowTransitions(window: Pointer): void {
  const GWL_STYLE = -16
  const WS_MINIMIZEBOX = 0x00020000
  const WS_MAXIMIZEBOX = 0x00010000
  const WS_SYSMENU = 0x00080000
  const SWP_FRAMECHANGED = 0x0020
  const SWP_KEEP_PLACEMENT = 0x0017 // NOSIZE | NOMOVE | NOZORDER | NOACTIVATE
  const user = dlopen("user32.dll", {
    GetWindowLongW: { args: ["ptr", "i32"], returns: "i32" },
    SetWindowLongW: { args: ["ptr", "i32", "i32"], returns: "i32" },
    SetWindowPos: { args: ["ptr", "ptr", "i32", "i32", "i32", "i32", "u32"], returns: "i32" },
  })
  try {
    const style = user.symbols.GetWindowLongW(window, GWL_STYLE)
    // Electrobun hiddenInset скрывает заголовок, но не выставляет эти флаги Win32.
    const newStyle = style | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU
    if (style === newStyle) return
    user.symbols.SetWindowLongW(window, GWL_STYLE, newStyle)
    if (user.symbols.GetWindowLongW(window, GWL_STYLE) !== newStyle ||
        !user.symbols.SetWindowPos(window, null, 0, 0, 0, 0, SWP_KEEP_PLACEMENT | SWP_FRAMECHANGED)) {
      throw new Error("Could not apply Windows window transition styles")
    }
  } finally {
    user.close()
  }
}

export function setWindowsWindowIcons(window: Pointer): () => void {
  const WM_SETICON = 0x0080
  const ICON_SMALL = 0
  const ICON_BIG = 1
  const shell = dlopen("shell32.dll", {
    ExtractIconExW: { args: ["ptr", "i32", "ptr", "ptr", "u32"], returns: "u32" },
  })
  const small = new BigUint64Array(1)
  const large = new BigUint64Array(1)
  try {
    const file = Buffer.from(launcherIconPath + "\0", "utf16le")
    shell.symbols.ExtractIconExW(ptr(file), 0, large, small, 1)
  } finally {
    shell.close()
  }
  if (!small[0] && !large[0]) throw new Error("Could not load " + launcherIconPath)

  const user = dlopen("user32.dll", {
    SendMessageW: { args: ["ptr", "u32", "u64", "ptr"], returns: "ptr" },
    DestroyIcon: { args: ["ptr"], returns: "i32" },
  })
  if (small[0]) user.symbols.SendMessageW(window, WM_SETICON, ICON_SMALL, small[0])
  if (large[0]) user.symbols.SendMessageW(window, WM_SETICON, ICON_BIG, large[0])
  return () => {
    if (small[0]) user.symbols.DestroyIcon(small[0])
    if (large[0] && large[0] !== small[0]) user.symbols.DestroyIcon(large[0])
    user.close()
  }
}

export function setWindowsTaskbarIdentity(window: Pointer, id: string, name: string): () => void {
  const bin = path.dirname(process.execPath)
  const properties = [
    [2, `"${path.join(bin, "launcher.exe")}"`],
    [3, launcherIconPath + ",0"],
    [4, name],
    [5, id],
  ] as const

  function update(clear: boolean): void {
    const shell = dlopen("shell32.dll", {
      SHGetPropertyStoreForWindow: { args: ["ptr", "ptr", "ptr"], returns: "i32" },
    })
    try {
      // IID_IPropertyStore: 886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99.
      const iid = Buffer.from("eb8e6d88f28c46448d02cdba1dbdcf99", "hex")
      const output = Buffer.alloc(8)
      const result = shell.symbols.SHGetPropertyStoreForWindow(window, ptr(iid), ptr(output))
      if (result < 0) throw new Error("SHGetPropertyStoreForWindow: " + result)

      const store = read.ptr(ptr(output)) as Pointer
      const vtable = read.ptr(store)
      const propertyStore = linkSymbols({
        release: { ptr: BigInt(read.ptr(vtable, 2 * 8)), args: ["ptr"], returns: "u32" },
        setValue: { ptr: BigInt(read.ptr(vtable, 6 * 8)), args: ["ptr", "ptr", "ptr"], returns: "i32" },
      })
      try {
        // PROPERTYKEY содержит GUID и номер свойства. Строка PROPVARIANT передаётся как VT_LPWSTR.
        const key = Buffer.from("55284c9f799f394ba8d0e1d42de1d5f300000000", "hex")
        const value = Buffer.alloc(24)
        for (const [propertyId, propertyValue] of properties) {
          key.writeUInt32LE(propertyId, 16)
          const wide = Buffer.from(propertyValue + "\0", "utf16le")
          if (!clear) {
            value.writeUInt16LE(31)
            value.writeBigUInt64LE(BigInt(ptr(wide)), 8)
          }
          const status = propertyStore.symbols.setValue(store, ptr(key), ptr(value))
          if (status < 0) throw new Error("IPropertyStore::SetValue: " + status)
        }
      } finally {
        propertyStore.symbols.release(store)
        propertyStore.close()
      }
    } finally {
      shell.close()
    }
  }

  update(false)
  return () => update(true)
}

export async function readWindowsLauncherArgs(): Promise<string[]> {
  if (process.platform !== "win32") return []
  // Worker Electrobun может получить собственный argv вместо argv процесса.
  const kernel = dlopen("kernel32.dll", { GetCommandLineW: { args: [], returns: "ptr" } })
  try {
    const current = splitWindowsCommandLine(kernel.symbols.GetCommandLineW())
    if (current.includes("--launch")) return current
  } finally {
    kernel.close()
  }
  if (!process.ppid) return []
  const launcher = path.join(path.dirname(process.execPath), "launcher.exe")
  const command = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    `$parent = Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.ppid}'`,
    "if ($parent.ExecutablePath -ieq $env:XN_EXPECTED_LAUNCHER) { [Console]::Write($parent.CommandLine) }",
  ].join("; ")
  const { stdout } = await exec(powershell, [...startup, "-Command", command], {
    windowsHide: true,
    timeout: 5000,
    env: { ...process.env, XN_EXPECTED_LAUNCHER: launcher },
  })
  if (!stdout.includes("--launch")) return []
  const line = Buffer.from(stdout + "\0", "utf16le")
  return splitWindowsCommandLine(ptr(line))
}

function splitWindowsCommandLine(line: Pointer | bigint | null): string[] {
  if (!line) return []
  const shell = dlopen("shell32.dll", { CommandLineToArgvW: { args: ["ptr", "ptr"], returns: "ptr" } })
  try {
    const kernel = dlopen("kernel32.dll", { LocalFree: { args: ["ptr"], returns: "ptr" } })
    try {
      const count = new Int32Array(1)
      const argv = shell.symbols.CommandLineToArgvW(line, ptr(count))
      if (!argv) throw new Error("Could not read Windows launcher arguments")
      try {
        const args: string[] = []
        for (let i = 1; i < count[0]; i++) {
          const address = read.ptr(argv, i * 8)
          const units: number[] = []
          for (let offset = 0, unit = read.u16(address); unit; unit = read.u16(address, offset += 2)) {
            units.push(unit)
          }
          args.push(Buffer.from(new Uint16Array(units).buffer).toString("utf16le"))
        }
        return args
      } finally {
        kernel.symbols.LocalFree(argv)
      }
    } finally {
      kernel.close()
    }
  } finally {
    shell.close()
  }
}

type Filter = { name: string; extensions: string[] }
export async function saveFile(defaultPath?: string, filters?: Filter[]) {
  if (process.platform !== "win32") throw new Error("Save dialog is available on Windows")
  const command = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object Windows.Forms.SaveFileDialog",
    "$dialog.FileName = $env:XN_DIALOG_FILENAME",
    "if ($env:XN_DIALOG_DIRECTORY) { $dialog.InitialDirectory = $env:XN_DIALOG_DIRECTORY }",
    "if ($env:XN_DIALOG_FILTER) { $dialog.Filter = $env:XN_DIALOG_FILTER }",
    "try { if ($dialog.ShowDialog() -eq 'OK') { [Console]::Write($dialog.FileName) } } finally { $dialog.Dispose() }",
  ].join("; ")
  const { stdout } = await exec(powershell, [...startup, "-STA", "-Command", command], {
    windowsHide: true,
    env: {
      ...process.env,
      XN_DIALOG_FILENAME: defaultPath && path.basename(defaultPath),
      XN_DIALOG_DIRECTORY: defaultPath && path.isAbsolute(defaultPath) ? path.dirname(defaultPath) : undefined,
      XN_DIALOG_FILTER: filters?.map(filter => filter.name + "|" + filter.extensions.map(ext => "*." + ext).join(";")).join("|"),
    },
  })
  return { canceled: !stdout, filePath: stdout || undefined }
}
