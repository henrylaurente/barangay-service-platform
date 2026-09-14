const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/auth.middleware.js');
const poolConnection = require('../config/db');

async function executeQuery(query, params = []) {
  const [results] = await poolConnection.execute(query, params);
  return results;
}

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/register',
  [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail()
      .custom(async (value) => {
        const [rows] = await executeQuery('SELECT id FROM users WHERE email = ?', [value]);
        if (rows.length > 0) {
          throw new Error('Email already registered');
        }
        return true;
      }),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/[A-Z]/)
      .withMessage('Password must contain at least one uppercase letter')
      .matches(/[a-z]/)
      .withMessage('Password must contain at least one lowercase letter')
      .matches(/[0-9]/)
      .withMessage('Password must contain at least one number'),
    // SECURITY FIX: Restrict public registration to resident role only
    body('role')
      .isIn(['resident'])
      .withMessage('Role must be resident'),
    body('fullName')
      .trim()
      .notEmpty()
      .withMessage('Full name is required'),
    body('mobileNumber')
      .trim()
      .notEmpty()
      .withMessage('Mobile number is required')
      .matches(/^09\d{9}$/)
      .withMessage('Please provide a valid Philippine mobile number (starts with 09, 11 digits)'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'REGISTRATION_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const { email, password, role, fullName, mobileNumber } = req.body;

      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Generate UUID for user
      const userId = crypto.randomUUID();

      // Create user
      await executeQuery(
        'INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [userId, email, passwordHash, role]
      );

      // Create resident or staff profile
      if (role === 'resident') {
        const profileId = crypto.randomUUID();
        await executeQuery(
          'INSERT INTO resident_profiles (id, user_id, full_name, mobile_number, purok, barangay_id) VALUES (?, ?, ?, ?, ?, ?)',
          [profileId, userId, fullName, mobileNumber, 'Purok 1', 'BRGY-2024']
        );
      } else if (role === 'staff') {
        const profileId = crypto.randomUUID();
        const employeeId = `STF-${String(Math.floor(Math.random() * 899) + 100)}`;
        await executeQuery(
          'INSERT INTO staff_profiles (id, user_id, full_name, position, department, employee_id) VALUES (?, ?, ?, ?, ?, ?)',
          [profileId, userId, fullName, 'Staff', 'Records Section', employeeId]
        );
      }
      // Admin: no separate profile

      // Generate JWT token
      const token = jwt.sign(
        { id: userId, email, role },
        process.env.JWT_ACCESS_TOKEN_SECRET,
        { expiresIn: '15m' }
      );

      // Generate refresh token
      const refreshToken = jwt.sign(
        { id: userId, email, role },
        process.env.JWT_REFRESH_TOKEN_SECRET,
        { expiresIn: '30d' }
      );

      // SECURITY FIX: Set refresh token as HttpOnly cookie
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      return res.status(201).json({
        success: true,
        message: 'Account registered successfully',
        data: {
          user: {
            id: userId,
            email,
            role
          },
          token
          // refreshToken removed from body
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({
        success: false,
        message: 'Registration failed. Please try again.',
        errorCode: 'REGISTRATION_FAILED'
      });
    }
  }
);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post(
  '/login',
  [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errorCode: 'LOGIN_VALIDATION_ERROR',
          details: errors.array()
        });
      }

      const { email, password } = req.body;

      // Find user
      const [rows] = await executeQuery('SELECT * FROM users WHERE email = ?', [email]);
      if (rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.',
          errorCode: 'AUTH_INVALID_CREDENTIALS'
        });
      }

      const user = rows[0];

      // Check password
      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.',
          errorCode: 'AUTH_INVALID_CREDENTIALS'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_ACCESS_TOKEN_SECRET,
        { expiresIn: '15m' }
      );

      // Generate refresh token
      const refreshToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_REFRESH_TOKEN_SECRET,
        { expiresIn: '30d' }
      );

      // SECURITY FIX: Set refresh token as HttpOnly cookie
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user.id,
            email: user.email,
            role: user.role
          },
          token
          // refreshToken removed from body
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({
        success: false,
        message: 'Login failed. Please try again.',
        errorCode: 'LOGIN_FAILED'
      });
    }
  }
);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthenticated.',
        errorCode: 'AUTH_NOT_AUTHENTICATED'
      });
    }

    const [rows] = await executeQuery(
      'SELECT u.id, u.email, u.role, rp.full_name, rp.mobile_number, rp.purok, rp.barangay_id, sp.position, sp.employee_id FROM users u LEFT JOIN resident_profiles rp ON u.id = rp.user_id LEFT JOIN staff_profiles sp ON u.id = sp.user_id WHERE u.id = ?',
      [req.user.id]
    );

    const user = rows[0];
    let profileInfo;

    if (user.role === 'resident') {
      profileInfo = {
        fullName: user.full_name,
        mobileNumber: user.mobile_number,
        purok: user.purok,
        barangayId: user.barangay_id
      };
    } else if (user.role === 'staff') {
      profileInfo = {
        fullName: user.full_name,
        position: user.position,
        employeeId: user.employee_id,
        department: 'Records Section'
      };
    } else {
      profileInfo = { role: 'admin' };
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: profileInfo
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get user profile.',
      errorCode: 'USER_PROFILE_ERROR'
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authMiddleware, async (req, res) => {
  // Clear the refresh token cookie
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });

  // Optional: add token to blacklist (not implemented here)

  res.json({
    success: true,
    message: 'Logout successful'
  });
});

module.exports = router;