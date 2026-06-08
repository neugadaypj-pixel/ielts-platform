-- ============================================================
-- IELTS Test Platform - Oracle Schema
-- Schema: IELTS_APP
-- ============================================================

-- SEQUENCES
CREATE SEQUENCE users_seq       START WITH 1 INCREMENT BY 1 CACHE 20
/
CREATE SEQUENCE tests_seq       START WITH 1 INCREMENT BY 1 CACHE 20
/
CREATE SEQUENCE groups_seq      START WITH 1 INCREMENT BY 1 CACHE 20
/
CREATE SEQUENCE submissions_seq START WITH 1 INCREMENT BY 1 CACHE 20
/
CREATE SEQUENCE feedbacks_seq   START WITH 1 INCREMENT BY 1 CACHE 20
/
CREATE SEQUENCE notifications_seq START WITH 1 INCREMENT BY 1 CACHE 20
/
CREATE SEQUENCE test_schedule_seq START WITH 1 INCREMENT BY 1 CACHE 20
/

-- GROUPS (created first - referenced by users)
CREATE TABLE groups (
    id         NUMBER PRIMARY KEY,
    name       VARCHAR2(100) NOT NULL,
    teacher_id NUMBER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
/
CREATE INDEX idx_groups_teacher ON groups(teacher_id)
/

-- USERS
CREATE TABLE users (
    id            NUMBER PRIMARY KEY,
    username      VARCHAR2(50) NOT NULL UNIQUE,
    password      VARCHAR2(255) NOT NULL,
    role          VARCHAR2(10) NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
    teacher_id    NUMBER,
    group_id      NUMBER,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
/
CREATE INDEX idx_users_role_teacher ON users(role, teacher_id)
/

-- TESTS
CREATE TABLE tests (
    id              NUMBER PRIMARY KEY,
    title           VARCHAR2(200) NOT NULL,
    type            VARCHAR2(10) NOT NULL CHECK (type IN ('reading', 'listening', 'writing')),
    teacher_name    VARCHAR2(100),
    created_by      NUMBER NOT NULL,
    reading_passage CLOB DEFAULT '',
    builder_json    CLOB DEFAULT '',
    custom_title    VARCHAR2(200),
    folder          VARCHAR2(255) DEFAULT '',
    questions       CLOB DEFAULT '[]',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
/
CREATE INDEX idx_tests_created_type ON tests(created_by, type)
/
CREATE INDEX idx_tests_type_created ON tests(type, created_at)
/

-- USER_ASSIGNED_TESTS
CREATE TABLE user_assigned_tests (
    user_id NUMBER NOT NULL,
    test_id NUMBER NOT NULL,
    PRIMARY KEY (user_id, test_id)
)
/

-- GROUP_STUDENTS
CREATE TABLE group_students (
    group_id NUMBER NOT NULL,
    user_id  NUMBER NOT NULL,
    PRIMARY KEY (group_id, user_id)
)
/

-- GROUP_ASSIGNED_TESTS
CREATE TABLE group_assigned_tests (
    group_id NUMBER NOT NULL,
    test_id  NUMBER NOT NULL,
    PRIMARY KEY (group_id, test_id)
)
/

-- GROUP_TEST_SCHEDULE
CREATE TABLE group_test_schedule (
    id             NUMBER PRIMARY KEY,
    group_id       NUMBER NOT NULL,
    test_id        NUMBER NOT NULL,
    available_from TIMESTAMP
)
/
CREATE INDEX idx_gts_group_available ON group_test_schedule(group_id, available_from)
/

-- SUBMISSIONS
CREATE TABLE submissions (
    id                  NUMBER PRIMARY KEY,
    test_id             NUMBER NOT NULL,
    student_id          NUMBER NOT NULL,
    teacher_id          NUMBER,
    group_id            NUMBER,
    type                VARCHAR2(10) NOT NULL CHECK (type IN ('reading', 'listening', 'writing')),
    student_name        VARCHAR2(100) NOT NULL,
    status              VARCHAR2(20) DEFAULT 'completed' NOT NULL,
    attempt_count       NUMBER DEFAULT 1 NOT NULL,
    score               NUMBER,
    total_questions     NUMBER,
    percentage          NUMBER,
    band                VARCHAR2(10),
    word_count1         NUMBER,
    word_count2         NUMBER,
    time_remaining_text VARCHAR2(50) DEFAULT '',
    details             CLOB DEFAULT '{}',
    first_submitted_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_submitted_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uk_test_student UNIQUE (test_id, student_id)
)
/
CREATE INDEX idx_sub_teacher_type    ON submissions(teacher_id, type)
/
CREATE INDEX idx_sub_student_test    ON submissions(student_id, test_id)
/
CREATE INDEX idx_sub_teacher_created ON submissions(teacher_id, first_submitted_at)
/
CREATE INDEX idx_sub_group_test      ON submissions(group_id, test_id)
/
CREATE INDEX idx_sub_test_pct        ON submissions(test_id, percentage DESC)
/

-- FEEDBACKS
CREATE TABLE feedbacks (
    id               NUMBER PRIMARY KEY,
    student_id       NUMBER NOT NULL,
    student_name     VARCHAR2(100) NOT NULL,
    test_type        VARCHAR2(10) NOT NULL CHECK (test_type IN ('reading', 'listening', 'writing', 'general')),
    question_type    VARCHAR2(255) DEFAULT '',
    issue_description CLOB NOT NULL,
    status           VARCHAR2(10) DEFAULT 'open' NOT NULL CHECK (status IN ('open', 'resolved')),
    admin_notes      CLOB DEFAULT '',
    admin_reply      CLOB DEFAULT '',
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
/
CREATE INDEX idx_fb_student_created ON feedbacks(student_id, created_at)
/
CREATE INDEX idx_fb_status ON feedbacks(status)
/

-- NOTIFICATIONS
CREATE TABLE notifications (
    id         NUMBER PRIMARY KEY,
    user_id    NUMBER NOT NULL,
    type       VARCHAR2(20) NOT NULL CHECK (type IN (
                   'test_available', 'admin_reply', 'test_assigned', 'general',
                   'test_submitted', 'group_completed', 'low_score_alert'
               )),
    title      VARCHAR2(255) NOT NULL,
    message    CLOB NOT NULL,
    related_id NUMBER,
    is_read    NUMBER(1) DEFAULT 0 NOT NULL CHECK (is_read IN (0, 1)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
/
CREATE INDEX idx_notif_user_read_created ON notifications(user_id, is_read, created_at)
/

-- SESSIONS
CREATE TABLE sessions (
    sid        VARCHAR2(128) PRIMARY KEY,
    expires    TIMESTAMP,
    data       CLOB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
/
CREATE INDEX idx_sessions_expires ON sessions(expires)
/

-- ID MAPPING (temporary - migration only)
CREATE TABLE id_mapping (
    collection   VARCHAR2(50) NOT NULL,
    mongo_id     VARCHAR2(24) NOT NULL,
    oracle_id    NUMBER NOT NULL,
    PRIMARY KEY (collection, mongo_id)
)
/

-- FOREIGN KEY CONSTRAINTS (added after all tables exist)
ALTER TABLE users ADD CONSTRAINT fk_user_teacher FOREIGN KEY (teacher_id) REFERENCES users(id)
/
ALTER TABLE users ADD CONSTRAINT fk_user_group    FOREIGN KEY (group_id)    REFERENCES groups(id)
/
ALTER TABLE tests ADD CONSTRAINT fk_test_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
/
ALTER TABLE user_assigned_tests ADD CONSTRAINT fk_uat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
/
ALTER TABLE user_assigned_tests ADD CONSTRAINT fk_uat_test FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
/
ALTER TABLE group_students ADD CONSTRAINT fk_gs_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
/
ALTER TABLE group_students ADD CONSTRAINT fk_gs_user  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE
/
ALTER TABLE group_assigned_tests ADD CONSTRAINT fk_gat_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
/
ALTER TABLE group_assigned_tests ADD CONSTRAINT fk_gat_test  FOREIGN KEY (test_id)  REFERENCES tests(id) ON DELETE CASCADE
/
ALTER TABLE group_test_schedule ADD CONSTRAINT fk_gts_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
/
ALTER TABLE group_test_schedule ADD CONSTRAINT fk_gts_test  FOREIGN KEY (test_id)  REFERENCES tests(id) ON DELETE CASCADE
/
ALTER TABLE submissions ADD CONSTRAINT fk_sub_test    FOREIGN KEY (test_id)    REFERENCES tests(id) ON DELETE CASCADE
/
ALTER TABLE submissions ADD CONSTRAINT fk_sub_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
/
ALTER TABLE submissions ADD CONSTRAINT fk_sub_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE SET NULL
/
ALTER TABLE submissions ADD CONSTRAINT fk_sub_group   FOREIGN KEY (group_id)   REFERENCES groups(id) ON DELETE SET NULL
/
ALTER TABLE feedbacks ADD CONSTRAINT fk_fb_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
/
ALTER TABLE notifications ADD CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
/

-- TRIGGERS (auto-increment IDs)
CREATE OR REPLACE TRIGGER trg_users_id BEFORE INSERT ON users
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := users_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_tests_id BEFORE INSERT ON tests
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := tests_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_groups_id BEFORE INSERT ON groups
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := groups_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_submissions_id BEFORE INSERT ON submissions
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := submissions_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_feedbacks_id BEFORE INSERT ON feedbacks
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := feedbacks_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_notifications_id BEFORE INSERT ON notifications
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := notifications_seq.NEXTVAL; END IF; END;
/
CREATE OR REPLACE TRIGGER trg_test_schedule_id BEFORE INSERT ON group_test_schedule
    FOR EACH ROW BEGIN IF :NEW.id IS NULL THEN :NEW.id := test_schedule_seq.NEXTVAL; END IF; END;
/
