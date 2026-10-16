Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots"
WshShell.Run "node --env-file-if-exists=.env dist/server/server/index.js", 0, False
