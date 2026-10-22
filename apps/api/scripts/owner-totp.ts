// Makes the secret for signing in with an authenticator app when the server has no SMS provider.
//   npx tsx apps/api/scripts/owner-totp.ts
// Prints a new secret and the otpauth:// link to add it to an authenticator app. Put the secret in OWNER_TOTP_SECRET
// on the server (with your number in OWNER_PHONES); never commit it. Run it again for a different secret.
import { randomBytes } from 'node:crypto';
import { encodeBase32 } from '../src/lib/totp';

const secret = encodeBase32(randomBytes(20)); // 160 bits: 32 characters
const link = `otpauth://totp/Spendly%20AI:owner?secret=${secret}&issuer=Spendly%20AI&digits=6&period=30`;

console.log(`
Secret (OWNER_TOTP_SECRET):
  ${secret}

Add it to your authenticator app (Google Authenticator, 1Password, Authy, …):
  choose "Enter a setup key", account "Spendly AI", key = the secret above, type "time based".
  Or open this link on the phone that has the app:
  ${link}

Then set these on the server (Render → Environment), and redeploy:
  OWNER_PHONES=+91XXXXXXXXXX      your mobile number; several can be comma-separated
  OWNER_TOTP_SECRET=${secret}

Keep the secret private: anyone who has it can sign in as an owner.
`);
