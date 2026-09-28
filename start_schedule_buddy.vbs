' Launch Schedule Buddy with pythonw (no console window).
' NOTE: the window style argument MUST be 1 (normal). Using 0 (hidden) makes
' Windows propagate a "hidden, not activated" startup state to the pywebview
' main window, so it only appears in the taskbar and never shows on screen.
Set sh = CreateObject("WScript.Shell")
' GetParentFolderName is a pure string operation - safe on Unicode paths.
base = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base
' Prefer the bundled portable runtime (works without Python installed);
' fall back to whatever pythonw is on PATH.
' NOTE: do NOT probe existence with Scripting.FileSystemObject.FileExists -
' FSO reports False for some valid Unicode (e.g. Chinese) folder names,
' while CreateProcess handles them fine. Try-and-fallback instead.
On Error Resume Next
sh.Run """" & base & "\runtime\pythonw.exe"" app.py", 1, False
If Err.Number <> 0 Then
    Err.Clear
    sh.Run "pythonw.exe app.py", 1, False
End If
On Error GoTo 0
