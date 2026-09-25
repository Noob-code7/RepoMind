/**
 * planning/prd_parser.ts
 * Parses Markdown and freeform PRD text into structured Requirements.
 * Extracts functional, non-functional, constraint, and technical requirements.
 * Explicitly flags ambiguities without hallucinating requirements.
 */
import { Requirement, RequirementType } from './schemas.js';

export interface ParsedPrdOutput {
  title: string;
  goals: string[];
  requirements: Requirement[];
  constraints: string[];
  ambiguities: string[];
}

export class PrdParser {
  /**
   * Parse PRD text into structured requirements.
   */
  static parse(prdText: string): ParsedPrdOutput {
    const lines = prdText.split('\n');
    let title = 'Project Requirements';
    const goals: string[] = [];
    const constraints: string[] = [];
    const rawRequirements: Array<{
      title: string;
      desc: string;
      type: RequirementType;
      criteria: string[];
      ambiguity?: string;
    }> = [];

    let currentSection: 'goals' | 'requirements' | 'constraints' | 'other' = 'other';
    let currentReq: {
      title: string;
      desc: string;
      type: RequirementType;
      criteria: string[];
      ambiguity?: string;
    } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Detect Top Title
      if (line.startsWith('# ') && title === 'Project Requirements') {
        title = line.replace(/^#\s+/, '').trim();
        continue;
      }

      // Detect Section Headers
      const lower = line.toLowerCase();
      if (lower.includes('goal') || lower.includes('overview') || lower.includes('vision')) {
        currentSection = 'goals';
        continue;
      }
      if (
        lower.includes('requirement') ||
        lower.includes('feature') ||
        lower.includes('user flow')
      ) {
        currentSection = 'requirements';
        continue;
      }
      if (lower.includes('constraint') || lower.includes('non-goal') || lower.includes('out of scope')) {
        currentSection = 'constraints';
        continue;
      }

      // Collect items based on section
      if (currentSection === 'goals') {
        if (line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line)) {
          goals.push(cleanBullet(line));
        }
      } else if (currentSection === 'constraints') {
        if (line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line)) {
          constraints.push(cleanBullet(line));
        }
      } else if (currentSection === 'requirements') {
        const isHeader = line.startsWith('###') || line.startsWith('##');
        const isNumbered = /^\d+\./.test(line);
        const isBullet = line.startsWith('-') || line.startsWith('*');

        if (isHeader || isNumbered || (isBullet && line.includes('**'))) {
          // Commit previous requirement
          if (currentReq) {
            rawRequirements.push(currentReq);
          }

          const rawTitle = cleanBullet(line.replace(/^#+\s*/, ''));
          const reqType = PrdParser.classifyRequirementType(rawTitle);

          // Check for ambiguity in requirement phrasing
          const isVague =
            rawTitle.includes('should be fast') ||
            rawTitle.includes('etc') ||
            rawTitle.includes('as needed') ||
            rawTitle.includes('best practices') ||
            rawTitle.includes('standard');

          currentReq = {
            title: rawTitle,
            desc: rawTitle,
            type: reqType,
            criteria: [],
            ambiguity: isVague ? `Requirement phrasing "${rawTitle}" contains vague criteria.` : undefined,
          };
        } else if (currentReq && isBullet) {
          const criterion = cleanBullet(line);
          currentReq.criteria.push(criterion);
        } else if (currentReq) {
          currentReq.desc += ` ${line}`;
        }
      }
    }

    if (currentReq) {
      rawRequirements.push(currentReq);
    }

    // Fallback if no explicit requirement sections were marked
    if (rawRequirements.length === 0) {
      const bullets = lines.filter((l) => l.trim().startsWith('-') || /^\d+\./.test(l.trim()));
      if (bullets.length > 0) {
        bullets.forEach((b, idx) => {
          const text = cleanBullet(b);
          rawRequirements.push({
            title: text,
            desc: text,
            type: 'functional',
            criteria: [text],
          });
        });
      } else {
        rawRequirements.push({
          title: title || 'Core Requirement',
          desc: prdText.slice(0, 300),
          type: 'functional',
          criteria: ['Implements core specification'],
        });
      }
    }

    // Map to final Requirement objects with normalized IDs
    const requirements: Requirement[] = rawRequirements.map((r, idx) => {
      const id = `REQ-${String(idx + 1).padStart(3, '0')}`;
      return {
        id,
        title: r.title,
        description: r.desc,
        type: r.type,
        acceptanceCriteria: r.criteria.length > 0 ? r.criteria : [r.desc],
        ambiguities: r.ambiguity ? [r.ambiguity] : [],
      };
    });

    const ambiguities: string[] = requirements.flatMap((r) => r.ambiguities);

    return {
      title,
      goals,
      requirements,
      constraints,
      ambiguities,
    };
  }

  private static classifyRequirementType(text: string): RequirementType {
    const lower = text.toLowerCase();
    if (lower.includes('performance') || lower.includes('security') || lower.includes('latency') || lower.includes('scale')) {
      return 'non_functional';
    }
    if (lower.includes('constraint') || lower.includes('must not') || lower.includes('cannot')) {
      return 'constraint';
    }
    if (lower.includes('flow') || lower.includes('user journey') || lower.includes('clicks')) {
      return 'user_flow';
    }
    if (lower.includes('database') || lower.includes('api') || lower.includes('schema') || lower.includes('config')) {
      return 'technical';
    }
    return 'functional';
  }
}

function cleanBullet(text: string): string {
  return text
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^\*\*(.*?)\*\*[:\-]?\s*/, '$1: ')
    .trim();
}
