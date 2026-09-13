const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const mysql = require('mysql2/promise');
const authMiddleware = require('../middleware/auth.middleware');
const authorize = authMiddleware.authorize;
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/announcements/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `announcement_${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG and PNG images are allowed'), false);
  }
};

const upload = multer({ storage, fileFilter });

/**
 * Helper: Execute query
 */
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
 * @route   GET /api/announcements
 */
router.get('/', async (req, res) => {
  try {
    const { category, expire } = req.query;
    let whereClause = 'WHERE is_active = 1';
    let params = [];

    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }

    if (expire === 'upcoming') {
      whereClause += ' AND expires_at > NOW()';
    }

    const [rows] = await executeQuery(
      `SELECT id, title, content, category, image_path, published_at, expires_at,
        (CASE WHEN expires_at > NOW() THEN 1 ELSE 0 END) as is_valid
       FROM announcements ${whereClause} ORDER BY published_at DESC`,
      params
    );

    return res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Get announcements error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch announcements.',
      errorCode: 'ANNOUNCEMENTS_FETCH_ERROR'
    });
  }
});

/**
 * @route   POST /api/announcements
 * @desc    Create new announcement (Admin only)
 * @access  Admin (Private)
 */
router.post(
  '/',
  authMiddleware.authMiddleware,
  authorize('admin'),
  upload.single('image'),
  async (req, res) => {
    try {
      const { title, content, category } = req.body;
      const imagePath = req.file ? req.file.filename : null;
      const createdBy = req.user.id;

      if (!title || !content || !category) {
        if (req.file) {
          const fs = require('fs');
          const filePath = path.join('uploads/announcements', req.file.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
        return res.status(400).json({
          success: false,
          message: 'Title, content, and category are required.',
          errorCode: 'ANNOUNCEMENT_FIELDS_REQUIRED'
        });
      }

      const announcementId = crypto.randomUUID();
      await executeQuery(
        `INSERT INTO announcements (id, title, content, category, image_path, published_at, created_by) VALUES (?, ?, ?, ?, NOW(), ?)`,
        [announcementId, title, content, category, imagePath, createdBy]
      );

      // Create notification for all residents
      const [residentUsers] = await executeQuery('SELECT id FROM users WHERE role = ?', ['resident']);
      for (const resident of residentUsers) {
        await createNotification(
          resident.id,
          'New Announcement',
          `New announcement: ${title}`,
          'new_announcement',
          'announcement',
          announcementId
        );
      }

      return res.status(201).json({
        success: true,
        message: 'Announcement created successfully',
        data: {
          announcement_id: announcementId,
          title,
          category
        }
      });
    } catch (error) {
      console.error('Create announcement error:', error);
      if (req.file) {
        const fs = require('fs');
        const filePath = path.join('uploads/announcements', req.file.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to create announcement.',
        errorCode: 'ANNOUNCEMENT_CREATE_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/announcements/:id
 * @desc    Update announcement (Admin only)
 * @access  Admin (Private)
 */
router.put(
  '/:id',
  authMiddleware.authMiddleware,
  authorize('admin'),
  upload.single('image'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, content, category } = req.body;

      const [existing] = await executeQuery('SELECT id, image_path FROM announcements WHERE id = ?', [id]);
      if (existing.length === 0) {
        if (req.file) {
          const fs = require('fs');
          const filePath = path.join('uploads/announcements', req.file.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
        return res.status(404).json({
          success: false,
          message: 'Announcement not found.',
          errorCode: 'ANNOUNCEMENT_NOT_FOUND'
        });
      }

      const imagePath = req.file ? req.file.filename : existing[0].image_path;

      await executeQuery(
        'UPDATE announcements SET title = ?, content = ?, category = ?, image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [title, content, category, imagePath, id]
      );

      return res.json({
        success: true,
        message: 'Announcement updated successfully',
        data: {
          announcement_id: id,
          title,
          category
        }
      });
    } catch (error) {
      console.error('Update announcement error:', error);
      if (req.file) {
        const fs = require('fs');
        const filePath = path.join('uploads/announcements', req.file.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to update announcement.',
        errorCode: 'ANNOUNCEMENT_UPDATE_ERROR'
      });
    }
  }
);

/**
 * @route   DELETE /api/announcements/:id
 * @desc    Delete announcement (Admin only)
 * @access  Admin (Private)
 */
router.delete(
  '/:id',
  authMiddleware.authMiddleware,
  authorize('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const [existing] = await executeQuery('SELECT id, image_path FROM announcements WHERE id = ?', [id]);
      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Announcement not found.',
          errorCode: 'ANNOUNCEMENT_NOT_FOUND'
        });
      }

      await executeQuery(
        'UPDATE announcements SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
      );

      if (existing[0].image_path) {
        const fs = require('fs');
        const filePath = path.join('uploads/announcements', existing[0].image_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      return res.json({
        success: true,
        message: 'Announcement deleted successfully'
      });
    } catch (error) {
      console.error('Delete announcement error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to delete announcement.',
        errorCode: 'ANNOUNCEMENT_DELETE_ERROR'
      });
    }
  }
);

module.exports = router;