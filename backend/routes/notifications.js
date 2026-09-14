const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const poolConnection = require('../config/db');

async function executeQuery(query, params = []) {
  const [results] = await poolConnection.execute(query, params);
  return results;
}

/**
 * @route   GET /api/notifications
 * @desc    Get user notifications
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
        whereClause = 'WHERE user_id = ?';
        params = [req.user.id];
      }
      // Staff/Admin: get all unread notifications

      const [rows] = await executeQuery(
        `SELECT n.id, n.title, n.message, n.type, n.related_entity_type, n.related_entity_id,
          n.is_read, n.created_at,
          CASE WHEN n.related_entity_type = 'request' THEN
            (SELECT reference_number FROM requests WHERE id = n.related_entity_id)
          WHEN n.related_entity_type = 'complaint' THEN
            (SELECT title FROM complaints WHERE id = n.related_entity_id)
          END as related_title
          FROM notifications n
          ${whereClause}
          ORDER BY n.created_at DESC`
      );

      // Count unread
      const [unreadCount] = await executeQuery(
        `SELECT COUNT(*) as count FROM notifications n ${whereClause} AND is_read = 0`,
        params.concat([role === 'resident' ? req.user.id : undefined])
      );

      return res.json({
        success: true,
        count: rows.length,
        unreadCount: unreadCount[0]?.count || 0,
        data: rows
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch notifications.',
        errorCode: 'NOTIFICATIONS_FETCH_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put(
  '/:id/read',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;

      const [result] = await executeQuery(
        'UPDATE notifications SET is_read = TRUE WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found.',
          errorCode: 'NOTIFICATION_NOT_FOUND'
        });
      }

      return res.json({
        success: true,
        message: 'Notification marked as read'
      });
    } catch (error) {
      console.error('Mark notification read error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to mark notification as read.',
        errorCode: 'NOTIFICATION_READ_ERROR'
      });
    }
  }
);

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete notification
 * @access  Private
 */
router.delete(
  '/:id',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;

      const [result] = await executeQuery(
        'DELETE FROM notifications WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found.',
          errorCode: 'NOTIFICATION_NOT_FOUND'
        });
      }

      return res.json({
        success: true,
        message: 'Notification deleted'
      });
    } catch (error) {
      console.error('Delete notification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete notification.',
        errorCode: 'NOTIFICATION_DELETE_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put(
  '/read-all',
  authMiddleware.authMiddleware,
  async (req, res) => {
    try {
      const { role } = req.user;

      if (role === 'resident') {
        await executeQuery(
          'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = 0',
          [req.user.id]
        );
      } else if (role === 'staff' || role === 'admin') {
        await executeQuery(
          'UPDATE notifications SET is_read = TRUE WHERE is_read = 0'
        );
      }

      return res.json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      console.error('Mark all notifications read error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to mark all notifications as read.',
        errorCode: 'NOTIFICATIONS_READ_ALL_ERROR'
      });
    }
  }
);

module.exports = router;