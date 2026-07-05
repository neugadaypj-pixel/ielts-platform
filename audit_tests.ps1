# IELTS Platform - Full Black-Box API Audit v2
# Corrected schemas based on actual API models
$ErrorActionPreference = "Continue"
$Base = "https://ielts-platform.fly.dev"
$Pass = 0; $Fail = 0; $Warn = 0

function Report($num, $desc, $result, $details = "") {
    if ($result -eq "PASS") { $script:Pass++ } 
    elseif ($result -eq "FAIL") { $script:Fail++ } 
    else { $script:Warn++ }
    $line = "[$result] #$num $desc"
    if ($details) { $line += " | $details" }
    $color = if($result -eq "PASS"){'Green'}elseif($result -eq "FAIL"){'Red'}else{'Yellow'}
    Write-Host $line -ForegroundColor $color
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " IELTS PLATFORM - API AUDIT v2" -ForegroundColor Cyan  
Write-Host " Base: $Base  |  $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ============================================================================
# SECTION 1: HEALTH CHECK
# ============================================================================
Write-Host "--- 1. HEALTH ---" -ForegroundColor Magenta

try {
    $r = Invoke-RestMethod -Uri "$Base/health" -Method Get -TimeoutSec 10
    if ($r.status -eq "ok") { Report 1 "GET /health" "PASS" "status=ok, app=$($r.app)" }
    else { Report 1 "GET /health" "FAIL" ("Unexpected: " + ($r | ConvertTo-Json -Compress)) }
} catch { Report 1 "GET /health" "FAIL" $_.Exception.Message }

# ============================================================================
# SECTION 2: AUTH
# ============================================================================
Write-Host "`n--- 2. AUTH ---" -ForegroundColor Magenta

# SuperAdmin login
try {
    $body = '{"username":"Jamal","password":"Sbros0803"}'
    $r = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    $SA_TOKEN = $r.access_token
    Report 2 "POST /auth/login (SuperAdmin)" "PASS" ("role=" + $r.role)
    $SA_HEADERS = @{Authorization="Bearer $SA_TOKEN"}
} catch { Report 2 "POST /auth/login (SuperAdmin)" "FAIL" $_.Exception.Message }

# GET /auth/me
try {
    $r = Invoke-RestMethod -Uri "$Base/auth/me" -Method Get -Headers $SA_HEADERS -TimeoutSec 10
    Report 3 "GET /auth/me" "PASS" ("username=" + $r.username + ", role=" + $r.role)
} catch { Report 3 "GET /auth/me" "FAIL" $_.Exception.Message }

# Bad credentials
try {
    $r = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body '{"username":"Fake","password":"Wrong"}' -ContentType "application/json" -TimeoutSec 10
    Report 4 "Login bad creds -> 401" "FAIL" "Should return 401"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 401) { Report 4 "Login bad creds -> 401" "PASS" }
    else { Report 4 "Login bad creds" "FAIL" ("Got " + $c) }
}

# No token
try {
    $r = Invoke-RestMethod -Uri "$Base/auth/me" -Method Get -TimeoutSec 10
    Report 5 "GET /auth/me (no token)" "FAIL" "Should return 403"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 403) { Report 5 "GET /auth/me (no token) -> 403" "PASS" }
    else { Report 5 "GET /auth/me (no token)" "FAIL" ("Got " + $c) }
}

# ============================================================================
# SECTION 3: SUPERADMIN
# ============================================================================
Write-Host "`n--- 3. SUPERADMIN ---" -ForegroundColor Magenta

# List centers
try {
    $r = Invoke-RestMethod -Uri "$Base/superadmin/centers" -Method Get -Headers $SA_HEADERS -TimeoutSec 10
    Report 6 "GET /superadmin/centers" "PASS" ("Found " + $r.Count + " center(s)")
} catch { Report 6 "GET /superadmin/centers" "FAIL" $_.Exception.Message }

