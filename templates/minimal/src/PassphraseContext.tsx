// In-memory passphrase context. The user types their backup passphrase
// during bootstrap; we hold it in a React ref for the lifetime of the page,
// derive AES-GCM keys against incoming salts on demand, and clear everything
// on logout or hard navigation.
//
// Mirror of apps/frontend/src/bootstrap/PassphraseContext.tsx.
// **Never persisted** — only the encrypted backup file holds durable key material.

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
   * repeated encrypt/decrypt calls with the same salt skip the Argon2id
   * KDF cost (~190 ms per Spike #4).
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
