const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = authMiddleware.authorize;
const poolConnection = require('../config/db');

async function executeQuery(query, params = []) {
  const [results] = await poolConnection.execute(query, params);
  return results;
}

/**
 * KPI Data for Admin Dashboard
 */
router.get('/dashboard', authMiddleware.authMiddleware, authorize('admin'), async (req, res) => {
  try {
    // Total Requests
    const [totalRequests] = await executeQuery('SELECT COUNT(*) as count FROM requests');
    const totalReq = totalRequests[0].count;

    // Pending Requests
    const [pendingRequests] = await executeQuery(
      "SELECT COUNT(*) as count FROM requests WHERE status = 'PENDING'"
    );
    const pending = pendingRequests[0].count;

    // Processing Requests
    const [processingRequests] = await executeQuery(
      "SELECT COUNT(*) as count FROM requests WHERE status IN ('UNDER_REVIEW', 'PROCESSING', 'FOR_VERIFICATION')"
    );
    const processing = processingRequests[0].count;

    // Completed Requests
    const [completedRequests] = await executeQuery(
      "SELECT COUNT(*) as count FROM requests WHERE status = 'COMPLETED'"
    );
    const completed = completedRequests[0].count;

    // Rejected Requests
    const [rejectedRequests] = await executeQuery(
      "SELECT COUNT(*) as count FROM requests WHERE status = 'REJECTED'"
    );
    const rejected = rejectedRequests[0].count;

    // Average Processing Time
    const [avgProcessing] = await executeQuery(
      "SELECT AVG(TIMESTAMPDIFF(DAY, requested_at, actual_completion)) as avg_days FROM requests WHERE actual_completion IS NOT NULL"
    );
    const avgProcessingTime = Math.round(parseFloat(avgProcessing[0].avg_days) || 0) + ' days';

    // Active Residents - count of unique residents with active requests
    const [activeResidents] = await executeQuery(
      "SELECT COUNT(DISTINCT resident_id) as count FROM requests WHERE status != 'CANCELLED'"
    );
    const activeResidentsCount = activeResidents[0].count;

    // Complaints This Month
    const [complaintsThisMonth] = await executeQuery(
      "SELECT COUNT(*) as count FROM complaints WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH) AND status != 'CLOSED'"
    );
    const complaintsMonth = complaintsThisMonth[0].count;

    // Status breakdown
    const [statusBreakdown] = await executeQuery(
      "SELECT status, COUNT(*) as count FROM requests GROUP BY status ORDER BY count DESC"
    );
    const statusData = statusBreakdown.map(item => ({ status: item.status, count: item.count }));

    // Requests by category
    const [categoryBreakdown] = await executeQuery(
      "SELECT sc.name, COUNT(r.id) as count FROM service_categories sc LEFT JOIN requests r ON sc.id = r.category_id GROUP BY sc.id ORDER BY count DESC LIMIT 10"
    );
    const requestsByCategory = categoryBreakdown.map(item => ({ category: item.name, count: item.count }));

    // Completion rate
    const completionRate = totalReq > 0 ? Math.round((completed / totalReq) * 100) : 0;

    // Rejection rate
    const rejectionRate = totalReq > 0 ? Math.round((rejected / totalReq) * 100) : 0;

    // Monthly request trend (last 6 months)
    const [monthlyTrend] = await executeQuery(
      "SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as cnt FROM requests WHERE created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH) GROUP BY month ORDER BY month"
    );
    const monthlyData = monthlyTrend.map(item => ({
      month: item.month,
      count: item.cnt
    }));

    const kpiData = {
      totalRequests: totalReq,
      pendingRequests: pending,
      processingRequests: processing,
      completedRequests: completed,
      rejectedRequests: rejected,
      averageProcessingTime: avgProcessingTime,
      activeResidents: activeResidentsCount,
      complaintsThisMonth: complaintsMonth,
      statusBreakdown: statusData,
      requestsByCategory,
      completionRate,
      rejectionRate,
      monthlyTrend: monthlyData
    };

    return res.json({
      success: true,
      data: kpiData
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data.',
      errorCode: 'ADMIN_DASHBOARD_ERROR'
    });
  }
});

/**
 * Analytics - Requests by Category
 */
router.get('/analytics/category', authMiddleware.authMiddleware, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await executeQuery(
      "SELECT sc.name, sc.processing_time_days, COUNT(r.id) as total_requests, "
      + "SUM(CASE WHEN r.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_requests, "
      + "AVG(TIMESTAMPDIFF(HOUR, r.requested_at, r.actual_completion)) as avg_processing_hours "
      + "FROM service_categories sc LEFT JOIN requests r ON sc.id = r.category_id "
      + "WHERE r.actual_completion IS NOT NULL GROUP BY sc.id ORDER BY total_requests DESC"
    );

    const analytics = rows.map(item => ({
      category: item.name,
      totalRequests: item.total_requests || 0,
      completedRequests: item.completed_requests || 0,
      completionRate: item.total_requests > 0 ? Math.round((item.completed_requests / item.total_requests) * 100) : 0,
      averageProcessingHours: Math.round(item.avg_processing_hours || 0),
      processingTimeDays: item.processing_time_days
    }));

    return res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Category analytics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch category analytics.',
      errorCode: 'CATEGORY_ANALYTICS_ERROR'
    });
  }
});