# Create center (with admin)
$NEW_CENTER_ID = $null
$ADMIN_USERNAME = $null
$rand = Get-Random -Min 1000 -Max 9999
try {
    $body = "{""name"":""AuditCenter$rand"",""admin_username"":""admin_audit$rand"",""admin_password"":""Admin123!"",""admin_full_name"":""AuditAdmin$rand""}"
    $r = Invoke-RestMethod -Uri "$Base/superadmin/centers" -Method Post -Body $body -ContentType "application/json" -Headers $SA_HEADERS -TimeoutSec 10
    $NEW_CENTER_ID = $r._id
    $ADMIN_USERNAME = "admin_audit$rand"
    Report 7 "POST /superadmin/centers" "PASS" ("Center=" + $r.name + ", admin_id=" + $r.admin_id)
} catch {
    $c = 0; try { $c = $_.Exception.Response.StatusCode.value__ } catch {}
    Report 7 "POST /superadmin/centers" "FAIL" ("Status=" + $c + " " + $_.Exception.Message)
}

# Duplicate center name
try {
    $body = "{""name"":""Test Academy"",""admin_username"":""dup_foo999"",""admin_password"":""Test123!"",""admin_full_name"":""Dup Admin""}"
    $r = Invoke-RestMethod -Uri "$Base/superadmin/centers" -Method Post -Body $body -ContentType "application/json" -Headers $SA_HEADERS -TimeoutSec 10
    Report 8 "POST /superadmin/centers (dup) -> 409" "FAIL" "Should return 409"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 409) { Report 8 "POST /superadmin/centers (dup) -> 409" "PASS" }
    else { Report 8 "POST /superadmin/centers (dup)" "FAIL" ("Got " + $c) }
}

# Analytics stats
try {
    $r = Invoke-RestMethod -Uri "$Base/analytics/stats/center" -Method Get -Headers $SA_HEADERS -TimeoutSec 10
    Report 9 "GET /analytics/stats/center" "PASS" ("students=" + $r.students + ", teachers=" + $r.teachers + ", tests=" + $r.tests)
} catch { Report 9 "GET /analytics/stats/center" "FAIL" $_.Exception.Message }

# ============================================================================
# SECTION 4: ADMIN ENDPOINTS
# ============================================================================
Write-Host "`n--- 4. ADMIN ---" -ForegroundColor Magenta

# Login as admin
$ADMIN_TOKEN = $null
try {
    $body = "{""username"":""$ADMIN_USERNAME"",""password"":""Admin123!""}"
    $r = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    $ADMIN_TOKEN = $r.access_token
    Report 10 "Login as Admin" "PASS" ("role=" + $r.role)
    $AH = @{Authorization="Bearer $ADMIN_TOKEN"}
} catch { Report 10 "Login as Admin" "FAIL" $_.Exception.Message }

# GET /auth/me as admin
try {
    $r = Invoke-RestMethod -Uri "$Base/auth/me" -Method Get -Headers $AH -TimeoutSec 10
    $ADMIN_CENTER_ID = $r.center_id
    Report 11 "GET /auth/me (Admin)" "PASS" ("role=" + $r.role + ", center_id=" + $ADMIN_CENTER_ID)
} catch { Report 11 "GET /auth/me (Admin)" "FAIL" $_.Exception.Message }

# *** BUG FIX TEST: Create group WITHOUT center_id ***
$GROUP_ID = $null
try {
    $gn = "AuditGroup$(Get-Random -Min 100 -Max 999)"
    $body = "{""name"":""$gn""}"
    $r = Invoke-RestMethod -Uri "$Base/admin/groups" -Method Post -Body $body -ContentType "application/json" -Headers $AH -TimeoutSec 10
    $GROUP_ID = $r._id
    Report 12 "POST /admin/groups (NO center_id)" "PASS" ("Created '" + $gn + "', id=" + $GROUP_ID)
} catch {
    $c = 0; try { $c = $_.Exception.Response.StatusCode.value__ } catch {}
    if ($c -eq 422) { Report 12 "POST /admin/groups (NO center_id)" "FAIL" "BUG: center_id still required (422)" }
    else { Report 12 "POST /admin/groups (NO center_id)" "FAIL" ("Status=" + $c + " " + $_.Exception.Message) }
}

