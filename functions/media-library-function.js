const functions = require('firebase-functions');

exports = module.exports = functions.https.onRequest((request, response) => {
  response.send('Hello from media-library-function!');
});
