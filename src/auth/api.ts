import { invoke } from "@tauri-apps/api/core";
import type { AuthStatus } from "../bindings/AuthStatus";
import type { Role } from "../bindings/Role";
import type { User } from "../bindings/User";

export const authStatus = () => invoke<AuthStatus>("auth_status");

export const setupFirstAdmin = (args: { username: string; password: string }) =>
  invoke<User>("setup_first_admin", args);

export const login = (args: { username: string; password: string }) =>
  invoke<User>("login", args);

export const logout = () => invoke<null>("logout");

export const currentUser = () => invoke<User | null>("current_user");

export const changePassword = (args: {
  oldPassword: string;
  newPassword: string;
}) => invoke<null>("change_password", args);

export const listUsers = () => invoke<User[]>("list_users");

export const createUser = (args: {
  username: string;
  password: string;
  role: Role;
}) => invoke<User>("create_user", args);

export const deleteUser = (args: { id: number }) =>
  invoke<null>("delete_user", args);

export const resetUserPassword = (args: { id: number; newPassword: string }) =>
  invoke<null>("reset_user_password", args);

export const changeUserRole = (args: { id: number; role: Role }) =>
  invoke<null>("change_user_role", args);
