Write-Host "=== REAL BSON SIZE CALCULATION ==="
Write-Host ""

# Real BSON bytes from deployment (full 40q test = ~8000 B)
$c = @{centers=79; users=230; groups=113; tests=8000; assignments=133; results=412}

function Calc($label, $centers, $students, $teachers, $admins, $groups, $tests, $assignments, $results) {
    $users = 1 + $students + $teachers + $admins
    $dataB = ($centers*$c.centers) + ($users*$c.users) + ($groups*$c.groups) + ($tests*$c.tests) + ($assignments*$c.assignments) + ($results*$c.results)
    $totalB = $dataB * 1.5
    $totalMB = $totalB / 1048576
    $pct = $totalMB / 512 * 100
    Write-Host "$label"
    Write-Host "  Users=$users  Tests=$tests  Submissions=$results"
    Write-Host "  Data: $([math]::Round($dataB/1048576,1)) MB + 50% indexes = Total: $([math]::Round($totalMB,1)) MB ($([math]::Round($pct,0))% of 512 MB)"
    if ($totalMB -gt 512) { Write-Host "  !!! EXCEEDS 512 MB !!!" }
    Write-Host ""
}

Calc "SMALL:  5 centers, 200 students/center"  5  1000   25  5   25   50    50     5000
Calc "MEDIUM: 20 centers, 500 students/center" 20 10000  100 20  100  200   400    100000
Calc "LARGE:  100 centers, 1000 students/center" 100 100000 500 100 1000 500 2000 1000000
Calc "MAX FIT: 80 centers, 1000 each (~80K students)" 80 80000 400 80 800 400 1600 800000
Calc "MAX FIT 2: 50 centers, 2000 each (~100K students)" 50 100000 250 50 500 400 2000 1000000
