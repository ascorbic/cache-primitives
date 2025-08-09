# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Repository Structure

This is a monorepo for CDN cache control libraries using pnpm workspaces:

- **Root**: Workspace configuration and shared tooling
- **packages/**: Individual library packages
  - `cdn-cache-control`: Easy, opinionated CDN cache header handling (TypeScript
    class-based API)
  - `cache-handlers`: Modern CDN cache primitives using web-standard middleware
    (functional API)

## Commands

### Root-level commands (run from repository root):

- `pnpm build` - Build all packages
- `pnpm test` - Run tests for all packages (includes Deno, Node.js, and Workerd
  tests)
- `pnpm check` - Run type checking and linting for all packages
- `pnpm lint` - Run linting for all packages
- `pnpm format` - Format code using Prettier

### Package-level commands (run within individual packages):

- `pnpm build` - Build the package using tsdown (ESM + DTS output)
- `pnpm dev` - Watch mode for development
- `pnpm test` - Run tests (specific to each package's test setup)
- `pnpm check` - Run publint and @arethetypeswrong/cli checks

### Test-specific commands for cache-handlers package:

- `pnpm test:deno` - Run Deno tests from repository root
- `pnpm test:node` - Run Node.js tests via Vitest
- `pnpm test:workerd` - Run Cloudflare Workers tests via Vitest

## Development Workflow

- Uses **pnpm** as package manager
- **tsdown** for building TypeScript packages with ESM output and declaration
  files
- **deno** for testing
- **publint** and **@arethetypeswrong/cli** for package validation
- **Prettier** for code formatting (configured to use tabs in `.prettierrc`)

## Package Architecture

### cdn-cache-control

- **API Style**: Class-based (`CacheHeaders` extends `Headers`)
- **Target**: Simple cache header management with CDN-specific optimizations
- **Testing**: Node.js only via `node --test`
- **Build**: ESM + CommonJS outputs

### cache-handlers

- **API Style**: Functional middleware approach
- **Target**: Web standard cache primitives for modern applications
- **Key Features**:
  - Factory functions (`createCacheHandlers`, `createReadHandler`, etc.)
  - HTTP conditional requests (ETag, Last-Modified, 304 responses)
  - Cache invalidation by tags and paths
  - Multi-runtime support (Deno, Node.js, Cloudflare Workers)
- **Testing**: Multi-runtime (Deno tests, Node.js via Vitest, Workerd via
  Vitest)
- **Build**: ESM-only output

Each package follows this structure:

- `src/index.ts` - Main entry point with comprehensive exports
- `test/` - Test files (runtime-specific subdirectories for cache-handlers)
- `dist/` - Built output (ESM + .d.ts files)
- Package exports configured for proper TypeScript declarations

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
- **test-engineer**: For analyzing test failures, creating new tests, and
  enhancing test coverage. Should NOT fix application code - only
  creates/updates test files
- **docs-author**: For creating or updating documentation, READMEs, changesets,
  or PR descriptions
- **package-installer**: For installing npm packages with proper dependency
  management
