-- ============================================================
-- Barangay Community Service Request Platform - Complete Database Schema
-- ============================================================
-- MySQL 8.0+
-- All primary keys use CHAR(36) UUID for consistency
-- ============================================================

SET NAMES utf8mb4;
SET TIME_ZONE='+00:00';
SET UNIQUE_CHECKS=0;
SET FOREIGN_KEY_CHECKS=0;
SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';
SET SQL_NOTES=1;

-- ------------------------------------------------------------
-- Drop tables (for fresh installation)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS complaints;
DROP TABLE IF EXISTS complaint_categories;
DROP TABLE IF EXISTS request_remarks;
DROP TABLE IF EXISTS request_assignments;
DROP TABLE IF EXISTS request_status_history;
DROP TABLE IF EXISTS request_documents;
DROP TABLE IF EXISTS requests;
DROP TABLE IF EXISTS service_requirements;
DROP TABLE IF EXISTS service_categories;
DROP TABLE IF EXISTS staff_profiles;
DROP TABLE IF EXISTS resident_profiles;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS users;

-- ------------------------------------------------------------
-- 1. users table - Authentication system
-- ------------------------------------------------------------
CREATE TABLE users (
    id CHAR(36) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id CHAR(36) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    reset_token VARCHAR(512) DEFAULT NULL,
    reset_token_expiry DATETIME DEFAULT NULL,
    last_login_at DATETIME DEFAULT NULL,
    login_attempts INT(11) NOT NULL DEFAULT 0,
    locked_until DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_users_email (email),
    INDEX idx_users_role (role_id),
    INDEX idx_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 2. roles table - Role-based access control
-- ------------------------------------------------------------
CREATE TABLE roles (
    id CHAR(36) NOT NULL,
    name ENUM('resident', 'staff', 'admin') NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- Seed roles
INSERT INTO roles (id, name, display_name, description, is_system_role) VALUES
(UUID(), 'resident', 'Resident', 'Barangay constituent who can submit requests and complaints', 1),
(UUID(), 'staff', 'Barangay Staff', 'Barangay employee who processes requests', 1),
(UUID(), 'admin', 'Barangay Official', 'Barangay Chairman or Officer', 1);

-- ------------------------------------------------------------
-- 3. resident_profiles table - Extended resident info
-- ------------------------------------------------------------
CREATE TABLE resident_profiles (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    address_text TEXT,
    mobile_number VARCHAR(20) NOT NULL UNIQUE,
    birth_date DATE,
    purok VARCHAR(50),
    barangay_id VARCHAR(20),
    profile_picture VARCHAR(512) DEFAULT NULL,
    id_picture VARCHAR(512) DEFAULT NULL,
    emergency_contact_name VARCHAR(150) DEFAULT NULL,
    emergency_contact_number VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_resident_user (user_id),
    INDEX idx_resident_mobile (mobile_number),
    CONSTRAINT fk_resident_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 4. staff_profiles table - Extended staff info
-- ------------------------------------------------------------
CREATE TABLE staff_profiles (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    position VARCHAR(100) NOT NULL,
    department VARCHAR(100),
    employee_id VARCHAR(20) NOT NULL UNIQUE,
    profile_picture VARCHAR(512) DEFAULT NULL,
    hire_date DATE DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_staff_user (user_id),
    INDEX idx_staff_employee (employee_id),
    CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 5. service_categories table - Request types
-- ------------------------------------------------------------
CREATE TABLE service_categories (
    id CHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    processing_time_days INT NOT NULL DEFAULT 3,
    processing_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    sort_order INT(11) NOT NULL DEFAULT 0,
    required_documents JSON DEFAULT NULL,
    instructions TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_categories_name (name),
    INDEX idx_categories_status (status),
    INDEX idx_categories_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 6. service_requirements table - Per-category requirements
-- ------------------------------------------------------------
CREATE TABLE service_requirements (
    id CHAR(36) NOT NULL,
    category_id CHAR(36) NOT NULL,
    requirement_name VARCHAR(200) NOT NULL,
    is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_requirements_category (category_id),
    CONSTRAINT fk_requirements_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 7. requests table - Service requests
-- ------------------------------------------------------------
CREATE TABLE requests (
    id CHAR(36) NOT NULL,
    reference_number VARCHAR(50) NOT NULL UNIQUE,
    resident_id CHAR(36) NOT NULL,
    category_id CHAR(36) NOT NULL,
    status ENUM('PENDING', 'UNDER_REVIEW', 'PROCESSING', 'FOR_VERIFICATION', 'APPROVED', 'REJECTED', 'READY_FOR_RELEASE', 'COMPLETED', 'CANCELLED', 'NEEDS_ADDITIONAL_INFORMATION') NOT NULL DEFAULT 'PENDING',
    priority ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    full_name VARCHAR(150) NOT NULL,
    contact_number VARCHAR(20) NOT NULL,
    barangay_id VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    description TEXT NOT NULL,
    estimated_completion DATE DEFAULT NULL,
    actual_completion DATETIME DEFAULT NULL,
    processing_fee_paid TINYINT(1) NOT NULL DEFAULT 0,
    total_fee DECIMAL(10, 2) DEFAULT 0.00,
    notes TEXT DEFAULT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE INDEX idx_requests_reference (reference_number),
    INDEX idx_requests_resident (resident_id),
    INDEX idx_requests_category (category_id),
    INDEX idx_requests_status (status),
    INDEX idx_requests_priority (priority),
    INDEX idx_requests_created (created_at),
    CONSTRAINT fk_requests_resident FOREIGN KEY (resident_id) REFERENCES resident_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_requests_category FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 8. request_documents table - Document uploads for requests
-- ------------------------------------------------------------
CREATE TABLE request_documents (
    id CHAR(36) NOT NULL,
    request_id CHAR(36) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(512) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    uploaded_by ENUM('resident', 'staff', 'admin') NOT NULL DEFAULT 'resident',
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    INDEX idx_docs_request (request_id),
    INDEX idx_docs_uploaded (uploaded_at),
    CONSTRAINT fk_docs_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 9. request_status_history table - Status change timeline
-- ------------------------------------------------------------
CREATE TABLE request_status_history (
    id CHAR(36) NOT NULL,
    request_id CHAR(36) NOT NULL,
    from_status ENUM('PENDING', 'UNDER_REVIEW', 'PROCESSING', 'FOR_VERIFICATION', 'APPROVED', 'REJECTED', 'READY_FOR_RELEASE', 'COMPLETED', 'CANCELLED', 'NEEDS_ADDITIONAL_INFORMATION'),
    to_status ENUM('PENDING', 'UNDER_REVIEW', 'PROCESSING', 'FOR_VERIFICATION', 'APPROVED', 'REJECTED', 'READY_FOR_RELEASE', 'COMPLETED', 'CANCELLED', 'NEEDS_ADDITIONAL_INFORMATION') NOT NULL,
    changed_by CHAR(36) DEFAULT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    PRIMARY KEY (id),
    INDEX idx_history_request (request_id),
    INDEX idx_history_changed (changed_at),
    CONSTRAINT fk_history_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_history_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 10. request_assignments table - Staff assignments
-- ------------------------------------------------------------
CREATE TABLE request_assignments (
    id CHAR(36) NOT NULL,
    request_id CHAR(36) NOT NULL,
    staff_id CHAR(36) NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    PRIMARY KEY (id),
    INDEX idx_assign_request (request_id),
    INDEX idx_assign_staff (staff_id),
    INDEX idx_assign_assigned (assigned_at),
    UNIQUE INDEX idx_assign_unique (request_id, staff_id, assigned_at),
    CONSTRAINT fk_assign_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_assign_staff FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 11. request_remarks table - Staff remarks/notes on requests
-- ------------------------------------------------------------
CREATE TABLE request_remarks (
    id CHAR(36) NOT NULL,
    request_id CHAR(36) NOT NULL,
    staff_id CHAR(36) DEFAULT NULL,
    resident_id CHAR(36) DEFAULT NULL,
    remark_text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_remarks_request (request_id),
    INDEX idx_remarks_staff (staff_id),
    INDEX idx_remarks_created (created_at),
    CONSTRAINT fk_remarks_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_remarks_staff FOREIGN KEY (staff_id) REFERENCES staff_profiles(id) ON DELETE SET NULL,
    CONSTRAINT fk_remarks_resident FOREIGN KEY (resident_id) REFERENCES resident_profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 12. complaints table - Community complaints
-- ------------------------------------------------------------
CREATE TABLE complaints (
    id CHAR(36) NOT NULL,
    resident_id CHAR(36) NOT NULL,
    category_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(255) NOT NULL,
    incident_date DATETIME NOT NULL,
    incident_time TIME DEFAULT NULL,
    priority ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    status ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    photo_path VARCHAR(512) DEFAULT NULL,
    internal_notes TEXT DEFAULT NULL,
    resolved_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_complaints_resident (resident_id),
    INDEX idx_complaints_category (category_id),
    INDEX idx_complaints_status (status),
    INDEX idx_complaints_priority (priority),
    INDEX idx_complaints_created (created_at),
    CONSTRAINT fk_complaints_resident FOREIGN KEY (resident_id) REFERENCES resident_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_complaints_category FOREIGN KEY (category_id) REFERENCES complaint_categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 13. complaint_categories table - Complaint types
-- ------------------------------------------------------------
CREATE TABLE complaint_categories (
    id CHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    color_code VARCHAR(7) DEFAULT '#6c757d',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_complaint_cat_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 14. complaint_status_history table - Complaint status timeline
-- ------------------------------------------------------------
CREATE TABLE complaint_status_history (
    id CHAR(36) NOT NULL,
    complaint_id CHAR(36) NOT NULL,
    from_status ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'),
    to_status ENUM('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED') NOT NULL,
    changed_by CHAR(36) DEFAULT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT DEFAULT NULL,
    PRIMARY KEY (id),
    INDEX idx_complaint_history_complaint (complaint_id),
    INDEX idx_complaint_history_changed (changed_at),
    CONSTRAINT fk_complaint_history_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
    CONSTRAINT fk_complaint_history_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 15. notifications table - In-app notifications
-- ------------------------------------------------------------
CREATE TABLE notifications (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('request_submitted', 'status_changed', 'info_required', 'approved', 'rejected', 'ready_for_release', 'completed', 'new_announcement', 'complaint_submitted', 'complaint_status_changed') NOT NULL,
    related_entity_type ENUM('request', 'complaint', 'announcement') DEFAULT NULL,
    related_entity_id CHAR(36) DEFAULT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    read_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_notifications_user (user_id),
    INDEX idx_notifications_read (is_read),
    INDEX idx_notifications_created (created_at),
    INDEX idx_notifications_related (related_entity_type, related_entity_id),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 16. announcements table - Barangay announcements
-- ------------------------------------------------------------
CREATE TABLE announcements (
    id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    image_path VARCHAR(512) DEFAULT NULL,
    published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_announcements_active (is_active),
    INDEX idx_announcements_published (published_at),
    INDEX idx_announcements_category (category),
    CONSTRAINT fk_announcements_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 17. audit_logs table - Administrative action logs
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) DEFAULT NULL,
    action_type ENUM('login', 'logout', 'request_created', 'status_changed', 'approval', 'rejection', 'assignment', 'file_upload', 'user_update', 'user_created', 'user_deactivated', 'announcement_created', 'announcement_updated', 'announcement_deleted', 'category_created', 'category_updated', 'category_deleted', 'settings_changed') NOT NULL,
    target_type ENUM('request', 'complaint', 'user', 'announcement', 'category', 'settings') DEFAULT NULL,
    target_id CHAR(36) DEFAULT NULL,
    old_value JSON DEFAULT NULL,
    new_value JSON DEFAULT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_audit_user (user_id),
    INDEX idx_audit_action (action_type),
    INDEX idx_audit_target (target_type, target_id),
    INDEX idx_audit_created (created_at),
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- 18. system_settings table - System configuration
-- ------------------------------------------------------------
CREATE TABLE system_settings (
    id CHAR(36) NOT NULL,
    `key` VARCHAR(100) NOT NULL UNIQUE,
    value JSON DEFAULT NULL,
    description TEXT,
    updated_by CHAR(36) DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_settings_key (`key`),
    CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------------------------------------------------
-- Seed data for service_categories (12 core barangay services)
-- ------------------------------------------------------------
INSERT INTO service_categories (id, name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions) VALUES
(UUID(), 'Barangay Clearance', 'Certification of good moral character and residency', 3, 100.00, 'active', 1, '["Valid Government ID", "Proof of Residency", "Community Tax Certificate"]', 'Present valid ID and proof of residency'),
(UUID(), 'Certificate of Residency', 'Proof of residence within the barangay', 5, 150.00, 'active', 2, '["Proof of Address", "Application Form"]', 'Submit proof of address (utility bill, tax receipt)'),
(UUID(), 'Certificate of Indigency', 'Certification for indigent families', 7, 0.00, 'active', 3, '["Barangay Certification", "Financial Assessment"]', 'Barangay evaluation and home visit required'),
(UUID(), 'Barangay Certificate', 'General certification of good standing', 5, 100.00, 'active', 4, '["Valid Government ID", "Proof of Residency"]', 'Specify purpose of certification'),
(UUID(), 'Business Clearance', 'Permit to operate business within barangay', 10, 500.00, 'active', 5, '["Mayor\'s Permit", "Business Registration", "Fire Safety Clearance"]', 'Submit business permit and CEER certificate'),
(UUID(), 'Barangay Permit', 'Barangay business or activity permit', 7, 300.00, 'active', 6, '["Business Registration", "Location Clearance"]', 'Submit required business documents'),
(UUID(), 'Complaint / Community Concern', 'Submit community concern or complaint', 5, 0.00, 'active', 7, '["Detailed Description", "Location"]', 'Provide detailed description and location'),
(UUID(), 'Noise Complaint', 'Report excessive noise in the community', 3, 0.00, 'active', 8, '["Time of Incident", "Source of Noise", "Location"]', 'Include time, date, and source of noise'),
(UUID(), 'Street/Drainage Complaint', 'Report damaged street or drainage issues', 7, 0.00, 'active', 9, '["Extent of Damage", "Location", "Photos (optional)"]', 'Provide location and extent of damage'),
(UUID(), 'Waste Management Complaint', 'Report waste collection or sanitation issues', 5, 0.00, 'active', 10, '["Type of Waste Issue", "Location Details"]', 'Specify type and location of concern'),
(UUID(), 'Public Safety Concern', 'Report public safety issues', 5, 0.00, 'active', 11, '["Safety Description", "Urgency Level", "Location"]', 'Describe the safety concern'),
(UUID(), 'Other Community Request', 'Other community-related requests', 5, 0.00, 'active', 12, '["Request Description"]', 'Describe your request');

-- ------------------------------------------------------------
-- Seed data for complaint_categories
-- ------------------------------------------------------------
INSERT INTO complaint_categories (id, name, description, color_code, is_active) VALUES
(UUID(), 'Noise', 'Excessive noise disturbances', '#dc3545', 1),
(UUID(), 'Waste', 'Improper waste disposal or collection issues', '#ffc107', 1),
(UUID(), 'Road', 'Road damage, potholes, or obstructions', '#fd7e14', 1),
(UUID(), 'Drainage', 'Drainage blockage or flooding', '#20c997', 1),
(UUID(), 'Animal-related', 'Stray animals or animal-related issues', '#6f42c1', 1),
(UUID(), 'Public Safety', 'Public safety hazards or concerns', '#dc3545', 1),
(UUID(), 'Conflict', 'Neighbor or community disputes', '#6c757d', 1),
(UUID(), 'Other', 'Other community concerns', '#6c757d', 1);

-- ------------------------------------------------------------
-- Seed data for system_settings
-- ------------------------------------------------------------
INSERT INTO system_settings (`key`, value, description) VALUES
('barangay_name', '"Barangay Maria Kapulwa"', 'Official barangay name'),
('barangay_address', '"Poblacion, Quezon City, Metro Manila"', 'Barangay hall address'),
('barangay_contact', '"+632-8123-4567"', 'Barangay hall contact number'),
('barangay_email', '"info@brgymariakapulwa.gov.ph"', 'Barangay official email'),
('max_file_size_mb', '5', 'Maximum file upload size in MB'),
('allowed_file_types', '["pdf", "jpg", "jpeg", "png"]', 'Allowed file upload types'),
('default_purok', '"Purok 1"', 'Default purok for new residents'),
('request_auto_assign', 'false', 'Automatically assign requests to staff'),
('notification_email_enabled', 'false', 'Enable email notifications'),
('session_timeout_minutes', '30', 'Session timeout in minutes');

SET FOREIGN_KEY_CHECKS=1;
SET UNIQUE_CHECKS=1;