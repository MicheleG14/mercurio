# Architecture decision records

Each record captures one architectural decision: the context, what was decided, and what it costs.
A record is written in the same commit as the change it describes and is never rewritten afterwards:
a decision that changes gets a new record that supersedes the old one.

| #                                                  | Decision                                         | Status   |
| -------------------------------------------------- | ------------------------------------------------ | -------- |
| [0001](0001-modular-monolith.md)                   | Modular monolith                                 | Accepted |
| [0002](0002-money-as-decimal.md)                   | Monetary amounts as decimals, never `number`     | Accepted |
| [0003](0003-problem-details-errors.md)             | Errors as RFC 9457 Problem Details with codes    | Accepted |
| [0004](0004-api-serves-web-app.md)                 | The API serves the web app (single origin)       | Accepted |
| [0005](0005-translations-in-frontend.md)           | User-facing text lives only in the frontend      | Accepted |
| [0006](0006-vitest-and-oxlint.md)                  | Vitest and oxlint                                | Accepted |
| [0007](0007-continuous-delivery-github-actions.md) | Continuous delivery with GitHub Actions and GHCR | Accepted |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

What forces the decision: the problem, the constraints, what matters.

## Decision

What we do, stated plainly.

## Consequences

What becomes easier, what becomes harder, what we accept.

## Alternatives considered

Each option and why it was not chosen.
```
