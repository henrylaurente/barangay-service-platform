const express = require('express');
const router = express.Router();
const { body, param, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = authMiddleware.authorize;
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const poolConnection = require('../config/db');

// Multer configuration for secure file uploads
const uploadDir = 'uploads/requests';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `request_${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPG, and PNG files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 5 // max 5 files
  }
});

async function executeQuery(query, params = []) {
  const [results] = await poolConnection.execute(query, params);
  return results;
}

/**
 * Helper: Execute queries in a transaction
 */
async function executeTransaction(queries) {
  const connection = await poolConnection.getConnection();
  try {
    await connection.beginTransaction();
    const results = [];
    for (const { query, params } of queries) {
      const [result] = await connection.execute(query, params);
      results.push(result);
    }
    await connection.commit();
    return results;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
 * Helper: Generate reference number
 */
async function generateReferenceNumber(categoryId) {
  const [date] = await executeQuery(
    'SELECT YEAR(CURDATE()) as year'
  );
  const year = date.year;

  const [rows] = await executeQuery(
    `SELECT reference_number FROM requests 
     WHERE YEAR(created_at) = ? 
     AND category_id = ? 
     AND status != 'CANCELLED' 
     ORDER BY id DESC LIMIT 1`,
    [year, categoryId]
  );

  if (rows.length === 0) {
    return `BRGY-${year}-000001`;
  }

  const lastRef = rows[0].reference_number;
  const lastNum = parseInt(lastRef.split('-')[2], 10);
  const nextNum = lastNum + 1;
  const formattedNum = String(nextNum).padStart(6, '0');

  return `BRGY-${year}-${formattedNum}`;
}

/**
 * @route   POST /api/requests
 * @desc    Submit a new service request
 * @access  Resident (Private)
 */
router.post(
  '/',
  authMiddleware.authMiddleware,
  authorize('resident'),
  [
    body('category_id')
      .isInt({ min: 1 })
      .withMessage('Valid service category is required')
      .custom(async (value) => {
        const [rows] = await executeQuery('SELECT id FROM service_categories WHERE id = ?', [value]);
        if (rows.length === 0) {
          throw new Error('Invalid service category');
        }
        return true;
      }),
    body('full_name')
      .trim()
      .notEmpty()
      .withMessage('Full name is required'),
    body('contact_number')
      .trim()
      .notEmpty()
      .withMessage('Contact number is required')
      .matches(/^09\d{9}$/)
      .withMessage('Please provide a valid Philippine mobile number (starts with 09, 11 digits)'),
    body('barangay_id')
      .trim()
      .notEmpty()
      .withMessage('Barangay ID is required'),
    body('address')
      .trim()
      .notEmpty()
      .withMessage('Address is required'),
    body('description')
      .trim()
      .notEmpty()
      .withMessage('Request description is required'),
    body('supporting_documents')
      .optional({ nullable: true })
      .isArray()
      .withMessage('Supporting documents must be an array')
      .custom((value) => {
        if (value && value.length > 5) {
          throw new Error('Maximum 5 documents allowed');
        }
        return true;
      }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'REQUEST_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const { category_id, full_name, contact_number, barangay_id, address, description } = req.body;
      const residentId = req.user.id;

      const referenceNumber = await generateReferenceNumber(category_id);
      const requestId = crypto.randomUUID();

      await executeTransaction([
        {
          query: `INSERT INTO requests 
            (id, reference_number, resident_id, category_id, status, priority, full_name, contact_number, barangay_id, address, description) 
            VALUES (?, ?, ?, ?, 'PENDING', 'NORMAL', ?, ?, ?, ?, ?)`,
          params: [requestId, referenceNumber, residentId, category_id, full_name, contact_number, barangay_id, address, description]
        },
        {
          query: `INSERT INTO request_status_history (id, request_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)`,
          params: [crypto.randomUUID(), requestId, 'PENDING', 'PENDING', residentId]
        }
      ]);

      await createNotification(
        residentId,
        'Request Submitted',
        `Your request ${referenceNumber} has been submitted and is pending review.`,
        'request_submitted',
        'request',
        requestId
      );

      const [adminUsers] = await executeQuery('SELECT id FROM users WHERE role = ?', ['admin']);
      for (const admin of adminUsers) {
        await createNotification(
          admin.id,
          'New Request Submitted',
          `New request ${referenceNumber} submitted by ${full_name}.`,
          'request_submitted',
          'request',
          requestId
        );
      }

      return res.status(201).json({
        success: true,
        message: 'Request submitted successfully',
        data: {
          request_id: requestId,
          reference_number: referenceNumber,
          status: 'PENDING'
        }
      });
    } catch (error) {
      console.error('Submit request error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to submit request. Please try again.',
        errorCode: 'REQUEST_SUBMISSION_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/requests
 * @desc    Get all requests (with filtering for admins, resident-specific for residents)
 * @access  Private (role-dependent)
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
        whereClause = 'WHERE assigned_staff_id IS NOT NULL';
        params = [];
      }

      const [rows] = await executeQuery(
        `SELECT r.id, r.reference_number, r.category_id, sc.name as category_name, 
          r.status, r.priority, r.full_name, r.contact_number, r.barangay_id,
          r.requested_at, r.updated_at,
          (SELECT COUNT(*) FROM request_documents WHERE request_id = r.id) as document_count
          FROM requests r
          LEFT JOIN service_categories sc ON r.category_id = sc.id
          ${whereClause}
          ORDER BY r.created_at DESC`,
        params
      );

      return res.json({
        success: true,
        count: rows.length,
        data: rows
      });
    } catch (error) {
      console.error('Get requests error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch requests.',
        errorCode: 'REQUESTS_FETCH_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/requests/:id
 * @desc    Get single request details
 * @access  Private (role-dependent)
 */
router.get(
  '/:id',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;

      let query = `
        SELECT r.id, r.reference_number, r.category_id, sc.name as category_name, 
          r.status, r.priority, r.full_name, r.contact_number, r.barangay_id,
          r.address, r.description, r.requested_at, r.updated_at,
          r.estimated_completion, r.actual_completion,
          r.resident_id,
          (SELECT COUNT(*) FROM request_documents WHERE request_id = r.id) as document_count
          FROM requests r
          LEFT JOIN service_categories sc ON r.category_id = sc.id
          WHERE r.id = ?`;
      
      const params = [id];

      if (req.user.role === 'resident') {
        query += ' AND r.resident_id = ?';
        params.push(req.user.id);
      } else if (req.user.role === 'staff') {
        query = `
          SELECT r.id, r.reference_number, r.category_id, sc.name as category_name, 
            r.status, r.priority, r.full_name, r.contact_number, r.barangay_id,
            r.address, r.description, r.requested_at, r.updated_at,
            r.estimated_completion, r.actual_completion,
            r.resident_id,
            (SELECT COUNT(*) FROM request_documents WHERE request_id = r.id) as document_count
            FROM requests r
            LEFT JOIN service_categories sc ON r.category_id = sc.id
            JOIN request_assignments ra ON r.id = ra.request_id
            WHERE r.id = ? AND ra.staff_id = ?`;
        params.push(req.user.id);
      }

      const [requestRows] = await executeQuery(query, params);

      if (requestRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found.',
          errorCode: 'REQUEST_NOT_FOUND'
        });
      }

      const request = requestRows[0];

      const [historyRows] = await executeQuery(
        `SELECT tsh.*, u.full_name as changed_by_name 
         FROM request_status_history tsh
         LEFT JOIN users u ON tsh.changed_by = u.id
         WHERE tsh.request_id = ?
         ORDER BY tsh.changed_at DESC`,
        [id]
      );

      const [docRows] = await executeQuery(
        `SELECT id, original_name, filename, file_type, file_size, uploaded_by, uploaded_at 
         FROM request_documents 
         WHERE request_id = ?
         ORDER BY is_primary DESC, uploaded_at DESC`,
        [id]
      );

      const [assignRows] = await executeQuery(
        `SELECT ra.*, sp.full_name as staff_name, sp.position as staff_position 
         FROM request_assignments ra
         LEFT JOIN staff_profiles sp ON ra.staff_id = sp.id
         WHERE ra.request_id = ?
         ORDER BY ra.assigned_at DESC`,
        [id]
      );

      const [remarksRows] = await executeQuery(
        `SELECT rq.*, u.full_name as remark_by_name 
         FROM request_remarks rq
         LEFT JOIN users u ON rq.staff_id = u.id
         WHERE rq.request_id = ?
         ORDER BY rq.created_at DESC`,
        [id]
      );

      return res.json({
        success: true,
        data: {
          ...request,
          timeline: historyRows,
          documents: docRows,
          assignments: assignRows,
          remarks: remarksRows
        }
      });
    } catch (error) {
      console.error('Get request detail error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch request details.',
        errorCode: 'REQUEST_DETAIL_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/requests/:id/status
 * @desc    Change request status (Staff/Admin only)
 * @access  Staff / Admin (Private)
 */
router.put(
  '/:id/status',
  authMiddleware.authMiddleware,
  authorize('staff', 'admin'),
  [
    param('id').isUUID().withMessage('Valid request ID is required'),
    body('new_status')
      .isIn(['PENDING', 'UNDER_REVIEW', 'PROCESSING', 'FOR_VERIFICATION', 'APPROVED', 'REJECTED', 'READY_FOR_RELEASE', 'COMPLETED', 'CANCELLED', 'NEEDS_ADDITIONAL_INFORMATION'])
      .withMessage('Invalid status value'),
    body('remarks')
      .optional({ nullable: true })
      .isString()
      .withMessage('Remarks must be a string if provided')
      .trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'STATUS_CHANGE_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const { id } = req.params;
      const { new_status, remarks } = req.body;
      const changerId = req.user.id;
      const changerRole = req.user.role;

      const [requestRows] = await executeQuery('SELECT id, reference_number, status, resident_id FROM requests WHERE id = ?', [id]);
      if (requestRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found.',
          errorCode: 'REQUEST_NOT_FOUND'
        });
      }

      const request = requestRows[0];

      const validTransitions = {
        PENDING: ['UNDER_REVIEW', 'CANCELLED', 'NEEDS_ADDITIONAL_INFORMATION'],
        UNDER_REVIEW: ['PROCESSING', 'NEEDS_ADDITIONAL_INFORMATION'],
        PROCESSING: ['FOR_VERIFICATION', 'REJECTED', 'CANCELLED'],
        FOR_VERIFICATION: ['APPROVED', 'REJECTED'],
        APPROVED: ['READY_FOR_RELEASE', 'CANCELLED'],
        REJECTED: ['PENDING'],
        READY_FOR_RELEASE: ['COMPLETED'],
        COMPLETED: [],
        CANCELLED: [],
        NEEDS_ADDITIONAL_INFORMATION: ['PENDING', 'PROCESSING', 'UNDER_REVIEW']
      };

      if (validTransitions[request.status] && !validTransitions[request.status].includes(new_status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${request.status} to ${new_status}.`,
          errorCode: 'INVALID_STATUS_TRANSITION'
        });
      }

      await executeQuery(
        'UPDATE requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [new_status, id]
      );

      await executeQuery(
        `INSERT INTO request_status_history (id, request_id, from_status, to_status, changed_by) VALUES (?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), request.id, request.status, new_status, changerId]
      );

      if (new_status === 'COMPLETED') {
        await executeQuery(
          'UPDATE requests SET actual_completion = CURRENT_TIMESTAMP WHERE id = ?',
          [id]
        );
      }

      if (new_status === 'APPROVED' && changerRole === 'admin') {
        // Assignment logic could go here
      }

      const statusMessages = {
        'UNDER_REVIEW': 'Your request is now under review.',
        'PROCESSING': 'Your request is now being processed.',
        'FOR_VERIFICATION': 'Your request is pending verification.',
        'APPROVED': 'Your request has been approved.',
        'REJECTED': 'Your request has been rejected.',
        'READY_FOR_RELEASE': 'Your request is ready for release.',
        'COMPLETED': 'Your request has been completed.',
        'CANCELLED': 'Your request has been cancelled.',
        'NEEDS_ADDITIONAL_INFORMATION': 'Your request needs additional information.'
      };

      const message = statusMessages[new_status] || `Your request status has been updated to ${new_status}.`;
      
      await createNotification(
        request.resident_id,
        'Request Status Updated',
        `Request ${request.reference_number}: ${message}`,
        'status_changed',
        'request',
        id
      );

      if (new_status === 'NEEDS_ADDITIONAL_INFORMATION') {
        await createNotification(
          request.resident_id,
          'Additional Information Required',
          `Your request ${request.reference_number} requires additional information. Please check the request details.`,
          'info_required',
          'request',
          id
        );
      }

      if (new_status === 'APPROVED') {
        await createNotification(
          request.resident_id,
          'Request Approved',
          `Your request ${request.reference_number} has been approved and is ready for processing.`,
          'approved',
          'request',
          id
        );
      }

      if (new_status === 'REJECTED') {
        await createNotification(
          request.resident_id,
          'Request Rejected',
          `Your request ${request.reference_number} has been rejected. Please contact the barangay office for details.`,
          'rejected',
          'request',
          id
        );
      }

      if (new_status === 'READY_FOR_RELEASE') {
        await createNotification(
          request.resident_id,
          'Request Ready for Release',
          `Your request ${request.reference_number} is ready for release. Please visit the barangay office to claim.`,
          'ready_for_release',
          'request',
          id
        );
      }

      if (new_status === 'COMPLETED') {
        await createNotification(
          request.resident_id,
          'Request Completed',
          `Your request ${request.reference_number} has been completed. Thank you for using our services.`,
          'completed',
          'request',
          id
        );
      }

      return res.json({
        success: true,
        message: `Request status updated from ${request.status} to ${new_status}`,
        data: {
          request_id: id,
          reference_number: request.reference_number,
          old_status: request.status,
          new_status
        }
      });
    } catch (error) {
      console.error('Status change error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update request status.',
        errorCode: 'STATUS_CHANGE_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/requests/:id/assign
 * @desc    Assign request to staff (Admin only)
 * @access  Admin (Private)
 */
router.put(
  '/:id/assign',
  authMiddleware.authMiddleware,
  authorize('admin'),
  [
    param('id').isUUID().withMessage('Valid request ID is required'),
    body('staff_id')
      .isUUID()
      .withMessage('Valid staff ID is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'ASSIGNMENT_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const { id } = req.params;
      const { staff_id } = req.body;

      const [requestRows] = await executeQuery('SELECT reference_number FROM requests WHERE id = ?', [id]);
      if (requestRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found.',
          errorCode: 'REQUEST_NOT_FOUND'
        });
      }

      const [staffRows] = await executeQuery('SELECT id, full_name FROM staff_profiles WHERE id = ?', [staff_id]);
      if (staffRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Staff member not found.',
          errorCode: 'STAFF_NOT_FOUND'
        });
      }

      const assignmentId = crypto.randomUUID();
      await executeQuery(
        'INSERT INTO request_assignments (id, request_id, staff_id, assigned_at) VALUES (?, ?, ?, NOW())',
        [assignmentId, id, staff_id]
      );

      await executeQuery(
        'UPDATE requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
      );

      // Create notification for resident
      await createNotification(
        (await executeQuery('SELECT resident_id FROM requests WHERE id = ?', [id]))[0].resident_id,
        'Request Assigned',
        `Your request has been assigned to staff member ${staffRows[0].full_name}.`,
        'status_changed',
        'request',
        id
      );

      return res.json({
        success: true,
        message: 'Request assigned to staff successfully',
        data: {
          request_id: id,
          staff_id,
          staff_name: staffRows[0].full_name
        }
      });
    } catch (error) {
      console.error('Assign request error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to assign request.',
        errorCode: 'ASSIGNMENT_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/requests/:id/documents
 * @desc    Upload documents for request
 * @access  Resident (Private)
 */
router.post(
  '/:id/documents',
  authMiddleware.authMiddleware,
  authorize('resident'),
  upload.array('documents', 5),
  async (req, res) => {
    try {
      const { id } = req.params;

      const [requestRows] = await executeQuery('SELECT id, reference_number, resident_id FROM requests WHERE id = ?', [id]);
      if (requestRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Request not found.',
          errorCode: 'REQUEST_NOT_FOUND'
        });
      }

      if (requestRows[0].resident_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to upload documents for this request.',
          errorCode: 'UNAUTHORIZED_DOCUMENT_UPLOAD'
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files uploaded.',
          errorCode: 'NO_FILES_UPLOADED'
        });
      }

      const uploadedFiles = [];
      for (const file of req.files) {
        const docId = crypto.randomUUID();
        const isPrimary = uploadedFiles.length === 0;
        await executeQuery(
          `INSERT INTO request_documents (id, request_id, filename, original_name, file_path, file_type, file_size, uploaded_by, is_primary) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [docId, id, file.filename, file.originalname, file.path, file.mimetype, file.size, 'resident', isPrimary]
        );
        uploadedFiles.push({
          id: docId,
          original_name: file.originalname,
          filename: file.filename,
          file_type: file.mimetype,
          file_size: file.size,
          is_primary: isPrimary
        });
      }

      return res.status(201).json({
        success: true,
        message: `${req.files.length} document(s) uploaded successfully`,
        data: {
          request_id: id,
          documents: uploadedFiles
        }
      });
    } catch (error) {
      console.error('Document upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to process document upload.',
        errorCode: 'DOCUMENT_UPLOAD_ERROR'
      });
    }
  }
);

/**
 * @route   GET /api/requests/:id/timeline
 * @desc    Get request status timeline
 * @access  Private
 */
router.get(
  '/:id/timeline',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;

      let query = `
        SELECT tsh.*, u.full_name as changed_by_name, u.role as changed_by_role 
        FROM request_status_history tsh
        LEFT JOIN users u ON tsh.changed_by = u.id
        INNER JOIN requests r ON tsh.request_id = r.id
        WHERE tsh.request_id = ?`;
      const params = [id];

      if (req.user.role === 'resident') {
        query += ' AND r.resident_id = ?';
        params.push(req.user.id);
      }
      // staff and admin can view all timelines (no extra condition)

      const [rows] = await executeQuery(query, params);

      return res.json({
        success: true,
        data: rows
      });
    } catch (error) {
      console.error('Get timeline error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch request timeline.',
        errorCode: 'TIMELINE_FETCH_ERROR'
      });
    }
  }
);

module.exports = router;