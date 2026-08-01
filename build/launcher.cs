using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

static class Launcher
{
    static Process _child;

    static void Main()
    {
        try { Console.OutputEncoding = System.Text.Encoding.UTF8; } catch { }
        Console.Title = "涛涛转码箱";
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(baseDir, "runtime", "node.exe");
        string ffDir = Path.Combine(baseDir, "ffmpeg");
        string appDir = Path.Combine(baseDir, "app");
        string serverJs = Path.Combine(appDir, "server.js");

        Console.WriteLine("========================================");
        Console.WriteLine("       涛涛转码箱 · 视频转 HLS 工具");
        Console.WriteLine("========================================");

        if (!File.Exists(node)) { Fail("找不到 runtime\\node.exe，压缩包可能不完整。"); return; }
        if (!File.Exists(serverJs)) { Fail("找不到 app\\server.js，压缩包可能不完整。"); return; }

        var psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = "\"" + serverJs + "\"";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.EnvironmentVariables["FFMPEG_PATH"] = Path.Combine(ffDir, "ffmpeg.exe");
        psi.EnvironmentVariables["FFPROBE_PATH"] = Path.Combine(ffDir, "ffprobe.exe");
        psi.EnvironmentVariables["PATH"] = Path.Combine(baseDir, "runtime") + ";" + ffDir + ";" + Environment.GetEnvironmentVariable("PATH");

        try { _child = Process.Start(psi); }
        catch (Exception ex) { Fail("启动失败：" + ex.Message); return; }

        AppDomain.CurrentDomain.ProcessExit += (s, e) => KillChild();

        Console.WriteLine("服务启动中，稍等将自动打开浏览器...");
        Console.WriteLine("访问地址：http://localhost:3000");
        Console.WriteLine("提示：关闭本窗口即可停止服务。");
        Console.WriteLine("----------------------------------------");

        Thread.Sleep(2500);
        try { Process.Start(new ProcessStartInfo("http://localhost:3000") { UseShellExecute = true }); }
        catch { Console.WriteLine("（未能自动打开浏览器，请手动访问 http://localhost:3000）"); }

        _child.WaitForExit();
        Console.WriteLine("服务已停止。");
    }

    static void KillChild()
    {
        try { if (_child != null && !_child.HasExited) _child.Kill(); } catch { }
    }

    static void Fail(string msg)
    {
        Console.WriteLine("错误：" + msg);
        Console.WriteLine("按任意键退出...");
        try { Console.ReadKey(); } catch { }
    }
}
