# Oracle Server Diagnostic Script
# Run this in PowerShell to check server status

Write-Host "=== Oracle Server Diagnostics ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check if domain resolves
Write-Host "[1/5] Testing DNS resolution..." -ForegroundColor Yellow
try {
    $dns = Resolve-DnsName synergyacademy.duckdns.org -ErrorAction Stop
    Write-Host "✓ DNS resolves to: $($dns.IPAddress)" -ForegroundColor Green
} catch {
    Write-Host "✗ DNS resolution failed!" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host ""

# Test 2: Check if server responds to ping
Write-Host "[2/5] Testing server connectivity (ping)..." -ForegroundColor Yellow
$ping = Test-Connection -ComputerName synergyacademy.duckdns.org -Count 2 -Quiet
if ($ping) {
    Write-Host "✓ Server is reachable" -ForegroundColor Green
} else {
    Write-Host "✗ Server is not responding to ping" -ForegroundColor Red
}

Write-Host ""

# Test 3: Check if port 80 (HTTP) is open
Write-Host "[3/5] Testing HTTP port 80..." -ForegroundColor Yellow
try {
    $http = Test-NetConnection -ComputerName synergyacademy.duckdns.org -Port 80 -WarningAction SilentlyContinue
    if ($http.TcpTestSucceeded) {
        Write-Host "✓ Port 80 is open" -ForegroundColor Green
    } else {
        Write-Host "✗ Port 80 is closed or filtered" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Cannot test port 80" -ForegroundColor Red
}

Write-Host ""

# Test 4: Check if port 22 (SSH) is open
Write-Host "[4/5] Testing SSH port 22..." -ForegroundColor Yellow
try {
    $ssh = Test-NetConnection -ComputerName synergyacademy.duckdns.org -Port 22 -WarningAction SilentlyContinue
    if ($ssh.TcpTestSucceeded) {
        Write-Host "✓ Port 22 is open (SSH available)" -ForegroundColor Green
    } else {
        Write-Host "✗ Port 22 is closed (SSH not available)" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Cannot test port 22" -ForegroundColor Red
}

Write-Host ""

# Test 5: Try to fetch the website
Write-Host "[5/5] Testing HTTP response..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://synergyacademy.duckdns.org" -TimeoutSec 10 -ErrorAction Stop
    Write-Host "✓ Website responds with status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 502) {
        Write-Host "✗ Bad Gateway (502) - Server is running but app is down!" -ForegroundColor Red
    } elseif ($statusCode -eq 503) {
        Write-Host "✗ Service Unavailable (503) - Server overloaded or app crashed" -ForegroundColor Red
    } elseif ($statusCode -eq 504) {
        Write-Host "✗ Gateway Timeout (504) - App is too slow or hung" -ForegroundColor Red
    } else {
        Write-Host "✗ HTTP Error: $statusCode" -ForegroundColor Red
    }
    Write-Host "Error details: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Diagnosis Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. If SSH (port 22) is open, we can connect and fix the issue"
Write-Host "2. If you see 'Bad Gateway', the app crashed - we need to restart it"
Write-Host "3. If ports are closed, the server might be stopped in Oracle Cloud"
Write-Host ""
Write-Host "Ready to connect via SSH? (You'll need your SSH key or password)" -ForegroundColor Cyan