/**
 * Analytics - Requests by Status (timeline)
 */
router.get('/analytics/status-timeline', authMiddleware.authMiddleware, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await executeQuery(
      "SELECT status, COUNT(*) as count FROM requests GROUP BY status ORDER BY count DESC"
    );

    const statusData = rows.map(item => ({
      status: item.status,
      count: item.count
    }));

    return res.json({
      success: true,
      data: statusData
    });
  } catch (error) {
    console.error('Status timeline error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch status timeline.',
      errorCode: 'STATUS_TIMELINE_ERROR'
    });
  }
});

/**
 * Analytics - Monthly trend
 */
router.get('/analytics/monthly', authMiddleware.authMiddleware, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await executeQuery(
      "SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as new_requests, "
      + "SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed "
      + "FROM requests WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH) "
      + "GROUP BY month ORDER BY month"
    );

    const monthlyData = rows.map(item => ({
      month: item.month,
      newRequests: item.new_requests,
      completed: item.completed
    }));

    return res.json({
      success: true,
      data: monthlyData
    });
  } catch (error) {
    console.error('Monthly analytics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch monthly analytics.',
      errorCode: 'MONTHLY_ANALYTICS_ERROR'
    });
  }
});

/**
 * Staff Performance
 */
router.get('/staff-performance', authMiddleware.authMiddleware, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await executeQuery(
      "SELECT sp.id, sp.full_name, sp.position, sp.department, "
      + "COUNT(ra.id) as assigned_requests, "
      + "SUM(CASE WHEN r.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_requests, "
      + "AVG(TIMESTAMPDIFF(HOUR, ra.assigned_at, r.actual_completion)) as avg_processing_hours "
      + "FROM staff_profiles sp "
      + "LEFT JOIN request_assignments ra ON sp.id = ra.staff_id "
      + "LEFT JOIN requests r ON ra.request_id = r.id AND r.actual_completion IS NOT NULL "
      + "GROUP BY sp.id, sp.full_name, sp.position, sp.department "
      + "ORDER BY assigned_requests DESC"
    );

    const staffData = rows.map(item => ({
      staffId: item.id,
      staffName: item.full_name,
      position: item.position,
      department: item.department,
      assignedRequests: item.assigned_requests || 0,
      completedRequests: item.completed_requests || 0,
      averageProcessingHours: Math.round(item.avg_processing_hours || 0),
      resolutionRate: item.assigned_requests > 0 ? Math.round((item.completed_requests / item.assigned_requests) * 100) : 0
    }));

    return res.json({
      success: true,
      data: staffData
    });
  } catch (error) {
    console.error('Staff performance error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch staff performance.',
      errorCode: 'STAFF_PERFORMANCE_ERROR'
    });
  }
});

/**
 * Audit Logs
 */
router.get('/audit-logs', authMiddleware.authMiddleware, authorize('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 50, action, userId } = req.query;
    let whereClause = '';
    let params = [];

    if (action) {
      whereClause += ' AND action_type = ?';
      params.push(action);
    }
    if (userId) {
      whereClause += ' AND user_id = ?';
      params.push(userId);
    }

    const offset = (Number(page) - 1) * Number(limit);

    const [count] = await executeQuery(
      `SELECT COUNT(*) as total FROM audit_logs WHERE 1=1 ${whereClause}`,
      params
    );

    const [rows] = await executeQuery(
      `SELECT al.id, al.action_type, al.target_type, al.target_id, al.old_value, al.new_value,
        al.ip_address, al.user_agent, al.created_at,
        u.full_name as user_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE 1=1 ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    const auditData = rows.map(item => ({
      id: item.id,
      action: item.action_type,
      target: item.target_type,
      targetId: item.target_id,
      oldValue: item.old_value,
      newValue: item.new_value,
      timestamp: item.created_at,
      user: item.user_name
    }));

    return res.json({
      success: true,
      data: auditData,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count[0].total,
        totalPages: Math.ceil(count[0].total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Audit logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch audit logs.',
      errorCode: 'AUDIT_LOGS_ERROR'
    });
  }
});

/**
 * System Settings (basic)
 */
router.get('/system-settings', authMiddleware.authMiddleware, authorize('admin'), async (req, res) => {
  try {
    const [rows] = await executeQuery('SELECT key, value, description FROM system_settings');

    const settings = rows.reduce((acc, item) => {
      acc[item.key] = {
        value: item.value,
        description: item.description
      };
      return acc;
    }, {});

    return res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('System settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch system settings.',
      errorCode: 'SYSTEM_SETTINGS_ERROR'
    });
  }
});

module.exports = router;