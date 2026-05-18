// In-memory passphrase context. The user types their backup
// passphrase during bootstrap or when prompted for a scheduled
// backup; we hold it in a React ref for the lifetime of the page,
// derive AES-GCM keys against incoming salts on demand, and clear
// everything on logout (or on hard navigation).
//
// **Never persisted.** Not in localStorage, not in sessionStorage,
// not in IndexedDB. The encrypted backup file is the only durable
// representation of the key material — losing the passphrase means
// losing the ability to decrypt prior backups.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { deriveKey } from "@hipo/backup";

type PassphraseValue = {
  isSet: boolean;
  setPassphrase: (raw: string) => void;
  clear: () => void;
  /**
   * Derive an AES-GCM key for the given salt. Cached per salt-hex so
   * repeated encrypts/decrypts with the same salt skip the Argon2id
   * cost (~190 ms on a 5 MB backup per Spike #4).
   */
  keyFor: (salt: Uint8Array) => Promise<CryptoKey>;
};

const PassphraseContext = createContext<PassphraseValue | null>(null);

function saltHex(salt: Uint8Array): string {
  let out = "";
  for (let i = 0; i < salt.length; i++) {
    out += salt[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function PassphraseProvider({ children }: { children: ReactNode }) {
  // The passphrase and key cache live in refs (they aren't render
  // inputs and we want stable closures). `isSet` is real state so
  // consumers can re-render when it flips.
  const passphraseRef = useRef<string | null>(null);
  const cacheRef = useRef<Map<string, Promise<CryptoKey>>>(new Map());
  const [isSet, setIsSet] = useState(false);

  const setPassphrase = useCallback((raw: string) => {
    passphraseRef.current = raw;
    cacheRef.current = new Map();
    setIsSet(true);
  }, []);

  const clear = useCallback(() => {
    passphraseRef.current = null;
    cacheRef.current = new Map();
    setIsSet(false);
  }, []);

  const keyFor = useCallback(async (salt: Uint8Array): Promise<CryptoKey> => {
    const p = passphraseRef.current;
    if (p === null) throw new Error("passphrase not set");
    const k = saltHex(salt);
    const cached = cacheRef.current.get(k);
    if (cached) return cached;
    const promise = deriveKey(p, salt);
    cacheRef.current.set(k, promise);
    return promise;
  }, []);

  const value = useMemo<PassphraseValue>(
    () => ({ isSet, setPassphrase, clear, keyFor }),
    [isSet, setPassphrase, clear, keyFor],
  );

  return (
    <PassphraseContext.Provider value={value}>
      {children}
    </PassphraseContext.Provider>
  );
}

export function usePassphrase(): PassphraseValue {
  const ctx = useContext(PassphraseContext);
  if (!ctx)
    throw new Error("usePassphrase must be used inside <PassphraseProvider>");
  return ctx;
}
