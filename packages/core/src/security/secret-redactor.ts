export type SecretFindingType =
  | 'api_key'
  | 'bearer_token'
  | 'password'
  | 'database_password';

export interface SecretFinding {
  type: SecretFindingType;
  start: number;
  end: number;
  maskedPreview: string;
}

export interface RedactionResult {
  redactedText: string;
  findings: SecretFinding[];
}

interface Candidate {
  type: SecretFindingType;
  start: number;
  end: number;
  priority: number;
}

const API_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{20,}\b/g;
const BEARER_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/gi;
const PASSWORD_ASSIGNMENT_PATTERN =
  /\b(?:password|passwd|pwd|api[_-]?key|secret)\s*[:=]\s*["']?([^\s,;"']{4,})["']?/gi;
const DATABASE_URL_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|mssql):\/\/[^:\s/@]+:([^@\s/]+)@/gi;

function collectWholeMatches(
  input: string,
  pattern: RegExp,
  type: SecretFindingType,
  priority: number,
): Candidate[] {
  return Array.from(input.matchAll(pattern), (match) => ({
    type,
    start: match.index,
    end: match.index + match[0].length,
    priority,
  }));
}

function collectCapturedMatches(
  input: string,
  pattern: RegExp,
  type: SecretFindingType,
  priority: number,
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const match of input.matchAll(pattern)) {
    const captured = match[1];
    if (!captured) continue;

    const offsetInMatch = match[0].lastIndexOf(captured);
    if (offsetInMatch < 0) continue;

    const start = match.index + offsetInMatch;
    candidates.push({
      type,
      start,
      end: start + captured.length,
      priority,
    });
  }

  return candidates;
}

function maskedPreview(type: SecretFindingType, secret: string): string {
  const fingerprint = secret.length >= 4 ? `:…${secret.slice(-4)}` : '';
  return `[REDACTED:${type}${fingerprint}]`;
}

export function redactSecrets(input: string): RedactionResult {
  const candidates = [
    ...collectCapturedMatches(input, DATABASE_URL_PATTERN, 'database_password', 0),
    ...collectWholeMatches(input, API_KEY_PATTERN, 'api_key', 1),
    ...collectCapturedMatches(input, BEARER_PATTERN, 'bearer_token', 2),
    ...collectCapturedMatches(input, PASSWORD_ASSIGNMENT_PATTERN, 'password', 3),
  ].sort((left, right) => left.start - right.start || left.priority - right.priority);

  const findings: SecretFinding[] = [];
  const output: string[] = [];
  let cursor = 0;

  for (const candidate of candidates) {
    if (candidate.start < cursor || candidate.end <= candidate.start) continue;

    const secret = input.slice(candidate.start, candidate.end);
    const preview = maskedPreview(candidate.type, secret);
    output.push(input.slice(cursor, candidate.start), preview);
    findings.push({
      type: candidate.type,
      start: candidate.start,
      end: candidate.end,
      maskedPreview: preview,
    });
    cursor = candidate.end;
  }

  if (findings.length === 0) {
    return { redactedText: input, findings: [] };
  }

  output.push(input.slice(cursor));
  return { redactedText: output.join(''), findings };
}
