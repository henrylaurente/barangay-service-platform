-- ============================================================
-- Barangay Service Platform - Seed Data with Fixed UUIDs
-- ============================================================
-- All UUIDs are fixed for consistent testing
-- ============================================================

-- ------------------------------------------------------------
-- Fixed UUIDs for consistent seeding
-- ------------------------------------------------------------
SET @role_resident = '11111111-1111-1111-1111-111111111111';
SET @role_staff = '22222222-2222-2222-2222-222222222222';
SET @role_admin = '33333333-3333-3333-3333-333333333333';

SET @admin_user = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SET @staff1_user = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
SET @staff2_user = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
SET @staff3_user = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

SET @resident1_user = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
SET @resident2_user = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
SET @resident3_user = '11111111-2222-3333-4444-555555555555';
SET @resident4_user = '66666666-7777-8888-9999-000000000000';
SET @resident5_user = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
SET @resident6_user = 'ffffffff-1111-2222-3333-444444444444';
SET @resident7_user = '55555555-6666-7777-8888-999999999999';
SET @resident8_user = '11111111-2222-3333-4444-555555555556';
SET @resident9_user = '66666666-7777-8888-9999-000000000001';

SET @staff1_profile = 'aaaaaaaa-1111-1111-1111-111111111111';
SET @staff2_profile = 'bbbbbbbb-2222-2222-2222-222222222222';
SET @staff3_profile = 'cccccccc-3333-3333-3333-333333333333';

SET @resident1_profile = 'eeeeeeee-1111-1111-1111-111111111111';
SET @resident2_profile = 'ffffffff-2222-2222-2222-222222222222';
SET @resident3_profile = '11111111-2222-3333-4444-555555555557';
SET @resident4_profile = '66666666-7777-8888-9999-000000000002';
SET @resident5_profile = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeef';
SET @resident6_profile = 'ffffffff-1111-2222-3333-444444444445';
SET @resident7_profile = '55555555-6666-7777-8888-99999999999a';
SET @resident8_profile = '11111111-2222-3333-4444-555555555558';
SET @resident9_profile = '66666666-7777-8888-9999-000000000003';

-- Password hash for "Password123!" (bcrypt, 12 rounds)
-- $2a$12$LQv3c1GHBvHZ.fN3qJ8ZKe.Zx.UhTGx.QeWzKR7R0N1YKq.hGz1Gy
SET @password_hash = '$2a$12$LQv3c1GHBvHZ.fN3qJ8ZKe.Zx.UhTGx.QeWzKR7R0N1YKq.hGz1Gy';

-- ------------------------------------------------------------
-- Roles
-- ------------------------------------------------------------
INSERT INTO roles (id, name, display_name, description, is_system_role) VALUES
(@role_resident, 'resident', 'Resident', 'Barangay constituent who can submit requests and complaints', 1),
(@role_staff, 'staff', 'Barangay Staff', 'Barangay employee who processes requests', 1),
(@role_admin, 'admin', 'Barangay Official', 'Barangay Chairman or Officer', 1);

-- ------------------------------------------------------------
-- Users: 1 Admin, 3 Staff, 9 Residents
-- ------------------------------------------------------------
INSERT INTO users (id, email, password_hash, role_id, is_active, email_verified) VALUES
(@admin_user, 'admin@brgymariakapulwa.gov.ph', @password_hash, @role_admin, 1, 1),
(@staff1_user, 'staff1@brgymariakapulwa.gov.ph', @password_hash, @role_staff, 1, 1),
(@staff2_user, 'staff2@brgymariakapulwa.gov.ph', @password_hash, @role_staff, 1, 1),
(@staff3_user, 'staff3@brgymariakapulwa.gov.ph', @password_hash, @role_staff, 1, 1),
(@resident1_user, 'maria@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident2_user, 'john@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident3_user, 'pedro@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident4_user, 'rosa@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident5_user, 'carlos@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident6_user, 'ana@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident7_user, 'david@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident8_user, 'cynthia@example.gov.ph', @password_hash, @role_resident, 1, 1),
(@resident9_user, 'elmer@example.gov.ph', @password_hash, @role_resident, 1, 1);

-- ------------------------------------------------------------
-- Resident Profiles
-- ------------------------------------------------------------
INSERT INTO resident_profiles (id, user_id, full_name, address_text, mobile_number, birth_date, purok, barangay_id) VALUES
(@resident1_profile, @resident1_user, 'Maria Santos', 'Purok 1, Brgy. Maria Kapulwa, Quezon City', '0917-555-1234', '1985-03-15', 'Purok 1', 'BRGY-2024'),
(@resident2_profile, @resident2_user, 'John Reyes', 'Purok 2, Brgy. Maria Kapulwa, Quezon City', '0918-555-5678', '1990-07-22', 'Purok 2', 'BRGY-2024'),
(@resident3_profile, @resident3_user, 'Pedro Cruz', 'Purok 3, Brgy. Maria Kapulwa, Quezon City', '0921-555-8765', '1982-11-30', 'Purok 3', 'BRGY-2024'),
(@resident4_profile, @resident4_user, 'Rosa Lim', 'Purok 1, Brgy. Maria Kapulwa, Quezon City', '0922-555-4321', '1995-01-10', 'Purok 1', 'BRGY-2024'),
(@resident5_profile, @resident5_user, 'Carlos Villanueva', 'Purok 4, Brgy. Maria Kapulwa, Quezon City', '0923-555-2143', '1988-05-25', 'Purok 4', 'BRGY-2024'),
(@resident6_profile, @resident6_user, 'Ana Garcia', 'Purok 2, Brgy. Maria Kapulwa, Quezon City', '0924-555-3210', '1992-09-18', 'Purok 2', 'BRGY-2024'),
(@resident7_profile, @resident7_user, 'David Bautista', 'Purok 5, Brgy. Maria Kapulwa, Quezon City', '0925-555-4321', '1998-12-05', 'Purok 5', 'BRGY-2024'),
(@resident8_profile, @resident8_user, 'Cynthia Reyes', 'Purok 3, Brgy. Maria Kapulwa, Quezon City', '0926-555-5432', '1991-06-30', 'Purok 3', 'BRGY-2024'),
(@resident9_profile, @resident9_user, 'Elmer Castillo', 'Purok 4, Brgy. Maria Kapulwa, Quezon City', '0927-555-6543', '1980-08-12', 'Purok 4', 'BRGY-2024');

-- ------------------------------------------------------------
-- Staff Profiles
-- ------------------------------------------------------------
INSERT INTO staff_profiles (id, user_id, full_name, position, department, employee_id, hire_date) VALUES
(@staff1_profile, @staff1_user, 'Alice Reyes', 'Executive Officer', 'Office of the Punong Barangay', 'STF-001', '2020-01-15'),
(@staff2_profile, @staff2_user, 'Bob Mendoza', 'Administrative Officer', 'Records Section', 'STF-002', '2021-03-22'),
(@staff3_profile, @staff3_user, 'Carolyn Aquino', 'Licensing Officer', 'Business Permits', 'STF-003', '2022-07-10');

-- ------------------------------------------------------------
-- Service Categories (already seeded in schema.sql)
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Complaint Categories (already seeded in schema.sql)
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- System Settings (already seeded in schema.sql)
-- ------------------------------------------------------------