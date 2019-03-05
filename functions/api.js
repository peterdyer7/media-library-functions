const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const uuid = require('uuid-v4');

const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const authenticate = async (req, res, next) => {
  if (
    !req.headers.authorization ||
    !req.headers.authorization.startsWith('Bearer ')
  ) {
    res.status(403).send('Unauthorized');
    return;
  }
  const idToken = req.headers.authorization.split('Bearer ')[1];
  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    console.log('Token: ', decodedIdToken);
    if (decodedIdToken.admin === true) {
      req.user = decodedIdToken;
      next();
      return;
    } else {
      throw new Error('User not an admin');
    }
  } catch (e) {
    res.status(403).send('Unauthorized');
    return;
  }
};

app.use(authenticate);

app.post('/claim', async (req, res) => {
  try {
    const claim = req.body;
    const uid = claim.uid;

    const res1 = await admin.auth().setCustomUserClaims(uid, { admin: true });

    res.status(200).json({ data: res1 });
  } catch (err) {
    console.log('[POST /claim]', err.message);
    res.sendStatus(500);
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await admin.auth().listUsers();
    res.status(200).json({ data: users });
  } catch (err) {
    console.log('[GET /users]', err.message);
    res.sendStatus(500);
  }
});

app.post('/users', async (req, res) => {
  try {
    const user = req.body;
    const res1 = await admin
      .auth()
      .createUser({ email: user.email, password: user.password });
    const res2 = await db
      .collection('users')
      .doc(res1.uid)
      .set({
        email: user.email,
        company: user.company,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        terms: user.terms,
        uid: res1.uid
      });

    res.status(200).json({ data: user });
  } catch (err) {
    console.log('[POST /users]', err.message);
    res.sendStatus(500);
  }
});

app.delete('/users', async (req, res) => {
  try {
    // delete users from Firebase auth
    const { users } = await admin.auth().listUsers();
    for (let user of users) {
      if (user.email !== 'peter_dyer@hotmail.com') {
        await admin.auth().deleteUser(user.uid);
      }
    }
    // delete users from Firestore
    const querySnapshot = await db.collection('users').get();
    querySnapshot.forEach(async (doc) => {
      if (doc.data().email !== 'peter_dyer@hotmail.com') {
        await db
          .collection('users')
          .doc(doc.id)
          .delete();
      }
    });
    res.status(200).end();
  } catch (err) {
    console.log('[DELETE /users]', err.message);
    res.sendStatus(500);
  }
});

app.get('/properties', async (req, res) => {
  try {
    const properties = {};
    const querySnapshot = await db.collection('properties').get();
    querySnapshot.forEach(async (doc) => {
      properties[doc.id] = doc.data();
    });
    res.status(200).json({ data: properties });
  } catch (err) {
    console.log('[GET /properties]', err.message);
    res.sendStatus(500);
  }
});

app.post('/properties', async (req, res) => {
  try {
    const properties = req.body;
    for (let property of properties) {
      await db
        .collection('properties')
        .doc(property.id)
        .set(property);
    }
    res.status(200).json({ data: properties });
  } catch (err) {
    console.log('[POST /properties]', err.message);
    res.sendStatus(500);
  }
});

app.delete('/properties', async (req, res) => {
  try {
    const querySnapshot = await db.collection('properties').get();
    querySnapshot.forEach(async (doc) => {
      await db
        .collection('properties')
        .doc(doc.id)
        .delete();
    });
    res.status(200).end();
  } catch (err) {
    console.log('[DELETE /properties]', err.message);
    res.sendStatus(500);
  }
});

app.get('/properties/:id', async (req, res) => {
  try {
    let property = {};
    const doc = await db
      .collection('properties')
      .doc(req.params.id)
      .get();
    property = doc.data();
    res.status(200).json({ data: property });
  } catch (err) {
    console.log('[GET /properties/:id]', err.message);
    res.sendStatus(500);
  }
});

app.get('/settings', async (req, res) => {
  try {
    const settings = {};
    const querySnapshot = await db.collection('settings').get();
    querySnapshot.forEach(async (doc) => {
      settings[doc.id] = doc.data();
    });
    res.status(200).json({ data: settings });
  } catch (err) {
    console.log('[GET /settings]', err.message);
    res.sendStatus(500);
  }
});

app.post('/settings', async (req, res) => {
  try {
    const settings = req.body;
    await db
      .collection('settings')
      .doc('imageMetadata')
      .set(settings);
    res.status(200).json({ data: settings });
  } catch (err) {
    console.log('[POST /settings]', err.message);
    res.sendStatus(500);
  }
});

app.delete('/settings', async (req, res) => {
  try {
    await db
      .collection('settings')
      .doc('imageMetadata')
      .delete();
    res.status(200).end();
  } catch (err) {
    console.log('[DELETE /settings]', err.message);
    res.sendStatus(500);
  }
});

