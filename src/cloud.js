// Plata — couche « cloud » : connexion Google + Firestore.
// Ce fichier est assemblé avec le SDK Firebase dans cloud.bundle.js (npm run build).
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, collection, doc, onSnapshot, writeBatch } from 'firebase/firestore';

// Configuration publique du projet Firebase (pas un secret : la protection vient des règles Firestore).
const firebaseConfig = {
  apiKey: 'AIzaSyCvrD8l-bmmVR_Z5WYJ1FI_QItNleGfvwI',
  authDomain: 'plata-4d393.firebaseapp.com',
  projectId: 'plata-4d393',
  storageBucket: 'plata-4d393.firebasestorage.app',
  messagingSenderId: '692947433936',
  appId: '1:692947433936:web:44a13dbe2e72a39b03a1d5'
};
// Un seul utilisateur autorisé (doit rester identique dans firestore.rules).
const ALLOWED_EMAIL = 'benico13300@gmail.com';

let app, auth, db, uid = null;

function init({ persistent }) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Windows : cache durable (IndexedDB) = consultation et saisie hors ligne.
  // Téléphone : cache en mémoire seulement = rien n'est conservé sur l'appareil.
  db = initializeFirestore(app, {
    localCache: persistent ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache()
  });
}

// cb(user | null, errorCode?) — user = { uid, email, name }
function onAuth(cb) {
  getRedirectResult(auth).catch(error => cb(null, error.code || 'auth/error'));
  return onAuthStateChanged(auth, user => {
    if (!user) { uid = null; cb(null); return; }
    if ((user.email || '').toLowerCase() !== ALLOWED_EMAIL || !user.emailVerified) {
      signOut(auth).finally(() => cb(null, 'unauthorized'));
      return;
    }
    uid = user.uid;
    cb({ uid: user.uid, email: user.email, name: user.displayName || user.email });
  });
}

async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', login_hint: ALLOWED_EMAIL });
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    // Pop-up bloquée (certains téléphones / applications installées) : on passe par la redirection.
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw error;
  }
}
const logOut = () => signOut(auth);

const userCol = name => collection(db, 'users', uid, name);

// Écoute comptes, opérations et réglages. Les rappels reçoivent des changements « document par document » :
//   onChanges(kind, [{ type: 'added'|'modified'|'removed', id, data, pending }], { fromCache })
// pending = true quand le document porte une écriture locale pas encore confirmée par le serveur.
function subscribe({ onChanges, onError }) {
  const options = { includeMetadataChanges: true };
  const stops = ['accounts', 'operations'].map(kind => onSnapshot(userCol(kind), options, snapshot => {
    const changes = snapshot.docChanges(options).map(change => ({ type: change.type, id: change.doc.id, data: change.doc.data(), pending: change.doc.metadata.hasPendingWrites }));
    onChanges(kind, changes, { fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites, empty: snapshot.empty });
  }, onError));
  stops.push(onSnapshot(doc(db, 'users', uid, 'settings', 'main'), options, snapshot => {
    const changes = snapshot.exists() ? [{ type: 'modified', id: 'main', data: snapshot.data(), pending: snapshot.metadata.hasPendingWrites }] : [];
    onChanges('settings', changes, { fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites, empty: !snapshot.exists() });
  }, onError));
  return () => stops.forEach(stop => stop());
}

// operations = [{ op: 'set'|'delete', kind: 'accounts'|'operations'|'settings', id, data }]
// Écritures groupées (400 max par lot). N'attend pas le serveur : hors ligne, la promesse reste en attente.
function commit(operations) {
  const refFor = (kind, id) => kind === 'settings' ? doc(db, 'users', uid, 'settings', 'main') : doc(db, 'users', uid, kind, id);
  const jobs = [];
  for (let start = 0; start < operations.length; start += 400) {
    const batch = writeBatch(db);
    operations.slice(start, start + 400).forEach(item => item.op === 'delete' ? batch.delete(refFor(item.kind, item.id)) : batch.set(refFor(item.kind, item.id), item.data));
    jobs.push(batch.commit());
  }
  return Promise.all(jobs);
}

window.PlataCloud = { init, onAuth, signIn, signOut: logOut, subscribe, commit, allowedEmail: ALLOWED_EMAIL };
