# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Repository Structure

This is a monorepo library template using pnpm workspaces with the following
structure:

- **Root**: Workspace configuration and shared tooling
- **packages/**: Individual library packages (currently contains `cache-primitives`
  package)
- **demos/**: Demo applications and examples

## Commands

### Root-level commands (run from repository root):

- `pnpm build` - Build all packages
- `pnpm test` - Run tests for all packages
- `pnpm check` - Run type checking and linting for all packages
- `pnpm format` - Format code using Prettier

### Package-level commands (run within individual packages):

- `pnpm build` - Build the package using tsdown (ESM + DTS output)
- `pnpm dev` - Watch mode for development
- `pnpm test` - Run deno tests
- `pnpm check` - Run publint and @arethetypeswrong/cli checks

## Development Workflow

- Uses **pnpm** as package manager
- **tsdown** for building TypeScript packages with ESM output and declaration
  files
- **deno** for testing
- **publint** and **@arethetypeswrong/cli** for package validation
- **Prettier** for code formatting (configured to use tabs in `.prettierrc`)

## Package Architecture

Each package in `packages/` follows this structure:

- `src/index.ts` - Main entry point
- `test/` - Test files
- `dist/` - Built output (ESM + .d.ts files)
- Package exports configured for ESM-only with proper TypeScript declarations

## TypeScript Configuration

Uses strict TypeScript configuration with:

- Target: ES2022
- Module: preserve (for bundler compatibility)
- Strict mode with additional safety checks (`noUncheckedIndexedAccess`,
  `noImplicitOverride`)
- Library-focused settings (declaration files, declaration maps)

## Use Specialized Agents for Complex Tasks

ALWAYS use the appropriate specialized agents for complex work:

- **technical-architect**: For designing system architecture, evaluating
  technical approaches, planning major features
- **code-reviewer**: For comprehensive code review after implementing
  significant code changes
- **test-engineer**: For analyzing test failures, creating new tests, and enhancing test coverage. Should NOT fix application code - only creates/updates test files
- **docs-author**: For creating or updating documentation, READMEs, changesets,
  or PR descriptions
- **package-installer**: For installing npm packages with proper dependency
  management
