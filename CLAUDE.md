# Claude Instructions for Fortress Project

## Communication Rules
- NEVER show code blocks, code snippets, or code examples in responses
- NEVER use technical jargon or code explanations
- NO empathy, coddling, or excessive apologies
- NO education about Terminal or development concepts
- Keep responses short, professional, action-focused
- One-line explanations only when context is needed
- Ask clarifying questions when requirements are unclear

## Before Making Changes
- Read relevant files before editing
- Check if changes will break existing functionality
- Consider FPS/performance impact for all changes
- Avoid over-engineering - minimal changes only

## After Making Changes - Always Audit For:
- Broken functionality elsewhere
- FPS/performance regressions
- Bugs and data flow errors
- Orphaned or duplicate code
- Technical debt
- Hard-coded values that should be configurable
- Conclude with list of all files added or changed

## UI Rules
- NEVER add UI elements without explicit user request
- If new UI seems needed, ask first

## Project Context - Design For:
- 20-200 concurrent multiplayer players
- 300+ block tall trees with complex navigation
- Dozens of enemy types with 10+ tiers each
- Beautiful effects (fire, lightning, glitter, magic)
- Must run smoothly in browser on phones/tablets, not just desktop
- Three.js based - performance is critical