app.post('/images', async (req, res) => {
  try {
    const images = req.body;

    for (let image of images) {
      const token = uuid();
      const options = {
        destination: `${image.id}/${image.fileName}`,
        uploadType: 'media',
        metadata: {
          contentType: image.type,
          metadata: {
            firebaseStorageDownloadTokens: token
          }
        }
      };
      const res1 = await admin
        .storage()
        .bucket()
        .upload(`${image.sourceFolder}\\${image.fileName}`, options);

      const fileBucket = 'ml-dev-18bc4.appspot.com';
      const url = `https://firebasestorage.googleapis.com/v0/b/${fileBucket}/o/${encodeURIComponent(
        res1[0].name
      )}?alt=media&token=${
        res1[0].metadata.metadata.firebaseStorageDownloadTokens
      }`;
      const dateNow = new Date();
      const res2 = await db
        .collection('images')
        .doc(image.id)
        .set({
          active: image.active,
          caption: image.caption,
          id: image.id,
          name: image.fileName,
          primaryCategory: image.primaryCategory,
          secondaryCategory: image.secondaryCategory,
          tags: image.tags,
          properties: image.properties,
          size: image.size,
          type: image.type,
          status: image.status,
          lastModifiedDate: dateNow,
          uploaded: dateNow,
          updated: dateNow,
          url
        });
    }
    res.status(200).json({ data: images });
  } catch (err) {
    console.log('[POST /images]', err.message);
    res.sendStatus(500);
  }
});

app.get('/images', async (req, res) => {
  try {
    const images = {};
    const querySnapshot = await db.collection('images').get();
    querySnapshot.forEach(async (doc) => {
      images[doc.id] = doc.data();
    });
    res.status(200).json({ data: images });
  } catch (err) {
    console.log('[GET /images]', err.message);
    res.sendStatus(500);
  }
});

app.get('/images/:id', async (req, res) => {
  try {
    let image = {};
    const doc = await db
      .collection('images')
      .doc(req.params.id)
      .get();
    image = doc.data();
    res.status(200).json({ data: image });
  } catch (err) {
    console.log('[GET /images/:id]', err.message);
    res.sendStatus(500);
  }
});

app.delete('/images/:id', async (req, res) => {
  try {
    let image = {};
    const doc = await db
      .collection('images')
      .doc(req.params.id)
      .get();
    image = doc.data();

    // delete files from storage (if the file exists)
    try {
      await admin
        .storage()
        .bucket()
        .file(`${image.id}/thumb_${image.name}`)
        .delete();
    } catch (e) {
      console.log(`${image.id}/thumb_${image.name} could not be deleted.`);
    }
    try {
      await admin
        .storage()
        .bucket()
        .file(`${image.id}/small_${image.name}`)
        .delete();
    } catch (e) {
      console.log(`${image.id}/small_${image.name} could not be deleted.`);
    }
    try {
      await admin
        .storage()
        .bucket()
        .file(`${image.id}/${image.name}`)
        .delete();
    } catch (e) {
      console.log(`${image.id}/${image.name} could not be deleted.`);
    }
    // delete image from Firestore
    await db
      .collection('images')
      .doc(image.id)
      .delete();
    // exif
    await db
      .collection('exif')
      .doc(image.id)
      .delete();
    // labels
    await db
      .collection('labels')
      .doc(image.id)
      .delete();
    // safeSearch
    await db
      .collection('safeSearch')
      .doc(image.id)
      .delete();
    // webDetection
    await db
      .collection('webDetection')
      .doc(image.id)
      .delete();
    res.status(200).end();
  } catch (err) {
    console.log('[GET /images/:id]', err.message);
    res.sendStatus(500);
  }
});

app.get('/files', async (req, res) => {
  try {
    const [files] = await admin
      .storage()
      .bucket()
      .getFiles();
    res.status(200).json({ data: files.map((file) => file.name) });
  } catch (err) {
    console.log('[GET /files]', err.message);
    res.sendStatus(500);
  }
});

app.delete('/files', async (req, res) => {
  try {
    // delete files from storage
    const [files] = await admin
      .storage()
      .bucket()
      .getFiles();
    for (let file of files) {
      await admin
        .storage()
        .bucket()
        .file(file.name)
        .delete();
    }
    // delete images from Firestore
    let querySnapshot;
    // images
    querySnapshot = await db.collection('images').get();
    querySnapshot.forEach(async (doc) => {
      await db
        .collection('images')
        .doc(doc.id)
        .delete();
    });
    // exif
    querySnapshot = await db.collection('exif').get();
    querySnapshot.forEach(async (doc) => {
      await db
        .collection('exif')
        .doc(doc.id)
        .delete();
    });
    // labels
    querySnapshot = await db.collection('labels').get();
    querySnapshot.forEach(async (doc) => {
      await db
        .collection('labels')
        .doc(doc.id)
        .delete();
    });
    // safeSearch
    querySnapshot = await db.collection('safeSearch').get();
    querySnapshot.forEach(async (doc) => {
      await db
        .collection('safeSearch')
        .doc(doc.id)
        .delete();
    });
    // webDetection
    querySnapshot = await db.collection('webDetection').get();
    querySnapshot.forEach(async (doc) => {
      await db
        .collection('webDetection')
        .doc(doc.id)
        .delete();
    });
    res.status(200).end();
  } catch (err) {
    console.log('[DELETE /files]', err.message);
    res.sendStatus(500);
  }
});

app.get('/:id', (req, res) => {
  try {
    res.status(200).json({ data: { id: req.params.id } });
  } catch (err) {
    console.log('[GET /:id]', err.message);
    res.sendStatus(500);
  }
});

exports = module.exports = functions.https.onRequest(app);
