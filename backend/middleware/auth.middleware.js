const jwt = require('jsonwebtoken');

/**
 * JWT Authentication Middleware
 * Protects routes by verifying a valid JWT access token
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
        errorCode: 'AUTH_TOKEN_MISSING'
      });
    }

    const token = authHeader.split(' ')[1]; // "Bearer <token>"

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Token format is invalid.',
        errorCode: 'AUTH_TOKEN_INVALID'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET);

    // Attach user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token has expired.',
        errorCode: 'AUTH_TOKEN_EXPIRED'
      });
    }

    return res.status(403).json({
      success: false,
      message: 'Invalid or tampered token.',
      errorCode: 'AUTH_TOKEN_INVALID'
    });
  }
};

/**
 * Role-Based Authorization Middleware
 * Allows access only to users with specified roles
 * @param {Array} allowedRoles - Array of role names allowed to access
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthenticated.',
        errorCode: 'AUTH_NOT_AUTHENTICATED'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Insufficient permissions.',
        errorCode: 'AUTH_INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

/**
 * Optional middleware for role check without authentication failure
 * Useful for endpoints that may or may not require auth
 */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET);
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role
      };
    }
    next();
  } catch (error) {
    // If token is invalid, just continue without setting req.user
    // The endpoint can check if req.user exists
    next();
  }
};

module.exports = {
  authMiddleware,
  authorize,
  optionalAuth
};