param([int]$TargetProcess, [int]$RivalProcess)
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class NativeStack {
 public delegate bool Callback(IntPtr hwnd, IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int left,top,right,bottom;}
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 public static object[] Read(int target,int rival){var result=new List<object>();int index=0;EnumWindows((h,p)=>{uint pid;GetWindowThreadProcessId(h,out pid);int z=index++;if((pid==target||pid==rival)&&IsWindowVisible(h)){Rect r;GetWindowRect(h,out r);result.Add(new {handle=h.ToInt64().ToString(),pid,z,x=r.left,y=r.top,width=r.right-r.left,height=r.bottom-r.top,focused=h==GetForegroundWindow()});}return true;},IntPtr.Zero);return result.ToArray();}
}
'@
[NativeStack]::SetProcessDPIAware() | Out-Null
[NativeStack]::Read($TargetProcess,$RivalProcess) | ConvertTo-Json -Compress
