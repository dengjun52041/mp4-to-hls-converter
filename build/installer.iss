#define MyAppName "涛涛转码箱"
#define MyAppVersion "1.0"
#define MyAppPublisher "涛涛碎碎念RE"
#define MyAppURL "https://space.bilibili.com/3546981288905273"
#define MyAppExeName "涛涛转码箱.exe"
#define SrcDir "E:\HLS\dist\涛涛转码箱"

[Setup]
AppId={{9C7E4A21-6B3D-4F8A-A5C2-3D1E9B7F6A40}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\涛涛转码箱
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=E:\HLS\dist
OutputBaseFilename=涛涛转码箱-安装版-v1.0
SetupIconFile=E:\HLS\assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Languages]
Name: "chinesesimplified"; MessagesFile: "E:\HLS\build\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加选项:"; Flags: checkedonce

[Files]
Source: "{#SrcDir}\涛涛转码箱.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SrcDir}\说明.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SrcDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SrcDir}\ffmpeg\*"; DestDir: "{app}\ffmpeg"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SrcDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
