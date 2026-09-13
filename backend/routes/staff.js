const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = authMiddleware.authorize;

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
 * @route   GET /api/staff/dashboard
 * @desc    Get staff dashboard data
 * @access  Staff (Private)
 */
router.get('/dashboard', authMiddleware.authMiddleware, authorize('staff'), async (req, res) => {
  try {
    const staffId = req.user.id;

    // Get assigned requests
    const [assignedRequests] = await executeQuery(
      `SELECT r.id, r.reference_number, r.category_id, sc.name as category_name,
        r.status, r.priority, r.requested_at
       FROM request_assignments ra
       JOIN requests r ON ra.request_id = r.id
       LEFT JOIN service_categories sc ON r.category_id = sc.id
       WHERE ra.staff_id = ?
       ORDER BY ra.assigned_at DESC`,
      [staffId]
    );

    // Get completed requests
    const [completedRequests] = await executeQuery(
      `SELECT r.id, r.reference_number, r.category_id, sc.name as category_name,
        r.status, r.requested_at, r.actual_completion
       FROM request_assignments ra
       JOIN requests r ON ra.request_id = r.id
       LEFT JOIN service_categories sc ON r.category_id = sc.id
       WHERE ra.staff_id = ? AND r.status = 'COMPLETED'
       ORDER BY r.actual_completion DESC`,
      [staffId]
    );

    // Get pending count for this staff
    const [pendingCount] = await executeQuery(
      "SELECT COUNT(*) as count FROM request_assignments ra JOIN requests r ON ra.request_id = r.id WHERE ra.staff_id = ? AND r.status IN ('PENDING', 'UNDER_REVIEW', 'PROCESSING', 'FOR_VERIFICATION')",
      [staffId]
    );

    // Get average processing time for completed requests
    const [avgProcessing] = await executeQuery(
      "SELECT AVG(TIMESTAMPDIFF(HOUR, ra.assigned_at, r.actual_completion)) as avg_hours "
      + "FROM request_assignments ra "
      + "JOIN requests r ON ra.request_id = r.id AND ra.staff_id = ? "
      + "WHERE r.status = 'COMPLETED' AND r.actual_completion IS NOT NULL",
      [staffId]
    );

    const avgHours = Math.round(parseFloat(avgProcessing[0].avg_hours) || 0);

    return res.json({
      success: true,
      data: {
        assignedRequests: assignedRequests,
        completedRequests: completedRequests,
        pendingCount: pendingCount[0].count,
        averageProcessingTime: avgHours + ' hours'
      }
    });
  } catch (error) {
    console.error('Staff dashboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch staff dashboard.',
      errorCode: 'STAFF_DASHBOARD_ERROR'
    });
  }
});

/**
 * @route   GET /api/staff/assigned-requests
 * @desc    Get all assigned requests for staff with filtering
 * @access  Staff (Private)
 */
router.get('/assigned-requests', authMiddleware.authMiddleware, authorize('staff'), async (req, res) => {
  try {
    const staffId = req.user.id;
    const { status, category, priority, search } = req.query;

    let whereClause = 'WHERE ra.staff_id = ?';
    let params = [staffId];

    if (status) {
      whereClause += ' AND r.status = ?';
      params.push(status);
    }
    if (category) {
      whereClause += ' AND r.category_id = ?';
      params.push(category);
    }
    if (priority) {
      whereClause += ' AND r.priority = ?';
      params.push(priority);
    }
    if (search) {
      whereClause += ' AND (r.reference_number LIKE ? OR r.full_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [rows] = await executeQuery(
      `SELECT r.id, r.reference_number, r.category_id, sc.name as category_name,
        r.status, r.priority, r.full_name, r.barangay_id,
        r.requested_at, r.updated_at
       FROM request_assignments ra
       JOIN requests r ON ra.request_id = r.id
       LEFT JOIN service_categories sc ON r.category_id = sc.id
       ${whereClause}
       ORDER BY r.requested_at DESC`,
      params
    );

    const totalRows = await executeQuery(
      `SELECT COUNT(*) as count FROM request_assignments ra JOIN requests r ON ra.request_id = r.id ${whereClause}`,
      params
    );

    return res.json({
      success: true,
      data: rows,
      pagination: {
        total: totalRows[0].count,
        page: 1,
        pages: Math.ceil(totalRows[0].count / 10)
      }
    });
  } catch (error) {
    console.error('Staff assigned requests error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch assigned requests.',
      errorCode: 'STAFF_REQUESTS_ERROR'
    });
  }
});

module.exports = router;