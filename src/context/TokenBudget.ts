export interface BudgetSection {
  name: string;
  content: string;
  priority: number;
}

/**
 * Manages token budget allocation for context sections.
 * Estimates tokens from text length and allocates by priority.
 */
export class TokenBudget {
  private maxTokens: number;

  constructor(maxTokens = 4000) {
    this.maxTokens = maxTokens;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Allocate sections within the token budget.
   * Higher priority sections are included first.
   * The last fitting section is truncated if it exceeds remaining budget.
   */
  allocate(sections: BudgetSection[]): Array<{ name: string; content: string }> {
    const sorted = [...sections].sort((a, b) => b.priority - a.priority);
    const result: Array<{ name: string; content: string }> = [];
    let usedTokens = 0;

    for (const section of sorted) {
      const sectionTokens = this.estimateTokens(section.content);

      if (usedTokens + sectionTokens <= this.maxTokens) {
        result.push({ name: section.name, content: section.content });
        usedTokens += sectionTokens;
      } else {
        // Truncate to fit remaining budget
        const remaining = this.maxTokens - usedTokens;
        if (remaining > 50) {
          const truncatedChars = remaining * 4;
          result.push({
            name: section.name,
            content: section.content.slice(0, truncatedChars),
          });
          usedTokens = this.maxTokens;
        }
        break;
      }
    }

    return result;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }
}
