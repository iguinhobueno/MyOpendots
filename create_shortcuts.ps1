
$WshShell = New-Object -ComObject WScript.Shell

# Desktop Shortcut
$ShortcutPath = "C:\Users\Igor\Desktop\OpenDots.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = '"C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots\OpenDots-App.vbs"'
$Shortcut.WorkingDirectory = "C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots"
$Shortcut.IconLocation = "C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots\opendots.ico,0"
$Shortcut.Description = "OpenDots - Assistente Pessoal & Copiloto IA do Igor"
$Shortcut.Save()

# Start Menu Shortcut
$StartShortcutPath = "C:\Users\Igor\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\OpenDots.lnk"
$StartShortcut = $WshShell.CreateShortcut($StartShortcutPath)
$StartShortcut.TargetPath = "wscript.exe"
$StartShortcut.Arguments = '"C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots\OpenDots-App.vbs"'
$StartShortcut.WorkingDirectory = "C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots"
$StartShortcut.IconLocation = "C:\Users\Igor\.gemini\antigravity-ide\scratch\OpenDots\opendots.ico,0"
$StartShortcut.Description = "OpenDots - Assistente Pessoal & Copiloto IA do Igor"
$StartShortcut.Save()

Write-Output "Shortcuts created on Desktop and Start Menu!"
