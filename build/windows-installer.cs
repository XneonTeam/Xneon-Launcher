using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Setup
{
    private const string ProductName = "Xneon Launcher";
    private const string InstallerName = "Xneon Launcher-Setup.exe";

    [STAThread]
    private static int Main()
    {
        string directory = Path.Combine(Path.GetTempPath(), "XneonSetup-" + Guid.NewGuid().ToString("N"));
        try
        {
            if (HasPreviousInstallation())
            {
                MessageBox.Show(
                    "Обнаружена прежняя установка Xneon Launcher. Удалите её через «Установленные приложения», затем запустите этот установщик снова.",
                    ProductName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 1;
            }

            Directory.CreateDirectory(directory);
            Directory.CreateDirectory(Path.Combine(directory, ".installer"));
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("InstallerPayload"))
            using (var archive = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                Extract(archive, directory, InstallerName);
                Extract(archive, directory, ".installer/Xneon Launcher-Setup.metadata.json");
                Extract(archive, directory, ".installer/Xneon Launcher-Setup.tar.zst");
            }

            var start = new ProcessStartInfo(Path.Combine(directory, InstallerName))
            {
                WorkingDirectory = directory,
                UseShellExecute = true
            };
            using (Process installer = Process.Start(start))
            {
                installer.WaitForExit();
                return installer.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show("Не удалось запустить установщик Xneon Launcher.\n\n" + error.Message,
                ProductName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static bool HasPreviousInstallation()
    {
        string localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string previousRoot = Path.Combine(localData, "org.xneon.launcher.bun");
        if (Directory.Exists(previousRoot))
        {
            foreach (string channel in Directory.EnumerateDirectories(previousRoot))
            {
                if (File.Exists(Path.Combine(channel, ".electrobun-uninstall.json")) ||
                    File.Exists(Path.Combine(channel, "app", "bin", "launcher.exe")))
                    return true;
            }
        }

        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (RegistryView view in new[] { RegistryView.Registry32, RegistryView.Registry64 })
        {
            using (RegistryKey root = RegistryKey.OpenBaseKey(hive, view))
            using (RegistryKey uninstall = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
            {
                if (uninstall == null) continue;
                foreach (string name in uninstall.GetSubKeyNames())
                {
                    using (RegistryKey entry = uninstall.OpenSubKey(name))
                    {
                        if (entry == null || !ProductName.Equals(entry.GetValue("DisplayName") as string)) continue;
                        string command = entry.GetValue("UninstallString") as string;
                        if (IsPreviousNsisUninstaller(command)) return true;
                    }
                }
            }
        }
        return false;
    }

    private static bool IsPreviousNsisUninstaller(string command)
    {
        if (String.IsNullOrWhiteSpace(command)) return false;
        const string uninstaller = "Uninstall Xneon Launcher.exe";
        string path = command.TrimStart();
        if (path[0] == '"')
        {
            int closingQuote = path.IndexOf('"', 1);
            if (closingQuote < 0) return false;
            path = path.Substring(1, closingQuote - 1);
        }
        else
        {
            int index = path.IndexOf(uninstaller, StringComparison.OrdinalIgnoreCase);
            if (index < 0) return false;
            int end = index + uninstaller.Length;
            if (end < path.Length && !Char.IsWhiteSpace(path[end])) return false;
            path = path.Substring(0, end);
        }
        return Path.IsPathRooted(path) && uninstaller.Equals(Path.GetFileName(path), StringComparison.OrdinalIgnoreCase) &&
            File.Exists(path);
    }

    private static void Extract(ZipArchive archive, string directory, string name)
    {
        ZipArchiveEntry entry = archive.GetEntry(name);
        if (entry == null) throw new InvalidDataException("Missing installer file: " + name);
        using (Stream input = entry.Open())
        using (var output = new FileStream(Path.Combine(directory, name), FileMode.CreateNew, FileAccess.Write))
            input.CopyTo(output);
    }
}
