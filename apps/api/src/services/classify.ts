import type { Types } from 'mongoose';
import { recognize, type MerchantRuleLike, type Recognition, type RecognitionInput } from '@spendly/shared';
import { classifyWithLlm } from '../ai/service';
import { MerchantRule } from '../models/finance';
import type { AuthContext } from '../middleware/context';
import type { Lookups } from './lookups';
import { loadLookups } from './lookups';

export async function loadRules(userId: Types.ObjectId): Promise<MerchantRuleLike[]> {
  const rules = await MerchantRule.find({ userId, isActive: true }).lean();
  return rules.map((r) => ({
    id: r._id.toString(),
    name: r.name,
    matchType: r.matchType,
    pattern: r.pattern,
    field: r.field,
    platform: r.platform,
    category: r.category,
    subcategory: r.subcategory,
    type: r.type,
    priority: r.priority,
    isActive: r.isActive,
    source: r.source,
  }));
}

export interface Classifier {
  lookups: Lookups;
  classify(input: RecognitionInput): Recognition;
  /** Applies the AI fallback (if the user opted in) to results the rules could not place. */
  classifyAll(inputs: RecognitionInput[]): Promise<Recognition[]>;
  recordHits(): Promise<void>;
}

/** Loads the user's rules and custom platforms once, so a whole import can be classified without re-querying. */
export async function createClassifier(auth: AuthContext, lookups?: Lookups): Promise<Classifier> {
  const [rules, lk] = await Promise.all([loadRules(auth.userId), lookups ?? loadLookups(auth.userId)]);
  const ctx = { rules, customPlatforms: lk.customPlatforms };
  const hits = new Map<string, number>();

  const classify = (input: RecognitionInput): Recognition => {
    const r = recognize(input, ctx);
    if (r.ruleId) hits.set(r.ruleId, (hits.get(r.ruleId) ?? 0) + 1);
    return r;
  };

  return {
    lookups: lk,
    classify,
    async classifyAll(inputs) {
      const results = inputs.map(classify);
      // AI fallback — only for what deterministic rules could not place, one request per distinct merchant
      const unresolved = new Map<string, { id: string; text: string }>();
      results.forEach((r, i) => {
        if (r.source === 'default' && r.category === null && inputs[i]?.direction !== 'credit' && !unresolved.has(r.merchantKey)) {
          const input = inputs[i] as RecognitionInput;
          unresolved.set(r.merchantKey, { id: r.merchantKey, text: input.merchant || input.description || r.merchantName });
        }
      });
      if (unresolved.size > 0) {
        const suggestions = await classifyWithLlm({ prefs: auth.prefs, lookups: lk, items: [...unresolved.values()] });
        results.forEach((r, i) => {
          const s = suggestions.get(r.merchantKey);
          if (!s) return;
          results[i] = {
            ...r,
            platform: s.platform,
            category: s.category,
            confidence: s.confidence,
            source: 'ai',
            reason: s.reason,
            needsReview: true,
            merchantKey: s.platform ? `p:${s.platform}` : r.merchantKey,
            merchantName: s.platform ? (lk.platformName(s.platform) ?? r.merchantName) : r.merchantName,
          };
        });
      }
      return results;
    },
    async recordHits() {
      if (hits.size === 0) return;
      const now = new Date();
      await MerchantRule.bulkWrite(
        [...hits].map(([id, count]) => ({
          updateOne: { filter: { _id: id, userId: auth.userId }, update: { $inc: { hitCount: count }, $set: { lastHitAt: now } } },
        })),
      );
      hits.clear();
    },
  };
}
