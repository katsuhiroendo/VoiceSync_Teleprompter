import {
  ScriptItem,
  PrompterSettings,
  DEFAULT_PROMPTER_SETTINGS,
} from '@/types/prompter';

const DB_NAME = 'VoiceSyncTeleprompterDB';
const DB_VERSION = 2;
export const SCRIPTS_STORE = 'scripts';
export const SETTINGS_STORE = 'settings';
export const RECORDING_SESSIONS_STORE = 'recording_sessions';
export const RECORDING_CHUNKS_STORE = 'recording_chunks';
const SETTINGS_KEY = 'user_prompter_settings';

export const DEFAULT_SAMPLE_SCRIPTS: ScriptItem[] = [
  {
    id: 'sample-ja-youtube',
    title: '【サンプル】YouTubeオープニング＆機能紹介（日本語）',
    language: 'ja-JP',
    createdAt: Date.now() - 3600_000,
    updatedAt: Date.now() - 1800_000,
    isFavorite: true,
    content: `皆さんこんにちは！今日も動画をご覧いただき、ありがとうございます。
今回の動画では、カメラ目線を自然に維持しながら撮影できる「VoiceSync Teleprompter」の活用方法について詳しくご紹介します。

YouTubeの撮影をしていると、原稿を確認するためにどうしても目線が下にずれてしまったり、話すスピードとスクロール速度が合わずに焦ってしまったりすることはありませんか？
このテレプロンプターを使えば、あなたが話した言葉をリアルタイムで認識し、原稿の現在位置を特定して自動的にスクロールしてくれます。

ゆっくり考えながら話しても、途中で数秒間沈黙してしまっても大丈夫です。
声のペースに合わせてピタッと止まり、話し始めると再び滑らかに追従を再開します。

また、MacBookの内蔵カメラで撮影する際は、「カメラ目線モード」をオンにしてみてください。
画面の最上部、つまりWebカメラのすぐ真下に現在の文章がコンパクトに表示されるため、視聴者からは完全にカメラを見つめて話しているように見えます。

それでは、実際に設定画面を開いて、文字サイズや行間、フォーカスモードをあなた好みにカスタマイズしてみましょう！`,
  },
  {
    id: 'sample-en-keynote',
    title: '[Sample] Product Keynote Introduction (English)',
    language: 'en-US',
    createdAt: Date.now() - 7200_000,
    updatedAt: Date.now() - 3600_000,
    isFavorite: false,
    content: `Hello everyone, and welcome back to the channel!
Today, we are taking a closer look at VoiceSync Teleprompter, a minimalist, voice-tracking teleprompter designed specifically for creators.

When recording videos on a MacBook or iPad, keeping natural eye contact with the camera lens is one of the biggest challenges.
Traditional teleprompters scroll at a fixed speed, forcing you to rush or wait for the text.

With real-time speech recognition and fuzzy script matching, VoiceSync follows your exact cadence.
Even if you pause for a few seconds, improvise a phrase, or skip ahead to the next paragraph, the teleprompter adapts smoothly without losing your place.

Let's dive right in and explore how it works in real-world studio and outdoor environments.`,
  },
];

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // V1 stores (preserve all existing data)
      if (!db.objectStoreNames.contains(SCRIPTS_STORE)) {
        const store = db.createObjectStore(SCRIPTS_STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
      // V2 stores for Phase 6 long-recording progressive chunk saving & crash recovery
      if (!db.objectStoreNames.contains(RECORDING_SESSIONS_STORE)) {
        const sessionStore = db.createObjectStore(RECORDING_SESSIONS_STORE, {
          keyPath: 'sessionId',
        });
        sessionStore.createIndex('startedAt', 'startedAt', { unique: false });
        sessionStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(RECORDING_CHUNKS_STORE)) {
        const chunkStore = db.createObjectStore(RECORDING_CHUNKS_STORE, {
          keyPath: 'chunkKey',
        });
        chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllScripts(): Promise<ScriptItem[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SCRIPTS_STORE, 'readonly');
      const store = tx.objectStore(SCRIPTS_STORE);
      const req = store.getAll();
      req.onsuccess = async () => {
        const items = (req.result as ScriptItem[]) || [];
        if (items.length === 0) {
          // 初回起動時はサンプル原稿を投入
          for (const sample of DEFAULT_SAMPLE_SCRIPTS) {
            await saveScript(sample);
          }
          resolve([...DEFAULT_SAMPLE_SCRIPTS]);
        } else {
          items.sort((a, b) => b.updatedAt - a.updatedAt);
          resolve(items);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [...DEFAULT_SAMPLE_SCRIPTS];
  }
}

export async function saveScript(script: ScriptItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRIPTS_STORE, 'readwrite');
    const store = tx.objectStore(SCRIPTS_STORE);
    const req = store.put(script);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteScriptById(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRIPTS_STORE, 'readwrite');
    const store = tx.objectStore(SCRIPTS_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function loadPrompterSettings(): Promise<PrompterSettings> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.get(SETTINGS_KEY);
      req.onsuccess = () => {
        if (req.result) {
          resolve({ ...DEFAULT_PROMPTER_SETTINGS, ...req.result });
        } else {
          resolve({ ...DEFAULT_PROMPTER_SETTINGS });
        }
      };
      req.onerror = () => resolve({ ...DEFAULT_PROMPTER_SETTINGS });
    });
  } catch {
    return { ...DEFAULT_PROMPTER_SETTINGS };
  }
}

export async function savePrompterSettings(
  settings: PrompterSettings
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.put(settings, SETTINGS_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore storage fallback errors
  }
}
