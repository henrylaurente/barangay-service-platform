const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const authorize = authMiddleware.authorize;
const poolConnection = require('../config/db');

/**
 * Helper: Execute query
 */
async function executeQuery(query, params = []) {
  const [results] = await poolConnection.execute(query, params);
  return results;
}

/**
 * @route   GET /api/services
 * @desc    Get all service categories
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    const [rows] = await executeQuery(
      'SELECT id, name, description, processing_time_days, processing_fee, status, sort_order FROM service_categories WHERE status = "active" ORDER BY sort_order, name'
    );

    return res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Get services error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch service categories.',
      errorCode: 'SERVICES_FETCH_ERROR'
    });
  }
});

/**
 * @route   GET /api/services/:id
 * @desc    Get single service category by ID
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await executeQuery(
      'SELECT id, name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions FROM service_categories WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service category not found.',
        errorCode: 'SERVICE_CATEGORY_NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('Get service error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch service category.',
      errorCode: 'SERVICE_FETCH_ERROR'
    });
  }
});

/**
 * @route   POST /api/services
 * @desc    Create new service category (Admin only)
 * @access  Admin
 */
router.post(
  '/',
  authMiddleware.authMiddleware,
  authorize('admin'),
  async (req, res) => {
    try {
      const { name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Service category name is required.',
          errorCode: 'SERVICE_NAME_REQUIRED'
        });
      }

      const [result] = await executeQuery(
        'INSERT INTO service_categories (name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name, description, processing_time_days || 3, processing_fee || 0.00, status || 'active', sort_order || 0, required_documents || null, instructions || null]
      );

      const [rows] = await executeQuery(
        'SELECT id, name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions FROM service_categories WHERE id = ?',
        [result.insertId]
      );

      return res.status(201).json({
        success: true,
        message: 'Service category created successfully',
        data: rows[0]
      });
    } catch (error) {
      console.error('Create service error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create service category.',
        errorCode: 'SERVICE_CREATE_ERROR'
      });
    }
  }
);

/**
 * @route   PUT /api/services/:id
 * @desc    Update service category (Admin only)
 * @access  Admin
 */
router.put(
  '/:id',
  authMiddleware.authMiddleware,
  authorize('admin'),
  async (req, res) => {
    try {
    const { id } = req.params;
    const { name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions } = req.body;

    // Check if category exists
    const [existing] = await executeQuery('SELECT id FROM service_categories WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service category not found.',
        errorCode: 'SERVICE_CATEGORY_NOT_FOUND'
      });
    }

    await executeQuery(
      'UPDATE service_categories SET name = ?, description = ?, processing_time_days = ?, processing_fee = ?, status = ?, sort_order = ?, required_documents = ?, instructions = ? WHERE id = ?',
      [name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions, id]
    );

    const [rows] = await executeQuery(
      'SELECT id, name, description, processing_time_days, processing_fee, status, sort_order, required_documents, instructions FROM service_categories WHERE id = ?',
      [id]
    );

    return res.json({
      success: true,
      message: 'Service category updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Update service error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update service category.',
      errorCode: 'SERVICE_UPDATE_ERROR'
    });
  }
});

/**
 * @route   DELETE /api/services/:id
 * @desc    Deactivate service category (Admin only)
 * @access  Admin
 */
router.delete(
  '/:id',
  authMiddleware.authMiddleware,
  authorize('admin'),
  async (req, res) => {
    try {
    const { id } = req.params;

    // Check if category exists and has requests
    const [existing] = await executeQuery('SELECT id, name FROM service_categories WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Service category not found.',
        errorCode: 'SERVICE_CATEGORY_NOT_FOUND'
      });
    }

    // Soft delete - just set status to inactive
    await executeQuery(
      'UPDATE service_categories SET status = ? WHERE id = ?',
      ['inactive', id]
    );

    return res.json({
      success: true,
      message: 'Service category deactivated successfully'
    });
  } catch (error) {
    console.error('Delete service error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to deactivate service category.',
      errorCode: 'SERVICE_DELETE_ERROR'
    });
  }
});

module.exports = router;