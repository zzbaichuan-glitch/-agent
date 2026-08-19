import { z } from 'zod';

import type { AccessContext, InformationAsset, SourceReference } from '../domain.js';
import type { AssetRepository } from '../repositories/asset-repository.js';

const searchSchema = z.object({
  query: z.string().trim().min(1).max(1_000),
  limit: z.number().int().min(1).max(20).default(8),
});

export type SearchCommand = z.input<typeof searchSchema>;

export interface SearchEvidence {
  citationId: string;
  assetId: string;
  title: string;
  snippet: string;
  score: number;
  sources: SourceReference[];
  createdAt: string;
}

export interface SearchResult {
  mode: 'keyword';
  query: string;
  evidence: SearchEvidence[];
}

interface RankedAsset {
  asset: InformationAsset;
  score: number;
}

export class SearchService {
  constructor(private readonly repository: AssetRepository) {}

  async search(context: AccessContext, input: SearchCommand): Promise<SearchResult> {
    const command = searchSchema.parse(input);
    const normalizedQuery = normalize(command.query);
    const terms = queryTerms(normalizedQuery);
    const accessibleAssets = await this.repository.list(context, { limit: 500 });

    const ranked = accessibleAssets
      .map((asset): RankedAsset => ({
        asset,
        score: scoreAsset(asset, normalizedQuery, terms),
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score
        || right.asset.createdAt.localeCompare(left.asset.createdAt)
        || left.asset.id.localeCompare(right.asset.id))
      .slice(0, command.limit);

    return {
      mode: 'keyword',
      query: command.query,
      evidence: ranked.map(({ asset, score }) => ({
        citationId: `asset:${asset.id}`,
        assetId: asset.id,
        title: asset.title,
        snippet: createSnippet(asset.redactedContent, normalizedQuery, terms),
        score,
        sources: asset.sources,
        createdAt: asset.createdAt,
      })),
    };
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function queryTerms(query: string): string[] {
  const terms = new Set<string>([query]);
  const segments = query.match(/[a-z0-9_-]+|[\p{Script=Han}]+/gu) ?? [];

  for (const segment of segments) {
    if (/^[\p{Script=Han}]+$/u.test(segment) && segment.length > 2) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        terms.add(segment.slice(index, index + 2));
      }
    } else if (segment.length > 1) {
      terms.add(segment);
    }
  }

  return Array.from(terms).filter((term) => term.length > 1);
}

function scoreAsset(
  asset: InformationAsset,
  query: string,
  terms: string[],
): number {
  const title = normalize(asset.title);
  const content = normalize(asset.redactedContent);
  let score = 0;

  if (title === query) score += 120;
  else if (title.includes(query)) score += 70;
  if (content.includes(query)) score += 45;

  for (const term of terms) {
    if (term === query) continue;
    if (title.includes(term)) score += 8;
    if (content.includes(term)) score += 3;
  }

  return score;
}

function createSnippet(content: string, query: string, terms: string[]): string {
  const normalizedContent = normalize(content);
  let matchIndex = normalizedContent.indexOf(query);
  if (matchIndex < 0) {
    matchIndex = terms
      .map((term) => normalizedContent.indexOf(term))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? 0;
  }

  const radius = 70;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(content.length, matchIndex + query.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}
