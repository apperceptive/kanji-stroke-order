import { initializeApp, cert, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';

export interface KanjiDoc {
  character: string;
  stroke_count: number | null;
  strokes: {
    mincho?: { svg: string };
    kaisho?: { svg: string };
  };
}

let initialized = false;

async function ensureInit(): Promise<void> {
  if (initialized || getApps().length > 0) {
    initialized = true;
    return;
  }

  const projectId = process.env.FIRESTORE_PROJECT_ID;
  if (!projectId) throw new Error('FIRESTORE_PROJECT_ID env var is required');

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const require = createRequire(import.meta.url);
    const serviceAccount = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    initializeApp({ credential: cert(serviceAccount), projectId });
  } else {
    initializeApp({ credential: applicationDefault(), projectId });
  }

  initialized = true;
}

export async function getKanji(character: string): Promise<KanjiDoc | null> {
  await ensureInit();
  const db = getFirestore();
  const snap = await db.collection('kanji').doc(character).get();
  if (!snap.exists) return null;
  return snap.data() as KanjiDoc;
}
