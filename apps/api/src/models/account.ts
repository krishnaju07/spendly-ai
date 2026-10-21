import { Schema, model, type Types } from 'mongoose';
import { DEFAULT_TIMEZONE, RANGE_PRESETS } from '@spendly/shared';

export interface UserDoc {
  _id: Types.ObjectId;
  /** E.164 (`+919876543210`). Null only for demo workspaces, which have no sign-in. */
  phone: string | null;
  name: string;
  isDemo: boolean;
  demoExpiresAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    phone: { type: String, default: null, trim: true, maxlength: 16 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    isDemo: { type: Boolean, default: false },
    demoExpiresAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);
// partial, so the many demo workspaces (phone: null) do not collide with each other
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ isDemo: 1, demoExpiresAt: 1 });

export const User = model<UserDoc>('User', userSchema);

/** One texted sign-in code. Only a keyed hash of the code is stored. */
export interface OtpChallengeDoc {
  _id: Types.ObjectId;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

const otpChallengeSchema = new Schema<OtpChallengeDoc>(
  {
    phone: { type: String, required: true, maxlength: 16 },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
otpChallengeSchema.index({ phone: 1, createdAt: -1 });
// a code is only valid for minutes, but the record stays an hour so the per-number hourly send cap can count it
otpChallengeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

export const OtpChallenge = model<OtpChallengeDoc>('OtpChallenge', otpChallengeSchema);

export interface SessionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  userAgent: string;
  ip: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true },
    userAgent: { type: String, default: '', maxlength: 300 },
    ip: { type: String, default: '', maxlength: 64 },
    lastSeenAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<SessionDoc>('Session', sessionSchema);

export interface UserPreferenceDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  theme: 'light' | 'dark' | 'system';
  timezone: string;
  currency: 'INR';
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  weekStartsOn: 1 | 7;
  incomeTracking: boolean;
  defaultRange: string;
  ai: { enabled: boolean; shareMerchantNames: boolean; classifyUnknownMerchants: boolean; readReceipts: boolean; consentedAt: Date | null };
  notifications: { budgetAlerts: boolean; upcomingPayments: boolean; importUpdates: boolean; insights: boolean };
  consents: { emailImport: boolean; emailImportAt: Date | null };
  tracking: { platforms: string[]; consentedAt: Date | null };
  onboardingCompleted: boolean;
}

const userPreferenceSchema = new Schema<UserPreferenceDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    // dark is the default look; "system" follows the device
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'dark' },
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    dateFormat: { type: String, enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'], default: 'DD/MM/YYYY' },
    weekStartsOn: { type: Number, enum: [1, 7], default: 1 },
    incomeTracking: { type: Boolean, default: true },
    defaultRange: { type: String, enum: RANGE_PRESETS.filter((p) => p !== 'custom'), default: 'this_month' },
    ai: {
      enabled: { type: Boolean, default: false },
      shareMerchantNames: { type: Boolean, default: false },
      classifyUnknownMerchants: { type: Boolean, default: false },
      readReceipts: { type: Boolean, default: false },
      consentedAt: { type: Date, default: null },
    },
    notifications: {
      budgetAlerts: { type: Boolean, default: true },
      upcomingPayments: { type: Boolean, default: true },
      importUpdates: { type: Boolean, default: true },
      insights: { type: Boolean, default: true },
    },
    consents: {
      emailImport: { type: Boolean, default: false },
      emailImportAt: { type: Date, default: null },
    },
    tracking: {
      platforms: { type: [String], default: [] },
      consentedAt: { type: Date, default: null },
    },
    onboardingCompleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
userPreferenceSchema.index({ userId: 1 }, { unique: true });

export const UserPreference = model<UserPreferenceDoc>('UserPreference', userPreferenceSchema);

export interface NotificationDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: 'budget' | 'upcoming_payment' | 'import' | 'insight' | 'system';
  severity: 'info' | 'warning' | 'success';
  title: string;
  body: string;
  link: string | null;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ['budget', 'upcoming_payment', 'import', 'insight', 'system'], required: true },
    severity: { type: String, enum: ['info', 'warning', 'success'], default: 'info' },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, default: '', maxlength: 600 },
    link: { type: String, default: null, maxlength: 300 },
    dedupeKey: { type: String, default: null, maxlength: 200 },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

export const Notification = model<NotificationDoc>('Notification', notificationSchema);

/**
 * A linked service account (Swiggy today). The tokens are sealed; only their expiry is readable. Spendly holds a
 * token the service issued after the person signed in on the service's own page — never their password or OTP.
 */
export interface ProviderConnectionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  provider: string;
  clientId: string;
  tokenEndpoint: string;
  accessTokenSealed: string;
  refreshTokenSealed: string | null;
  accessExpiresAt: Date;
  connectedAt: Date;
  lastSyncAt: Date | null;
  lastSyncAdded: number | null;
  lastError: string | null;
}

const providerConnectionSchema = new Schema<ProviderConnectionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    provider: { type: String, required: true, maxlength: 20 },
    clientId: { type: String, required: true, maxlength: 200 },
    tokenEndpoint: { type: String, required: true, maxlength: 400 },
    accessTokenSealed: { type: String, required: true },
    refreshTokenSealed: { type: String, default: null },
    accessExpiresAt: { type: Date, required: true },
    connectedAt: { type: Date, default: () => new Date() },
    lastSyncAt: { type: Date, default: null },
    lastSyncAdded: { type: Number, default: null },
    lastError: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: false },
);
providerConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const ProviderConnection = model<ProviderConnectionDoc>('ProviderConnection', providerConnectionSchema);

/** A sign-in that has been started but not finished: the PKCE secret waits here while the person is on the service's page. */
export interface ProviderFlowDoc {
  _id: Types.ObjectId;
  stateHash: string;
  userId: Types.ObjectId;
  provider: string;
  clientId: string;
  codeVerifierSealed: string;
  redirectUri: string;
  tokenEndpoint: string;
  createdAt: Date;
}

const providerFlowSchema = new Schema<ProviderFlowDoc>(
  {
    stateHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    provider: { type: String, required: true, maxlength: 20 },
    clientId: { type: String, required: true, maxlength: 200 },
    codeVerifierSealed: { type: String, required: true },
    redirectUri: { type: String, required: true, maxlength: 400 },
    tokenEndpoint: { type: String, required: true, maxlength: 400 },
    createdAt: { type: Date, default: () => new Date(), expires: 600 },
  },
  { timestamps: false },
);
providerFlowSchema.index({ stateHash: 1 }, { unique: true });

export const ProviderFlow = model<ProviderFlowDoc>('ProviderFlow', providerFlowSchema);
