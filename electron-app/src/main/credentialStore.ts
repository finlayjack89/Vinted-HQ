/**
 * Keychain credential storage for Vinted login autofill.
 */

import keytar from 'keytar';

const SERVICE_NAME = 'VintedUKSniper';
const ACCOUNT_NAME = 'vinted-login';
const USERNAME_KEY = 'username';
const PASSWORD_KEY = 'password';

export type LoginCredentials = {
  username: string;
  password: string;
};

export async function saveLoginCredentials(credentials: LoginCredentials): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, `${ACCOUNT_NAME}:${USERNAME_KEY}`, credentials.username);
  await keytar.setPassword(SERVICE_NAME, `${ACCOUNT_NAME}:${PASSWORD_KEY}`, credentials.password);
}

export async function getLoginCredentials(): Promise<LoginCredentials | null> {
  const username = await keytar.getPassword(SERVICE_NAME, `${ACCOUNT_NAME}:${USERNAME_KEY}`);
  const password = await keytar.getPassword(SERVICE_NAME, `${ACCOUNT_NAME}:${PASSWORD_KEY}`);
  if (!username || !password) return null;
  return { username, password };
}

export async function hasLoginCredentials(): Promise<boolean> {
  return (await getLoginCredentials()) !== null;
}

export async function clearLoginCredentials(): Promise<void> {
  await keytar.deletePassword(SERVICE_NAME, `${ACCOUNT_NAME}:${USERNAME_KEY}`);
  await keytar.deletePassword(SERVICE_NAME, `${ACCOUNT_NAME}:${PASSWORD_KEY}`);
}
