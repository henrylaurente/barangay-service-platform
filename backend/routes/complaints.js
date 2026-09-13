const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = authMiddleware.authorize;
const mysql = require('mysql2/promise');
const crypto = require('crypto');

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
 * Helper: Create notification
 */
async function createNotification(userId, title, message, type, relatedEntityType = null, relatedEntityId = null) {
  const notificationId = crypto.randomUUID();
  await executeQuery(
    `INSERT INTO notifications (id, user_id, title, message, type, related_entity_type, related_entity_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [notificationId, userId, title, message, type, relatedEntityType, relatedEntityId]
  );
  return notificationId;
}

/**
 * @route   POST /api/complaints
 */
router.post(
  '/',
  authMiddleware.authMiddleware,
  authorize('resident'),
  [
    body('category_id')
      .isInt({ min: 1 })
      .withMessage('Valid complaint category is required')
      .custom(async (value) => {
        const [rows] = await executeQuery('SELECT id FROM complaint_categories WHERE id = ?', [value]);
        if (rows.length === 0) {
          throw new Error('Invalid complaint category');
        }
        return true;
      }),
    body('title')
      .trim()
      .notEmpty()
      .withMessage('Complaint title is required')
      .isLength({ max: 200 })
      .withMessage('Title must not exceed 200 characters'),
    body('description')
      .trim()
      .notEmpty()
      .withMessage('Complaint description is required')
      .isLength({ max: 1000 })
      .withMessage('Description must not exceed 1000 characters'),
    body('location')
      .trim()
      .notEmpty()
      .withMessage('Location is required'),
    body('incident_date')
      .isISO8601()
      .withMessage('Valid incident date is required')
      .custom((value) => {
        const incidentDate = new Date(value);
        const today = new Date();
        if (incidentDate > today) {
          throw new Error('Incident date cannot be in the future');
        }
        return true;
      }),
    body('incident_time')
      .optional({ nullable: true })
      .isTime()
      .withMessage('Valid incident time is required'),
    body('priority')
      .optional({ nullable: true })
      .isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
      .withMessage('Priority must be LOW, NORMAL, HIGH, or URGENT'),
    body('supporting_photo')
      .optional({ nullable: true })
      .isString()
      .withMessage(' supporting_photo must be a string path'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'COMPLAINT_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const {
        category_id, title, description, location,
        incident_date, incident_time, priority, supporting_photo
      } = req.body;
      const residentId = req.user.id;

      // Generate complaint ID
      const complaintId = `COMPLAINT-${Date.now().toString(36).toUpperCase()}-${String(Math.floor(Math.random() * 899) + 100).padStart(3, '0')}`;

      // Insert complaint
      const [result] = await executeQuery(
        `INSERT INTO complaints 
          (id, resident_id, category_id, title, description, location, incident_date, incident_time, priority, status, internal_notes, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, NOW())`,
        [complaintId, residentId, category_id, title, description, location, incident_date, incident_time, priority]
      );

      // Create initial status history
      await executeQuery(
        `INSERT INTO complaint_status_history (id, complaint_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), complaintId, 'OPEN', 'OPEN', residentId]
      );

      // Create notification for resident
      await createNotification(
        residentId,
        'Complaint Submitted',
        `Your complaint "${title}" has been submitted and is now open.`,
        'complaint_submitted',
        'complaint',
        complaintId
      );

      // Create notification for admins
      const [adminUsers] = await executeQuery('SELECT id FROM users WHERE role = ?', ['admin']);
      for (const admin of adminUsers) {
        await createNotification(
          admin.id,
          'New Complaint Submitted',
          `New complaint "${title}" submitted by resident.`,
          'complaint_submitted',
          'complaint',
          complaintId
        );
      }

      return res.status(201).json({
        success: true,
        message: 'Complaint submitted successfully',
        data: {
          complaint_id: complaintId,
          status: 'OPEN'
        }
      });
    } catch (error) {
      console.error('Submit complaint error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to submit complaint. Please try again.',
        errorCode: 'COMPLAINT_SUBMISSION_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/complaints
 * @desc    Get all complaints (filtered by role)
 * @access  Private
 */
router.get(
  '/',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      const { role } = req.user;
      let whereClause = '';
      let params = [];

      if (role === 'resident') {
        whereClause = 'WHERE resident_id = ?';
        params = [req.user.id];
      } else if (role === 'staff') {
        whereClause = "WHERE status != 'CLOSED'";
        params = [];
      }
      // Admin: no where clause

      const [rows] = await executeQuery(
        `SELECT c.id, c.title, c.category_id, cc.name as category_name,
          c.status, c.priority, c.location, c.incident_date,
          c.created_at, c.resolved_at,
          rp.full_name as resident_name,
          (SELECT COUNT(*) FROM complaint_status_history WHERE complaint_id = c.id ORDER BY changed_at DESC LIMIT 1) as last_status_change
          FROM complaints c
          JOIN resident_profiles rp ON c.resident_id = rp.id
          LEFT JOIN complaint_categories cc ON c.category_id = cc.id
          ${whereClause}
          ORDER BY c.created_at DESC`,
        params
      );

      return res.json({
        success: true,
        count: rows.length,
        data: rows
      });
    } catch (error) {
      console.error('Get complaints error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch complaints.',
        errorCode: 'COMPLAINTS_FETCH_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/complaints/:id
 * @desc    Get single complaint details
 * @access  Private
 */
router.get(
  '/:id',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Build query with ownership check
      let query = `
        SELECT c.id, c.title, c.category_id, cc.name as category_name,
          c.description, c.location, c.incident_date, c.incident_time,
          c.priority, c.status, c.internal_notes,
          c.resolved_at, c.created_at,
          c.resident_id,
          rp.full_name as resident_name, rp.mobile_number as resident_phone,
          (SELECT GROUP_CONCAT(CONCAT(' ', changed_by_name, ': ', changed_at) SEPARATOR ' | ')
           FROM complaint_status_history WHERE complaint_id = c.id) as status_history
          FROM complaints c
          JOIN resident_profiles rp ON c.resident_id = rp.id
          LEFT JOIN complaint_categories cc ON c.category_id = cc.id
          WHERE c.id = ?`;
      
      const params = [id];

      // Add ownership check for residents
      if (req.user.role === 'resident') {
        query += ' AND c.resident_id = ?';
        params.push(req.user.id);
      }
      // Staff and admin can view all complaints

      const [complaintRows] = await executeQuery(query, params);

      if (complaintRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Complaint not found.',
          errorCode: 'COMPLAINT_NOT_FOUND'
        });
      }

      const complaint = complaintRows[0];

      // Get status history
      const [historyRows] = await executeQuery(
        `SELECT tsh.*, u.full_name as changed_by_name 
         FROM complaint_status_history tsh
         LEFT JOIN users u ON tsh.changed_by = u.id
         WHERE tsh.complaint_id = ?
         ORDER BY tsh.changed_at ASC`,
        [id]
      );

      return res.json({
        success: true,
        data: {
          ...complaint,
          timeline: historyRows
        }
      });
    } catch (error) {
      console.error('Get complaint detail error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch complaint details.',
        errorCode: 'COMPLAINT_DETAIL_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/complaints/:id/status
 * @desc    Update complaint status (Staff/Admin only)
 * @access  Staff / Admin (Private)
 */
router.put(
  '/:id/status',
  authMiddleware.authMiddleware,
  authorize('staff', 'admin'),
  [
    param('id').isInt({ min: 1 }).withMessage('Valid complaint ID is required'),
    body('new_status')
      .isIn(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'])
      .withMessage('Invalid complaint status'),
    body('internal_notes')
      .optional({ nullable: true })
      .isString()
      .withMessage('Internal notes must be a string if provided')
      .trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'COMPLAINT_STATUS_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const { id } = req.params;
      const { new_status, internal_notes } = req.body;
      const changerId = req.user.id;

      // Check if complaint exists
      const [complaintRows] = await executeQuery('SELECT id, title, status FROM complaints WHERE id = ?', [id]);
      if (complaintRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Complaint not found.',
          errorCode: 'COMPLAINT_NOT_FOUND'
        });
      }

      const complaint = complaintRows[0];

      // Validate status transition
      const validTransitions = {
        OPEN: ['INVESTIGATING', 'CLOSED'],
        INVESTIGATING: ['RESOLVED', 'CLOSED'],
        RESOLVED: ['CLOSED'],
        CLOSED: []
      };

      if (validTransitions[complaint.status] && !validTransitions[complaint.status].includes(new_status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${complaint.status} to ${new_status}.`,
          errorCode: 'INVALID_COMPLAINT_TRANSITION'
        });
      }

      // Update complaint status
      const updateQuery = new_status === 'RESOLVED' || new_status === 'CLOSED'
        ? 'UPDATE complaints SET status = ?, resolved_at = CURRENT_TIMESTAMP, internal_notes = ? WHERE id = ?'
        : 'UPDATE complaints SET status = ?, internal_notes = ? WHERE id = ?';

      await executeQuery(
        updateQuery,
        [new_status, internal_notes, id]
      );

      // Create status history entry
      await executeQuery(
        `INSERT INTO complaint_status_history (id, complaint_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), complaint.id, complaint.status, new_status, changerId]
      );

      // Create notification for resident
      const statusMessages = {
        'INVESTIGATING': 'Your complaint is now being investigated.',
        'RESOLVED': 'Your complaint has been resolved.',
        'CLOSED': 'Your complaint has been closed.'
      };

      const message = statusMessages[new_status] || `Your complaint status has been updated to ${new_status}.`;
      
      await createNotification(
        complaint.resident_id,
        'Complaint Status Updated',
        `Complaint "${complaint.title}": ${message}`,
        'complaint_status_changed',
        'complaint',
        id
      );

      // If resolved, create resolved notification
      if (new_status === 'RESOLVED') {
        await createNotification(
          complaint.resident_id,
          'Complaint Resolved',
          `Your complaint "${complaint.title}" has been resolved.`,
          'complaint_status_changed',
          'complaint',
          id
        );
      }

      // If closed
      if (new_status === 'CLOSED') {
        await createNotification(
          complaint.resident_id,
          'Complaint Closed',
          `Your complaint "${complaint.title}" has been closed.`,
          'complaint_status_changed',
          'complaint',
          id
        );
      }

      return res.json({
        success: true,
        message: `Complaint status updated from ${complaint.status} to ${new_status}`,
        data: {
          complaint_id: id,
          title: complaint.title,
          old_status: complaint.status,
          new_status
        }
      });
    } catch (error) {
      console.error('Complaint status change error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update complaint status.',
        errorCode: 'COMPLAINT_STATUS_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/complaint-categories
 * @desc    Get all complaint categories
 * @access  Public
 */
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await executeQuery(
      'SELECT id, name, description, color_code FROM complaint_categories WHERE is_active = 1 ORDER BY name'
    );

    return res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Get complaint categories error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch complaint categories.',
      errorCode: 'COMPLAINT_CATEGORIES_ERROR'
    });
  }
});

module.exports = router;