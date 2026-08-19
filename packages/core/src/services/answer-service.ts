import { z } from 'zod';

import type { AccessContext } from '../domain.js';
import type { LlmAnswerGenerator } from '../llm/llm-answer-generator.js';
import type { SearchEvidence } from './search-service.js';
import { SearchService } from './search-service.js';

const answerSchema = z.object({
  query: z.string().trim().min(1).max(1_000),
  limit: z.number().int().min(1).max(20).default(8),
});

export type AnswerCommand = z.input<typeof answerSchema>;
export type AnswerStatus = 'answered' | 'evidence_only' | 'no_evidence';
export type AnswerDegradedReason =
  | 'llm_disabled'
  | 'llm_error'
  | 'missing_citations';

export interface AnswerResult {
  status: AnswerStatus;
  answer: string;
  evidence: SearchEvidence[];
  degradedReason?: AnswerDegradedReason;
}

export class AnswerService {
  constructor(
    private readonly searchService: SearchService,
    private readonly generator?: LlmAnswerGenerator,
  ) {}

  async answer(context: AccessContext, input: AnswerCommand): Promise<AnswerResult> {
    const command = answerSchema.parse(input);
    const search = await this.searchService.search(context, command);

    if (search.evidence.length === 0) {
      return {
        status: 'no_evidence',
        answer: '未找到可支持该问题的已授权来源，因此不生成推测性答案。',
        evidence: [],
      };
    }

    if (!this.generator) {
      return this.#evidenceOnly(search.evidence, 'llm_disabled');
    }

    try {
      const answer = await this.generator.generate({
        query: command.query,
        evidence: search.evidence,
      });
      if (!hasValidCitation(answer, search.evidence.length)) {
        return this.#evidenceOnly(search.evidence, 'missing_citations');
      }
      return { status: 'answered', answer, evidence: search.evidence };
    } catch {
      return this.#evidenceOnly(search.evidence, 'llm_error');
    }
  }

  #evidenceOnly(
    evidence: SearchEvidence[],
    degradedReason: AnswerDegradedReason,
  ): AnswerResult {
    const labels = evidence.map((_item, index) => `[S${index + 1}]`).join('、');
    return {
      status: 'evidence_only',
      answer: `已找到 ${evidence.length} 条相关来源（${labels}），请打开来源核验。`,
      evidence,
      degradedReason,
    };
  }
}

function hasValidCitation(answer: string, evidenceCount: number): boolean {
  return Array.from(answer.matchAll(/\[S(\d+)]/g))
    .some((match) => {
      const index = Number(match[1]);
      return Number.isInteger(index) && index >= 1 && index <= evidenceCount;
    });
}
