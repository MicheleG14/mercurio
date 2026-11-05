import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/**
 * Checks the page with axe (WCAG 2.1 A and AA rules). Serious and critical violations fail the
 * test; the others are attached to the report, to be looked at, not to block.
 */
export async function expectAccessible(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const minor = results.violations.filter((v) => !blocking.includes(v));
  if (minor.length > 0) {
    await test.info().attach(`axe-${name}`, {
      body: JSON.stringify(minor.map(summary), null, 2),
      contentType: 'application/json',
    });
  }
  expect(blocking.map(summary), `axe on ${name}`).toEqual([]);
}

function summary(violation: {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: unknown[] }[];
}) {
  return {
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    where: violation.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  };
}