# List groups
try {
    $r = Invoke-RestMethod -Uri "$Base/admin/groups" -Method Get -Headers $AH -TimeoutSec 10
    Report 13 "GET /admin/groups" "PASS" ("Found " + $r.Count + " group(s)")
} catch { Report 13 "GET /admin/groups" "FAIL" $_.Exception.Message }

# Create teacher
$TEACHER_USERNAME = $null
try {
    $tu = "tchr_audit$(Get-Random -Min 100 -Max 999)"
    $body = "{""username"":""$tu"",""password"":""Teach123!"",""full_name"":""AuditTeacher""}"
    $r = Invoke-RestMethod -Uri "$Base/admin/teachers" -Method Post -Body $body -ContentType "application/json" -Headers $AH -TimeoutSec 10
    $TEACHER_USERNAME = $tu
    $TEACHER_ID = $r._id
    Report 14 "POST /admin/teachers" "PASS" ("Created '${tu}', id=" + $r._id)
} catch { Report 14 "POST /admin/teachers" "FAIL" $_.Exception.Message }

# List teachers
try {
    $r = Invoke-RestMethod -Uri "$Base/admin/teachers" -Method Get -Headers $AH -TimeoutSec 10
    Report 15 "GET /admin/teachers" "PASS" ("Found " + $r.Count + " teacher(s)")
} catch { Report 15 "GET /admin/teachers" "FAIL" $_.Exception.Message }

# RBAC: Admin -> SuperAdmin endpoint
try {
    $r = Invoke-RestMethod -Uri "$Base/superadmin/centers" -Method Get -Headers $AH -TimeoutSec 10
    Report 16 "Admin -> /superadmin -> 403" "FAIL" "Should be forbidden"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 403) { Report 16 "Admin -> /superadmin -> 403" "PASS" }
    else { Report 16 "Admin -> /superadmin" "FAIL" ("Got " + $c) }
}

# ============================================================================
# SECTION 5: TEACHER
# ============================================================================
Write-Host "`n--- 5. TEACHER ---" -ForegroundColor Magenta

# Login as teacher
$TEACHER_TOKEN = $null
try {
    $body = "{""username"":""$TEACHER_USERNAME"",""password"":""Teach123!""}"
    $r = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    $TEACHER_TOKEN = $r.access_token
    Report 17 "Login as Teacher" "PASS" "token acquired"
    $TH = @{Authorization="Bearer $TEACHER_TOKEN"}
} catch { Report 17 "Login as Teacher" "FAIL" $_.Exception.Message }

# List students (empty)
try {
    $r = Invoke-RestMethod -Uri "$Base/teacher/students" -Method Get -Headers $TH -TimeoutSec 10
    Report 18 "GET /teacher/students" "PASS" ("Found " + $r.Count + " student(s)")
} catch { Report 18 "GET /teacher/students" "FAIL" $_.Exception.Message }

# Create student
$STUDENT_USERNAME = $null
$STUDENT_ID = $null
try {
    $su = "stu_audit$(Get-Random -Min 100 -Max 999)"
    $body = "{""username"":""$su"",""password"":""Study123!"",""full_name"":""AuditStudent"",""group_id"":""$GROUP_ID""}"
    $r = Invoke-RestMethod -Uri "$Base/teacher/students" -Method Post -Body $body -ContentType "application/json" -Headers $TH -TimeoutSec 10
    $STUDENT_USERNAME = $su
    $STUDENT_ID = $r._id
    Report 19 "POST /teacher/students" "PASS" ("Created '${su}', id=" + $STUDENT_ID)
} catch {
    $err = $_.Exception.Message
    try { $eb = $_.ErrorDetails.Message } catch { $eb = "" }
    Report 19 "POST /teacher/students" "FAIL" ("err=" + $err + " body=" + $eb)
}

