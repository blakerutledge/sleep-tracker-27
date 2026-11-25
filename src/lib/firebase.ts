import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyBSASmvoqB4c7GlVAud8_TlloNcTVTvZnk',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'sleep-tracker-27.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'sleep-tracker-27',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'sleep-tracker-27.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '463351681825',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:463351681825:web:b304d1551169cc9f9c6460',
};

export const ALLOWED_EMAILS = [
  'blake@blakerutledge.com',
  'aliyana.gewirtzman@gmail.com',
] as const;

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (ALLOWED_EMAILS as readonly string[]).includes(normalized);
}

const existingApp = getApps()[0];
export const app = existingApp ?? initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);

let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch {
  firestoreInstance = getFirestore(app);
}
export const db: Firestore = firestoreInstance;

// Do NOT pass an `hd` domain restriction: Blake uses Google Workspace custom domain
// (`blakerutledge.com`) while Aliyana uses standard `@gmail.com`.
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return signOut(auth);
}
