# Starward (星程) — Prompt Lab

This directory contains the **core AI prompt designs** for validating output
quality before building the app. Each prompt is tested against a sample user
scenario using the Claude API.

## Files

| File | Purpose |
|------|---------|
| `sample-user.json` | The sample user profile used across all tests |
| `feature1-goal-clarification.md` | System + user prompts for goal clarification & roadmap |
| `feature2-daily-tasks.md` | System + user prompts for daily task generation |
| `feature4-recovery.md` | System + user prompts for recovery after missed tasks |
| `run-prompts.ts` | Script that sends each prompt to Claude and saves output |

## Running

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx prompts/run-prompts.ts
```

Output is saved to `prompts/outputs/`.