# Assign teacher to group
try {
    $r = Invoke-RestMethod -Uri "$Base/teacher/groups/$GROUP_ID/assign" -Method Put -Headers $TH -TimeoutSec 10
    Report 20 "PUT /teacher/groups/{id}/assign" "PASS" ("Assigned to group " + $GROUP_ID)
} catch { Report 20 "PUT /teacher/groups/{id}/assign" "FAIL" $_.Exception.Message }

# List students after create
try {
    $r = Invoke-RestMethod -Uri "$Base/teacher/students" -Method Get -Headers $TH -TimeoutSec 10
    Report 21 "GET /teacher/students (after)" "PASS" ("Found " + $r.Count + " student(s)")
} catch { Report 21 "GET /teacher/students (after)" "FAIL" $_.Exception.Message }

# ============================================================================
# SECTION 6: STUDENT
# ============================================================================
Write-Host "`n--- 6. STUDENT ---" -ForegroundColor Magenta

# Login as student
$STUDENT_TOKEN = $null
try {
    $body = "{""username"":""$STUDENT_USERNAME"",""password"":""Study123!""}"
    $r = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    $STUDENT_TOKEN = $r.access_token
    Report 22 "Login as Student" "PASS" "token acquired"
    $SH = @{Authorization="Bearer $STUDENT_TOKEN"}
} catch { Report 22 "Login as Student" "FAIL" $_.Exception.Message }

# Assigned tests (empty)
try {
    $r = Invoke-RestMethod -Uri "$Base/student/tests/assigned" -Method Get -Headers $SH -TimeoutSec 10
    Report 23 "GET /student/tests/assigned (0)" "PASS" ("Found " + $r.Count + " test(s)")
} catch { Report 23 "GET /student/tests/assigned" "FAIL" $_.Exception.Message }

# Results (empty)
try {
    $r = Invoke-RestMethod -Uri "$Base/student/results" -Method Get -Headers $SH -TimeoutSec 10
    Report 24 "GET /student/results (0)" "PASS" ("Found " + $r.Count + " result(s)")
} catch { Report 24 "GET /student/results" "FAIL" $_.Exception.Message }

# ============================================================================
# SECTION 7: E2E (Create Test -> Assign -> Submit -> Score)
# ============================================================================
Write-Host "`n--- 7. E2E FLOW ---" -ForegroundColor Magenta

# 7.1 Create test
$E2E_TEST_ID = $null
$randNum = Get-Random -Min 10 -Max 99
try {
    $contentJson = @{
        sections = @(@{
            section_type = "Listening"
            title = "Section 1"
            instructions = "Answer all questions"
            audio_url = ""
        })
        questions = @(
            @{id="q1";question_number=1;type="multiple_choice";text="Capital of France?";options=@("London","Paris","Berlin","Madrid");correct_answer="Paris";points=1},
            @{id="q2";question_number=2;type="multiple_choice";text="What is 2+2?";options=@("3","4","5","6");correct_answer="4";points=1}
        )
        total_points = 2
        time_limit_minutes = 30
    }
    $body = @{
        title = "E2E Test $randNum"
        content_json = $contentJson
    } | ConvertTo-Json -Depth 8
    $r = Invoke-RestMethod -Uri "$Base/staff/tests" -Method Post -Body $body -ContentType "application/json" -Headers $SA_HEADERS -TimeoutSec 10
    $E2E_TEST_ID = $r._id
    Report 25 "POST /staff/tests" "PASS" ("Created '" + $r.title + "', id=" + $E2E_TEST_ID)
} catch {
    $err = $_.Exception.Message
    try { $eb = $_.ErrorDetails.Message } catch { $eb = "" }
    Report 25 "POST /staff/tests" "FAIL" ("err=" + $err + " body=" + $eb)
}

