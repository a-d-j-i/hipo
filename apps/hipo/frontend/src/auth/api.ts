import { httpRequest } from "../api/http";
import type { AuthStatus } from "@hipo/shared";
import type { Role } from "@hipo/shared";
import type { User } from "@hipo/shared";

export const authStatus = () =>
  httpRequest<AuthStatus>("GET", "/api/auth/status");

export const setupFirstAdmin = (args: { username: string; password: string }) =>
  httpRequest<User>("POST", "/api/auth/setup", args);

export const login = (args: { username: string; password: string }) =>
  httpRequest<User>("POST", "/api/auth/login", args);

export const logout = () => httpRequest<null>("POST", "/api/auth/logout");

export const currentUser = () =>
  httpRequest<User | null>("GET", "/api/auth/me");

export const changePassword = (args: {
  oldPassword: string;
  newPassword: string;
}) => httpRequest<null>("POST", "/api/auth/change_password", args);

export const listUsers = () => httpRequest<User[]>("GET", "/api/users");

export const createUser = (args: {
  username: string;
  password: string;
  role: Role;
}) => httpRequest<User>("POST", "/api/users", args);

export const deleteUser = (args: { id: number }) =>
  httpRequest<null>("DELETE", `/api/users/${args.id}`);

export const resetUserPassword = (args: { id: number; newPassword: string }) =>
  httpRequest<null>("POST", `/api/users/${args.id}/reset_password`, {
    newPassword: args.newPassword,
  });

export const changeUserRole = (args: { id: number; role: Role }) =>
  httpRequest<null>("POST", `/api/users/${args.id}/role`, { role: args.role });
