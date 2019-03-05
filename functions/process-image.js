const functions = require('firebase-functions');
const admin = require('firebase-admin');
//admin.initializeApp();
const db = admin.firestore();
const vision = require('@google-cloud/vision');
const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');
const uuid = require('uuid-v4');

exports = module.exports = functions.storage
  .object()
  .onFinalize(async (object) => {
    // gather source file info
    const filePath = object.name; // folder/file.jpg
    const fileName = path.basename(filePath); // file.jpg
    const fileDir = path.dirname(filePath); // folder - image ID in this application
    const contentType = object.contentType; // image/jpeg
    const metageneration = object.metageneration; // 1

    // exit if not an image
    if (!contentType.startsWith('image/')) {
      console.log(`${fileName} is not an image.`);
      return null;
    }

    // exit if this is not a new image to process
    if (!metageneration === 1) {
      console.log(`${fileName} is not a new image.`);
      return null;
    }

    const repros = [
      {
        name: 'thumbnail',
        prefix: 'thumb_',
        height: 200,
        width: 200,
        conversionType: '-thumbnail'
      },
      {
        name: 'small',
        prefix: 'small_',
        height: 400,
        width: 400,
        conversionType: '-resize'
      }
    ];

    // exit if image is a reproduction, that is, an image we previously created through this process
    for (const repro of repros) {
      if (fileName.startsWith(repro.prefix)) {
        console.log(`${fileName} is a reproduction.`);
        return null;
      }
    }

    // Cloud Storage
    const fileBucket = object.bucket; // project.appspot.com
    const bucket = admin.storage().bucket(fileBucket); // Bucket { ... }
    const sourceFile = bucket.file(filePath); // File { ... }

    // Cloud Vision
    const visionClient = new vision.ImageAnnotatorClient();
    const visionFile = `gs://${bucket.name}/${filePath}`;
    // labels
    const labelsResults = await visionClient.labelDetection(visionFile);
    // write labels to DB
    await db
      .collection('labels')
      .doc(fileDir)
      .set({ labels: labelsResults[0].labelAnnotations });
    // safeSearch
    const safeSearchResults = await visionClient.safeSearchDetection(
      visionFile
    );
    // write safeSearch to DB
    await db
      .collection('safeSearch')
      .doc(fileDir)
      .set({ safeSearch: safeSearchResults[0].safeSearchAnnotation });
    // webDetection
    const webDetectionResults = await visionClient.webDetection(visionFile);
    // write webDetection to DB
    await db
      .collection('webDetection')
      .doc(fileDir)
      .set({ webDetection: webDetectionResults[0].webDetection });

    // temporary local source file
    const tempSourceFilePath = path.join(os.tmpdir(), fileName); // /tmp/file.jpg
    // download source
    await sourceFile.download({ destination: tempSourceFilePath });

    // retrieve exif metadata
    const exifResult = await spawn(
      'identify',
      ['-verbose', tempSourceFilePath],
      { capture: ['stdout', 'stderr'] }
    );
    // Save exif metadata to database
    const exifMetadata = imageMagickOutputToObject(exifResult.stdout);
    await db
      .collection('exif')
      .doc(fileDir)
      .set(exifMetadata);

    // create a reproduction for each repro
    for (const repro of repros) {
      const reproFileName = `${repro.prefix}${fileName}`; // thumb_file.jpg
      const tempReproFilePath = path.join(os.tmpdir(), reproFileName); // /tmp/thumb_file.jpg
      // create repro
      await spawn(
        'convert',
        [
          tempSourceFilePath,
          repro.conversionType,
          `${repro.width}x${repro.height}>`,
          tempReproFilePath
        ],
        { capture: ['stdout', 'stderr'] }
      );

      // repro file upload - need to set the options we want
      const reproFilePath = path.join(fileDir, reproFileName); // folder/thumb_file.jpg
      const token = uuid();
      const options = {
        destination: reproFilePath,
        uploadType: 'media',
        metadata: {
          contentType: contentType,
          metadata: {
            firebaseStorageDownloadTokens: token
          }
        }
      };
      const res = await bucket.upload(tempReproFilePath, options);
      // contruct the download url and store it
      const reproUrl = `https://firebasestorage.googleapis.com/v0/b/${fileBucket}/o/${encodeURIComponent(
        res[0].name
      )}?alt=media&token=${
        res[0].metadata.metadata.firebaseStorageDownloadTokens
      }`;
      await db
        .collection('images')
        .doc(fileDir)
        .set({ repros: { [repro.name]: reproUrl } }, { merge: true });
      fs.unlinkSync(tempReproFilePath);
    }
    fs.unlinkSync(tempSourceFilePath);

    return console.log(`${fileName} processing complete, cleanup successful`);
  });

/**
 * Convert the output of ImageMagick `identify -verbose` command to a JavaScript Object.
 */
function imageMagickOutputToObject(output) {
  let previousLineIndent = 0;
  const lines = output.match(/[^\r\n]+/g);
  lines.shift(); // Remove First line
  lines.forEach((line, index) => {
    const currentIdent = line.search(/\S/);
    line = line.trim();
    if (line.endsWith(':')) {
      lines[index] = makeKeyFirebaseCompatible(`"${line.replace(':', '":{')}`);
    } else {
      const split = line.replace('"', '\\"').split(': ');
      split[0] = makeKeyFirebaseCompatible(split[0]);
      lines[index] = `"${split.join('":"')}",`;
    }
    if (currentIdent < previousLineIndent) {
      lines[index - 1] = lines[index - 1].substring(
        0,
        lines[index - 1].length - 1
      );
      lines[index] =
        new Array(1 + (previousLineIndent - currentIdent) / 2).join('}') +
        ',' +
        lines[index];
    }
    previousLineIndent = currentIdent;
  });
  output = lines.join('');
  output = '{' + output.substring(0, output.length - 1) + '}'; // remove trailing comma.
  output = JSON.parse(output);
  // console.log('Metadata extracted from image', output);
  return output;
}

/**
 * Makes sure the given string does not contain characters that can't be used as Firebase
 * Realtime Database keys such as '.' and replaces them by '*'.
 */
function makeKeyFirebaseCompatible(key) {
  return key.replace(/\./g, '*');
}
