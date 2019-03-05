const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

if (
  !process.env.FUNCTION_NAME ||
  process.env.FUNCTION_NAME === 'mediaLibraryFunction'
) {
  exports.mediaLibraryFunction = require('./media-library-function');
}

if (
  !process.env.FUNCTION_NAME ||
  process.env.FUNCTION_NAME === 'processImage'
) {
  exports.processImage = require('./process-image');
}

if (!process.env.FUNCTION_NAME || process.env.FUNCTION_NAME === 'api') {
  exports.api = require('./api');
}
