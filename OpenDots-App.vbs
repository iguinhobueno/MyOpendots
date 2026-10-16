Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")

' 1. Checar se o servidor na porta 4310 ja esta respondendo
On Error Resume Next
http.open "GET", "http://127.0.0.1:4310/api/state", False
http.setTimeouts 1000, 1000, 1000, 1000
http.send

If Err.Number <> 0 Then
    ' Servidor offline: inicializar silenciosamente em segundo plano
    Err.Clear
    WshShell.CurrentDirectory = "C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots"
    WshShell.Run "node --env-file-if-exists=.env dist/server/server/index.js", 0, False
    WScript.Sleep 1800
End If
On Error GoTo 0

' 2. Priorizar Brave Browser (navegador ativo do Igor) no modo Janela de Aplicativo (--app)
bravePath = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

If fso.FileExists(bravePath) Then
    browserCmd = """" & bravePath & """ --app=http://127.0.0.1:4310"
ElseIf fso.FileExists(chromePath) Then
    browserCmd = """" & chromePath & """ --app=http://127.0.0.1:4310"
Else
    browserCmd = "cmd /c start http://127.0.0.1:4310"
End If

WshShell.Run browserCmd, 1, False
