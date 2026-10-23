$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Devices.Geolocation.Geolocator, Windows.Devices.Geolocation, ContentType = WindowsRuntime]
$null = [Windows.Devices.Geolocation.Geoposition, Windows.Devices.Geolocation, ContentType = WindowsRuntime]
$null = [Windows.Devices.Geolocation.GeolocationAccessStatus, Windows.Devices.Geolocation, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-WinRT($Operation, $ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(18000)) { throw 'Location request timed out' }
    return $task.Result
}
$access = Wait-WinRT ([Windows.Devices.Geolocation.Geolocator]::RequestAccessAsync()) ([Windows.Devices.Geolocation.GeolocationAccessStatus])
if ($access -ne [Windows.Devices.Geolocation.GeolocationAccessStatus]::Allowed) { throw 'Location access is disabled' }
$locator = New-Object Windows.Devices.Geolocation.Geolocator
$locator.DesiredAccuracy = [Windows.Devices.Geolocation.PositionAccuracy]::Default
$position = Wait-WinRT ($locator.GetGeopositionAsync([TimeSpan]::FromMinutes(5), [TimeSpan]::FromSeconds(15))) ([Windows.Devices.Geolocation.Geoposition])
$point = $position.Coordinate.Point.Position
@{ latitude = $point.Latitude; longitude = $point.Longitude } | ConvertTo-Json -Compress
