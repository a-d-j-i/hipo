import { hash, verify } from "@node-rs/argon2";
import { badRequest } from "@hipo/server";

export async function hashPassword(password: string): Promise<string> {
  return await hash(password);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<void> {
  const ok = await verify(storedHash, password).catch(() => false);
  if (!ok) throw badRequest("wrong username or password");
}
