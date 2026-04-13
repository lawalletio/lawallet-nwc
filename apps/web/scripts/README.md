# GitHub Issues Creation Scripts

This directory contains scripts to create GitHub issues and project epics from the plan.

## Prerequisites

1. A GitHub Personal Access Token with `repo` scope
   - Create one at: https://github.com/settings/tokens
   - For GitHub Projects: also requires `write:org` scope for organization projects
   - Or use GitHub CLI: `gh auth token`

## Scripts

### 1. Create GitHub Issues

Creates all issues from `github-issues.json`.

#### Option 1: Using Node.js script

```bash
# Set your GitHub token
export GITHUB_TOKEN=your_token_here

# Run the script
node scripts/create-github-issues.js
```

#### Option 2: Using GitHub CLI

If you have GitHub CLI installed and authenticated:

```bash
gh auth token | xargs -I {} GITHUB_TOKEN={} node scripts/create-github-issues.js
```

#### Option 3: Manual creation

You can also manually create issues using the JSON file:

1. Open `github-issues.json`
2. Copy each issue's title and body
3. Create issues manually on GitHub at: https://github.com/lawalletio/lawallet-nwc/issues/new

### 2. Create GitHub Project Epics

Creates epic issues and links existing issues to them. **Run this after creating issues.**

#### Basic usage (Interactive Project Selection)

```bash
# Set your GitHub token
export GITHUB_TOKEN=your_token_here

# Create epics and link issues
# The script will prompt you to select a GitHub Project interactively
node scripts/create-github-epics.js
```

The script will:

1. Fetch all available projects (repository and organization projects)
2. If no projects exist, it will offer to create one automatically
3. Display them in a numbered list
4. Prompt you to select one (or create a new one)
5. You can also choose to skip adding to a project

**Automatic Project Creation**: If no projects are found, the script will ask if you want to create a new project. It will try to create an organization project first, and fall back to a repository project if that fails.

#### With Pre-selected GitHub Project

To skip the interactive prompt and specify a project directly:

```bash
# Get your project number from the project URL
# e.g., if URL is https://github.com/orgs/lawalletio/projects/1, the number is 1
export GITHUB_TOKEN=your_token_here
export GITHUB_PROJECT_NUMBER=1

node scripts/create-github-epics.js
```

#### Using GitHub CLI

```bash
gh auth token | xargs -I {} GITHUB_TOKEN={} node scripts/create-github-epics.js
```

## Epic Organization

Issues are grouped into the following epics:

- **Bug Fixes & Critical Issues** - Critical bug fixes
- **Error Handling & Infrastructure** - Error handling, validation, middleware
- **Logging & Observability** - Structured logging improvements
- **Configuration & Environment** - Environment config and feature flags
- **Authorization & Security** - Roles, permissions, RBAC
- **Security Middleware** - Rate limiting, request limits
- **Testing Infrastructure** - Test setup, unit tests, integration tests
- **CI/CD Pipeline** - GitHub Actions, Vercel, deployment automation
- **Documentation** - API docs, architecture, contributing guides

## File Structure

- `github-issues.json` - Contains all issues to be created
- `create-github-issues.js` - Script to automatically create issues via GitHub API
- `create-github-epics.js` - Script to create epics and link issues

## Issue Organization

Issues are organized by:

- **Labels**: bug, enhancement, backend, testing, documentation, etc.
- **Epics**: Issues are grouped into logical epics (see above)
- **Dependencies**: Some issues depend on others (noted in issue body)
- **Priority**: High priority issues are labeled accordingly

## Notes

- The scripts include rate limiting (100-200ms delay between requests)
- GitHub API allows 5000 requests/hour for authenticated requests
- All issues will be created in the `lawalletio/lawallet-nwc` repository
- Failed operations will be reported at the end
- **Important**: Run `create-github-issues.js` before `create-github-epics.js` to ensure all issues exist
