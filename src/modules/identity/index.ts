export { createAuth, getAuth, type StickerfolioAuth } from "./auth";
export {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
} from "./bootstrap";
export { argon2idParameters, hashPassword, verifyPassword } from "./password";
export {
  createCollectorProfileForUser,
  getIdentityContext,
  type IdentityContext,
  type UserRole,
} from "./profiles";
export { changeOwnPassword } from "./change-password";
export { changeOwnEmail, EmailChangeError } from "./change-email";
export { loginEmailSchema, normalizeEmail } from "./email";
export {
  AuthenticationError,
  requireCollector,
  requireIdentity,
  resolveIdentity,
} from "./session";