# 7.2 Assign test to group
$ASSIGNMENT_ID = $null
if ($E2E_TEST_ID -and $GROUP_ID) {
    try {
        $body = "{""test_id"":""$E2E_TEST_ID"",""group_id"":""$GROUP_ID""}"
        $r = Invoke-RestMethod -Uri "$Base/staff/tests/assign" -Method Post -Body $body -ContentType "application/json" -Headers $SA_HEADERS -TimeoutSec 10
        $ASSIGNMENT_ID = $r._id
        Report 26 "POST /staff/tests/assign" "PASS" ("assignment_id=" + $ASSIGNMENT_ID)
    } catch {
        $err = $_.Exception.Message
        try { $eb = $_.ErrorDetails.Message } catch { $eb = "" }
        Report 26 "POST /staff/tests/assign" "FAIL" ("err=" + $err + " body=" + $eb)
    }
} else { Report 26 "POST /staff/tests/assign" "SKIP" "No test_id or group_id" }

# 7.3 Student sees assigned test
if ($ASSIGNMENT_ID) {
    try {
        $r = Invoke-RestMethod -Uri "$Base/student/tests/assigned" -Method Get -Headers $SH -TimeoutSec 10
        if ($r.Count -gt 0) {
            Report 27 "GET /student/tests/assigned (1)" "PASS" ("Sees: " + $r[0].title)
        } else {
            Report 27 "GET /student/tests/assigned (1)" "FAIL" "Student sees 0 tests"
        }
    } catch { Report 27 "GET /student/tests/assigned" "FAIL" $_.Exception.Message }
} else { Report 27 "GET /student/tests/assigned" "SKIP" "No assignment" }

# 7.4 Submit test
if ($E2E_TEST_ID) {
    try {
        $answers = @(
            @{question_number=1;answer="Paris"},
            @{question_number=2;answer="4"}
        )
        $body = @{test_id=$E2E_TEST_ID;answers=$answers} | ConvertTo-Json -Depth 5
        $r = Invoke-RestMethod -Uri "$Base/student/tests/submit" -Method Post -Body $body -ContentType "application/json" -Headers $SH -TimeoutSec 10
        $sc = $r.percentage
        Report 28 "POST /student/tests/submit" "PASS" ("score=" + $sc + "%, " + $r.correct_answers + "/" + $r.total_questions + " correct")
        
        if ($sc -eq 100) { Report 29 "Scoring accuracy" "PASS" "100% as expected" }
        else { Report 29 "Scoring accuracy" "FAIL" ("Expected 100%, got " + $sc + "%") }
    } catch {
        $err = $_.Exception.Message
        try { $eb = $_.ErrorDetails.Message } catch { $eb = "" }
        Report 28 "POST /student/tests/submit" "FAIL" ("err=" + $err + " body=" + $eb)
    }
} else { Report 28 "POST /student/tests/submit" "SKIP" "No test_id"; Report 29 "Scoring accuracy" "SKIP" "" }

# 7.5 Duplicate submission
if ($E2E_TEST_ID) {
    try {
        $body = "{""test_id"":""$E2E_TEST_ID"",""answers"":[{""question_number"":1,""answer"":""Paris""}]}"
        $r = Invoke-RestMethod -Uri "$Base/student/tests/submit" -Method Post -Body $body -ContentType "application/json" -Headers $SH -TimeoutSec 10
        Report 30 "Duplicate submit -> 409" "FAIL" "Should return 409"
    } catch {
        $c = $_.Exception.Response.StatusCode.value__
        if ($c -eq 409) { Report 30 "Duplicate submit -> 409" "PASS" }
        else { Report 30 "Duplicate submit" "FAIL" ("Got " + $c) }
    }
} else { Report 30 "Duplicate submit" "SKIP" "" }

