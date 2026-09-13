const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const mysql = require('mysql2/promise');

const pool = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'barangay_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const poolConnection = mysql.createPool(pool);

async function executeQuery(query, params = []) {
  const [results] = await poolConnection.execute(query, params);
  return results;
}

/**
 * @route   GET /api/residents/profile
 * @desc    Get current resident's profile
 * @access  Resident (Private)
 */
router.get(
  '/profile',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      if (req.user.role !== 'resident') {
        return res.status(403).json({
          success: false,
          message: 'Forbidden. Residents only.',
          errorCode: 'FORBIDDEN'
        });
      }

      const [rows] = await executeQuery(
        `SELECT u.id, u.email, u.role, rp.full_name, rp.mobile_number, rp.purok, rp.barangay_id,
                rp.address_text, rp.birth_date, rp.profile_picture, rp.id_picture,
                rp.emergency_contact_name, rp.emergency_contact_number,
                rp.created_at, rp.updated_at
         FROM users u
         JOIN resident_profiles rp ON u.id = rp.user_id
         WHERE u.id = ?`,
        [req.user.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Resident profile not found.',
          errorCode: 'PROFILE_NOT_FOUND'
        });
      }

      return res.json({
        success: true,
        data: rows[0]
      });
    } catch (error) {
      console.error('Get resident profile error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch resident profile.',
        errorCode: 'PROFILE_FETCH_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/residents/profile
 * @desc    Update resident's profile
 * @access  Resident (Private)
 */
router.put(
  '/profile',
  authMiddleware.authMiddleware,
  [
    body('full_name')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Full name cannot be empty')
      .isLength({ max: 150 })
      .withMessage('Full name must not exceed 150 characters'),
    body('mobile_number')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Mobile number cannot be empty')
      .matches(/^09\d{9}$/)
      .withMessage('Please provide a valid Philippine mobile number (starts with 09, 11 digits)'),
    body('address_text')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Address must not exceed 500 characters'),
    body('purok')
      .optional()
      .trim()
      .isLength({ max: 50 })
      .withMessage('Purok must not exceed 50 characters'),
    body('barangay_id')
      .optional()
      .trim()
      .isLength({ max: 20 })
      .withMessage('Barangay ID must not exceed 20 characters'),
    body('birth_date')
      .optional()
      .isISO8601()
      .withMessage('Valid birth date is required (YYYY-MM-DD)'),
    body('emergency_contact_name')
      .optional()
      .trim()
      .isLength({ max: 150 })
      .withMessage('Emergency contact name must not exceed 150 characters'),
    body('emergency_contact_number')
      .optional()
      .trim()
      .matches(/^09\d{9}$/)
      .withMessage('Emergency contact must be a valid Philippine mobile number')
  ],
  async (req, res) => {
    try {
      if (req.user.role !== 'resident') {
        return res.status(403).json({
          success: false,
          message: 'Forbidden. Residents only.',
          errorCode: 'FORBIDDEN'
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'PROFILE_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const {
        full_name,
        mobile_number,
        address_text,
        purok,
        barangay_id,
        birth_date,
        emergency_contact_name,
        emergency_contact_number
      } = req.body;

      // Build dynamic update query
      const updates = [];
      const params = [];

      if (full_name !== undefined) {
        updates.push('full_name = ?');
        params.push(full_name);
      }
      if (mobile_number !== undefined) {
        updates.push('mobile_number = ?');
        params.push(mobile_number);
      }
      if (address_text !== undefined) {
        updates.push('address_text = ?');
        params.push(address_text);
      }
      if (purok !== undefined) {
        updates.push('purok = ?');
        params.push(purok);
      }
      if (barangay_id !== undefined) {
        updates.push('barangay_id = ?');
        params.push(barangay_id);
      }
      if (birth_date !== undefined) {
        updates.push('birth_date = ?');
        params.push(birth_date);
      }
      if (emergency_contact_name !== undefined) {
        updates.push('emergency_contact_name = ?');
        params.push(emergency_contact_name);
      }
      if (emergency_contact_number !== undefined) {
        updates.push('emergency_contact_number = ?');
        params.push(emergency_contact_number);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields to update.',
          errorCode: 'NO_FIELDS_TO_UPDATE'
        });
      }

      // Check if mobile_number is being changed and already exists
      if (mobile_number !== undefined) {
        const [existing] = await executeQuery(
          'SELECT id FROM resident_profiles WHERE mobile_number = ? AND user_id != ?',
          [mobile_number, req.user.id]
        );
        if (existing.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Mobile number already in use.',
            errorCode: 'MOBILE_NUMBER_EXISTS'
          });
        }
      }

      params.push(req.user.id);

      await executeQuery(
        `UPDATE resident_profiles SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
        params
      );

      // Fetch updated profile
      const [rows] = await executeQuery(
        `SELECT u.id, u.email, u.role, rp.full_name, rp.mobile_number, rp.purok, rp.barangay_id,
                rp.address_text, rp.birth_date, rp.profile_picture, rp.id_picture,
                rp.emergency_contact_name, rp.emergency_contact_number,
                rp.created_at, rp.updated_at
         FROM users u
         JOIN resident_profiles rp ON u.id = rp.user_id
         WHERE u.id = ?`,
        [req.user.id]
      );

      return res.json({
        success: true,
        message: 'Profile updated successfully',
        data: rows[0]
      });
    } catch (error) {
      console.error('Update resident profile error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update resident profile.',
        errorCode: 'PROFILE_UPDATE_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/residents/requests
 * @desc    Get current resident's requests (alias for /api/requests)
 * @access  Resident (Private)
 */
router.get(
  '/requests',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      if (req.user.role !== 'resident') {
        return res.status(403).json({
          success: false,
          message: 'Forbidden. Residents only.',
          errorCode: 'FORBIDDEN'
        });
      }

      const [rows] = await executeQuery(
        `SELECT r.id, r.reference_number, r.category_id, sc.name as category_name, 
          r.status, r.priority, r.full_name, r.contact_number, r.barangay_id,
          r.requested_at, r.updated_at,
          (SELECT COUNT(*) FROM request_documents WHERE request_id = r.id) as document_count
          FROM requests r
          LEFT JOIN service_categories sc ON r.category_id = sc.id
          WHERE r.resident_id = ?
          ORDER BY r.created_at DESC`,
        [req.user.id]
      );

      return res.json({
        success: true,
        count: rows.length,
        data: rows
      });
    } catch (error) {
      console.error('Get resident requests error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch requests.',
        errorCode: 'REQUESTS_FETCH_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/residents/complaints
 * @desc    Get current resident's complaints (alias for /api/complaints)
 * @access  Resident (Private)
 */
router.get(
  '/complaints',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      if (req.user.role !== 'resident') {
        return res.status(403).json({
          success: false,
          message: 'Forbidden. Residents only.',
          errorCode: 'FORBIDDEN'
        });
      }

      const [rows] = await executeQuery(
        `SELECT c.id, c.title, c.category_id, cc.name as category_name,
          c.status, c.priority, c.location, c.incident_date,
          c.created_at, c.resolved_at
          FROM complaints c
          LEFT JOIN complaint_categories cc ON c.category_id = cc.id
          WHERE c.resident_id = ?
          ORDER BY c.created_at DESC`,
        [req.user.id]
      );

      return res.json({
        success: true,
        count: rows.length,
        data: rows
      });
    } catch (error) {
      console.error('Get resident complaints error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch complaints.',
        errorCode: 'COMPLAINTS_FETCH_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/residents/notifications
 * @desc    Get current resident's notifications (alias for /api/notifications)
 * @access  Resident (Private)
 */
router.get(
  '/notifications',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      if (req.user.role !== 'resident') {
        return res.status(403).json({
          success: false,
          message: 'Forbidden. Residents only.',
          errorCode: 'FORBIDDEN'
        });
      }

      const [rows] = await executeQuery(
        `SELECT n.id, n.title, n.message, n.type, n.related_entity_type, n.related_entity_id,
          n.is_read, n.created_at,
          CASE WHEN n.related_entity_type = 'request' THEN
            (SELECT reference_number FROM requests WHERE id = n.related_entity_id)
          WHEN n.related_entity_type = 'complaint' THEN
            (SELECT title FROM complaints WHERE id = n.related_entity_id)
          END as related_title
          FROM notifications n
          WHERE n.user_id = ?
          ORDER BY n.created_at DESC`,
        [req.user.id]
      );

      const [unreadCount] = await executeQuery(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
        [req.user.id]
      );

      return res.json({
        success: true,
        count: rows.length,
        unreadCount: unreadCount[0]?.count || 0,
        data: rows
      });
    } catch (error) {
      console.error('Get resident notifications error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch notifications.',
        errorCode: 'NOTIFICATIONS_FETCH_ERROR'
      });
    }
  }
);

module.exports = router;