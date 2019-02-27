if (
  !process.env.FUNCTION_NAME ||
  process.env.FUNCTION_NAME === 'mediaLibraryFunction'
) {
  exports.mediaLibraryFunction = require('./media-library-function');
}