# 7.6 Student results
try {
    $r = Invoke-RestMethod -Uri "$Base/student/results" -Method Get -Headers $SH -TimeoutSec 10
    Report 31 "GET /student/results" "PASS" ("Found " + $r.Count + " result(s)")
    if ($r.Count -gt 0) { Report 32 "Result integrity" "PASS" ("score=" + $r[0].percentage + "%") }
} catch { Report 31 "GET /student/results" "FAIL" $_.Exception.Message }

# 7.7 Analytics results
try {
    $r = Invoke-RestMethod -Uri "$Base/analytics/results" -Method Get -Headers $SA_HEADERS -TimeoutSec 10
    Report 33 "GET /analytics/results" "PASS" ("Found " + $r.Count + " result(s)")
} catch { Report 33 "GET /analytics/results" "FAIL" $_.Exception.Message }

# ============================================================================
# SECTION 8: ERROR HANDLING & EDGE CASES
# ============================================================================
Write-Host "`n--- 8. EDGE CASES ---" -ForegroundColor Magenta

# Missing fields
try {
    $r = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body '{"username":"x"}' -ContentType "application/json" -TimeoutSec 10
    Report 34 "Missing fields -> 422" "FAIL" "Should return 422"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 422) { Report 34 "Missing fields -> 422" "PASS" }
    else { Report 34 "Missing fields" "FAIL" ("Got " + $c) }
}

# Malformed JSON
try {
    $r = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body "{bad" -ContentType "application/json" -TimeoutSec 10
    Report 35 "Malformed JSON -> 4xx" "FAIL" "Should return 400/422"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 400 -or $c -eq 422) { Report 35 "Malformed JSON -> " + $c "PASS" }
    else { Report 35 "Malformed JSON" "FAIL" ("Got " + $c) }
}

# Non-existent route
try {
    $r = Invoke-RestMethod -Uri "$Base/xyz/nope" -Method Get -TimeoutSec 10
    Report 36 "Non-existent -> 404" "FAIL" "Should return 404"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 404) { Report 36 "Non-existent -> 404" "PASS" }
    else { Report 36 "Non-existent" "FAIL" ("Got " + $c) }
}

# Invalid JWT
try {
    $bh = @{Authorization="Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fakesig"}
    $r = Invoke-RestMethod -Uri "$Base/auth/me" -Method Get -Headers $bh -TimeoutSec 10
    Report 37 "Invalid JWT -> 401" "FAIL" "Should return 401"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 401) { Report 37 "Invalid JWT -> 401" "PASS" }
    else { Report 37 "Invalid JWT" "FAIL" ("Got " + $c) }
}

# Student -> Admin endpoint
try {
    $r = Invoke-RestMethod -Uri "$Base/admin/teachers" -Method Get -Headers $SH -TimeoutSec 10
    Report 38 "Student -> Admin -> 403" "FAIL" "Should be forbidden"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 403) { Report 38 "Student -> Admin -> 403" "PASS" }
    else { Report 38 "Student -> Admin" "FAIL" ("Got " + $c) }
}

# Teacher -> SuperAdmin endpoint
try {
    $r = Invoke-RestMethod -Uri "$Base/superadmin/centers" -Method Get -Headers $TH -TimeoutSec 10
    Report 39 "Teacher -> SuperAdmin -> 403" "FAIL" "Should be forbidden"
} catch {
    $c = $_.Exception.Response.StatusCode.value__
    if ($c -eq 403) { Report 39 "Teacher -> SuperAdmin -> 403" "PASS" }
    else { Report 39 "Teacher -> SuperAdmin" "FAIL" ("Got " + $c) }
}

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " AUDIT COMPLETE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PASS: $Pass" -ForegroundColor Green
Write-Host "FAIL: $Fail" -ForegroundColor Red
Write-Host "SKIP: $Warn" -ForegroundColor Yellow
Write-Host ("TOTAL: " + ($Pass + $Fail + $Warn)) -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
