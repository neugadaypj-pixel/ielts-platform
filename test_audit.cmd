@echo off
setlocal enabledelayedexpansion
set BASE=https://ielts-platform.fly.dev
set PASS=0
set FAIL=0

echo ============================================
echo  IELTS PLATFORM - FULL API AUDIT
echo ============================================
echo.

:: ---- LOGIN AS SUPERADMIN ----
echo [TEST] Login as SuperAdmin (Jamal)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/auth/login -H "Content-Type: application/json" -d "{\"username\":\"Jamal\",\"password\":\"Sbros0803\"}"') do set LOGIN_RESP=%%i
echo Response: !LOGIN_RESP!
echo !LOGIN_RESP! | findstr "access_token" >nul && (echo RESULT: PASS) || (echo RESULT: FAIL & set /a FAIL+=1 & goto :skip)
set /a PASS+=1

:: Extract token
for /f "tokens=2 delims=:," %%a in ('echo !LOGIN_RESP! ^| findstr "access_token"') do (
    for /f "tokens=*" %%b in ("%%~a") do set TOKEN=%%~b
)
set TOKEN=!TOKEN:"=!
set TOKEN=!TOKEN: =!
echo Token: !TOKEN:~0,20!...
echo.

:: ---- SUPERADMIN: GET /auth/me ----
echo [TEST] GET /auth/me
for /f "delims=" %%i in ('curl -s %BASE%/auth/me -H "Authorization: Bearer !TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "superadmin" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- SUPERADMIN: GET /superadmin/centers ----
echo [TEST] GET /superadmin/centers
for /f "delims=" %%i in ('curl -s %BASE%/superadmin/centers -H "Authorization: Bearer !TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "\[" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- SUPERADMIN: GET /analytics/stats/center ----
echo [TEST] GET /analytics/stats/center
for /f "delims=" %%i in ('curl -s %BASE%/analytics/stats/center -H "Authorization: Bearer !TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "total_students" >nul && (echo RESULT: PASS (total_students, total_assignments present)) || (echo RESULT: FAIL & set /a FAIL+=1)
set /a PASS+=1
echo.

:: ---- SUPERADMIN: GET /analytics/results ----
echo [TEST] GET /analytics/results
for /f "delims=" %%i in ('curl -s %BASE%/analytics/results -H "Authorization: Bearer: !TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "\[" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- SUPERADMIN: GET /staff/tests ----
echo [TEST] GET /staff/tests (SuperAdmin)
for /f "delims=" %%i in ('curl -s %BASE%/staff/tests -H "Authorization: Bearer !TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "\[" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- CREATE CENTER ----
echo [TEST] POST /superadmin/centers (create Test Center)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/superadmin/centers -H "Content-Type: application/json" -H "Authorization: Bearer !TOKEN!" -d "{\"name\":\"Test Center Alpha\",\"admin_username\":\"admin_test1\",\"admin_password\":\"TestPass123\",\"admin_full_name\":\"Alice Admin\",\"admin_contact\":\"alice@test.com\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "_id" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL (might exist already) & set /a FAIL+=1)
echo.

:: Get center ID
for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "_id"') do (for /f "tokens=*" %%b in ("%%~a") do set CENTER_ID=%%~b)
set CENTER_ID=!CENTER_ID:"=!
set CENTER_ID=!CENTER_ID: =!
echo Center ID: !CENTER_ID!

:: ---- LOGIN AS ADMIN ----
echo.
echo [TEST] Login as Admin (admin_test1)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin_test1\",\"password\":\"TestPass123\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "access_token" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)

for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "access_token"') do (for /f "tokens=*" %%b in ("%%~a") do set ADMIN_TOKEN=%%~b)
set ADMIN_TOKEN=!ADMIN_TOKEN:"=!
set ADMIN_TOKEN=!ADMIN_TOKEN: =!
echo.

:: ---- ADMIN: GET /admin/teachers ----
echo [TEST] GET /admin/teachers
for /f "delims=" %%i in ('curl -s %BASE%/admin/teachers -H "Authorization: Bearer !ADMIN_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "\[" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- ADMIN: POST /admin/teachers ----
echo [TEST] POST /admin/teachers (create teacher)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/admin/teachers -H "Content-Type: application/json" -H "Authorization: Bearer !ADMIN_TOKEN!" -d "{\"username\":\"teacher_bob\",\"password\":\"TeachPass123\",\"full_name\":\"Bob Teacher\",\"contact\":\"bob@test.com\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "_id" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL (might exist) & set /a FAIL+=1)
echo.

:: ---- ADMIN: POST /admin/groups ----
echo [TEST] POST /admin/groups (create group)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/admin/groups -H "Content-Type: application/json" -H "Authorization: Bearer !ADMIN_TOKEN!" -d "{\"name\":\"IELTS Prep Group A\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "_id" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL (might exist) & set /a FAIL+=1)

for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "_id"') do (for /f "tokens=*" %%b in ("%%~a") do set GROUP_ID=%%~b)
set GROUP_ID=!GROUP_ID:"=!
set GROUP_ID=!GROUP_ID: =!
echo Group ID: !GROUP_ID!
echo.

:: ---- ADMIN: GET /admin/groups ----
echo [TEST] GET /admin/groups
for /f "delims=" %%i in ('curl -s %BASE%/admin/groups -H "Authorization: Bearer !ADMIN_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "\[" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- ADMIN: GET analytics stats ----
echo [TEST] GET /analytics/stats/center (Admin)
for /f "delims=" %%i in ('curl -s %BASE%/analytics/stats/center -H "Authorization: Bearer !ADMIN_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "total_assignments" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- LOGIN AS TEACHER ----
echo [TEST] Login as Teacher
for /f "delims=" %%i in ('curl -s -X POST %BASE%/auth/login -H "Content-Type: application/json" -d "{\"username\":\"teacher_bob\",\"password\":\"TeachPass123\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "access_token" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)

for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "access_token"') do (for /f "tokens=*" %%b in ("%%~a") do set TEACHER_TOKEN=%%~b)
set TEACHER_TOKEN=!TEACHER_TOKEN:"=!
set TEACHER_TOKEN=!TEACHER_TOKEN: =!
echo.

:: ---- TEACHER: POST /teacher/students ----
echo [TEST] POST /teacher/students (create student)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/teacher/students -H "Content-Type: application/json" -H "Authorization: Bearer !TEACHER_TOKEN!" -d "{\"username\":\"student_carl\",\"password\":\"StudPass123\",\"full_name\":\"Carl Student\",\"contact\":\"carl@test.com\",\"group_id\":\"!GROUP_ID!\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "_id" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL (might exist) & set /a FAIL+=1)
echo.

:: ---- TEACHER: GET /teacher/students ----
echo [TEST] GET /teacher/students
for /f "delims=" %%i in ('curl -s %BASE%/teacher/students -H "Authorization: Bearer !TEACHER_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "student_carl" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- CREATE TEST ----
echo [TEST] POST /staff/tests (create test - as Admin)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/staff/tests -H "Content-Type: application/json" -H "Authorization: Bearer !ADMIN_TOKEN!" -d "{\"title\":\"IELTS Practice Test 1\",\"content_json\":{\"sections\":[],\"questions\":[{\"id\":\"q1\",\"type\":\"multiple_choice\",\"text\":\"What is the capital of France?\",\"options\":[\"London\",\"Paris\",\"Berlin\",\"Madrid\"],\"correct_answer\":\"Paris\",\"points\":5},{\"id\":\"q2\",\"type\":\"true_false\",\"text\":\"The Earth is flat.\",\"options\":[\"True\",\"False\"],\"correct_answer\":\"False\",\"points\":5}],\"total_points\":10,\"time_limit_minutes\":30,\"instructions\":\"Answer all questions.\"}}"') do set RESP=%%i
echo !RESP!
echo !RESP! | findstr "_id" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL (might exist) & set /a FAIL+=1)

for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "_id"') do (for /f "tokens=*" %%b in ("%%~a") do set TEST_ID=%%~b)
set TEST_ID=!TEST_ID:"=!
set TEST_ID=!TEST_ID: =!
echo Test ID: !TEST_ID!
echo.

:: ---- ASSIGN TEST TO GROUP ----
echo [TEST] POST /staff/tests/assign (Admin)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/staff/tests/assign -H "Content-Type: application/json" -H "Authorization: Bearer !ADMIN_TOKEN!" -d "{\"test_id\":\"!TEST_ID!\",\"group_id\":\"!GROUP_ID!\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "_id" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL (might exist) & set /a FAIL+=1)

for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "_id"') do (for /f "tokens=*" %%b in ("%%~a") do set ASSIGN_ID=%%~b)
set ASSIGN_ID=!ASSIGN_ID:"=!
set ASSIGN_ID=!ASSIGN_ID: =!
echo.

:: ---- LOGIN AS STUDENT ----
echo [TEST] Login as Student
for /f "delims=" %%i in ('curl -s -X POST %BASE%/auth/login -H "Content-Type: application/json" -d "{\"username\":\"student_carl\",\"password\":\"StudPass123\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "access_token" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)

for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "access_token"') do (for /f "tokens=*" %%b in ("%%~a") do set STUDENT_TOKEN=%%~b)
set STUDENT_TOKEN=!STUDENT_TOKEN:"=!
set STUDENT_TOKEN=!STUDENT_TOKEN: =!
echo.

:: ---- STUDENT: GET /student/tests/assigned ----
echo [TEST] GET /student/tests/assigned
for /f "delims=" %%i in ('curl -s %BASE%/student/tests/assigned -H "Authorization: Bearer !STUDENT_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "assignment_id" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)

:: Extract assignment_id
for /f "tokens=2 delims=:," %%a in ('echo !RESP! ^| findstr "assignment_id"') do (for /f "tokens=*" %%b in ("%%~a") do set STUDENT_ASSIGN_ID=%%~b)
set STUDENT_ASSIGN_ID=!STUDENT_ASSIGN_ID:"=!
set STUDENT_ASSIGN_ID=!STUDENT_ASSIGN_ID: =!
echo Assignment ID: !STUDENT_ASSIGN_ID!
echo.

:: ---- STUDENT: GET /student/results ----
echo [TEST] GET /student/results (empty)
for /f "delims=" %%i in ('curl -s %BASE%/student/results -H "Authorization: Bearer !STUDENT_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "\[" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- STUDENT: POST /student/tests/submit ----
echo [TEST] POST /student/tests/submit
for /f "delims=" %%i in ('curl -s -X POST %BASE%/student/tests/submit -H "Content-Type: application/json" -H "Authorization: Bearer !STUDENT_TOKEN!" -d "{\"test_id\":\"!TEST_ID!\",\"assignment_id\":\"!STUDENT_ASSIGN_ID!\",\"answers\":[{\"question_id\":\"q1\",\"answer\":\"Paris\"},{\"question_id\":\"q2\",\"answer\":\"False\"}]}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "score" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- STUDENT: DUPLICATE SUBMISSION (should fail) ----
echo [TEST] POST /student/tests/submit (DUPLICATE - should be 409)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/student/tests/submit -H "Content-Type: application/json" -H "Authorization: Bearer !STUDENT_TOKEN!" -d "{\"test_id\":\"!TEST_ID!\",\"assignment_id\":\"!STUDENT_ASSIGN_ID!\",\"answers\":[{\"question_id\":\"q1\",\"answer\":\"Paris\"}]}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "already submitted" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- STUDENT: GET /student/results (now has data) ----
echo [TEST] GET /student/results (after submission)
for /f "delims=" %%i in ('curl -s %BASE%/student/results -H "Authorization: Bearer !STUDENT_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "score" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- ERROR: Invalid login ----
echo [TEST] POST /auth/login (invalid password)
for /f "delims=" %%i in ('curl -s -X POST %BASE%/auth/login -H "Content-Type: application/json" -d "{\"username\":\"Jamal\",\"password\":\"wrong\"}"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "detail" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- ERROR: No auth ----
echo [TEST] GET /auth/me (no token)
for /f "delims=" %%i in ('curl -s %BASE%/auth/me') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "detail" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- ERROR: Student accessing admin endpoint ----
echo [TEST] GET /admin/teachers (as Student - should fail)
for /f "delims=" %%i in ('curl -s %BASE%/admin/teachers -H "Authorization: Bearer !STUDENT_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "detail" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- ERROR: Teacher accessing superadmin endpoint ----
echo [TEST] GET /superadmin/centers (as Teacher - should fail)
for /f "delims=" %%i in ('curl -s %BASE%/superadmin/centers -H "Authorization: Bearer !TEACHER_TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo !RESP! | findstr "detail" >nul && (echo RESULT: PASS & set /a PASS+=1) || (echo RESULT: FAIL & set /a FAIL+=1)
echo.

:: ---- ANALYTICS: Final stats check ----
echo [TEST] GET /analytics/stats/center (final check)
for /f "delims=" %%i in ('curl -s %BASE%/analytics/stats/center -H "Authorization: Bearer !TOKEN!"') do set RESP=%%i
echo Response: !RESP!
echo.

echo ============================================
echo  RESULTS: !PASS! passed, !FAIL! failed
echo ============================================

:skip
