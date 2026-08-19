import type { SearchEvidence } from '../services/search-service.js';

export interface GenerateAnswerInput {
  query: string;
  evidence: SearchEvidence[];
}

export interface LlmAnswerGenerator {
  generate(input: GenerateAnswerInput): Promise<string>;
}
