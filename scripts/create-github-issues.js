#!/usr/bin/env node

/**
 * Script to create GitHub issues from github-issues.json
 *
 * Usage:
 *   GITHUB_TOKEN=your_token node scripts/create-github-issues.js
 *
 * Or with GitHub CLI:
 *   gh auth token | xargs -I {} GITHUB_TOKEN={} node scripts/create-github-issues.js
 */

const fs = require('fs')
const path = require('path')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_API_URL = 'https://api.github.com'

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is required')
  console.error('Get a token from: https://github.com/settings/tokens')
  console.error('Required scopes: repo')
  process.exit(1)
}

async function createIssue(repo, issue) {
  const url = `${GITHUB_API_URL}/repos/${repo}/issues`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels || []
    })
  })

  if (!response.ok) {
    let error
    try {
      error = await response.json()
    } catch {
      const text = await response.text()
      error = { message: text }
    }

    let errorMessage = `Failed to create issue "${issue.title}": ${error.message || JSON.stringify(error)}`

    if (response.status === 403) {
      errorMessage += '\n   → This usually means:'
      errorMessage +=
        '\n     1. Your token lacks the "repo" scope (check: https://github.com/settings/tokens)'
      errorMessage +=
        "\n     2. The repository is private and your token doesn't have access"
      errorMessage += '\n     3. The token has expired or is invalid'
    } else if (response.status === 401) {
      errorMessage +=
        '\n   → Your token is invalid or expired. Get a new one at: https://github.com/settings/tokens'
    }

    throw new Error(errorMessage)
  }

  return response.json()
}

async function main() {
  const issuesFile = path.join(__dirname, '..', 'github-issues.json')

  if (!fs.existsSync(issuesFile)) {
    console.error(`Error: ${issuesFile} not found`)
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(issuesFile, 'utf8'))
  const { repository, issues } = data

  console.log(`Creating ${issues.length} issues in ${repository}...\n`)

  const results = {
    created: [],
    failed: []
  }

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]
    try {
      console.log(`[${i + 1}/${issues.length}] Creating: ${issue.title}`)
      const created = await createIssue(repository, issue)
      results.created.push({
        title: issue.title,
        url: created.html_url,
        number: created.number
      })
      console.log(`  ✓ Created: ${created.html_url}\n`)

      // Rate limit: GitHub allows 5000 requests/hour for authenticated requests
      // Adding a small delay to be safe
      if (i < issues.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}\n`)
      results.failed.push({
        title: issue.title,
        error: error.message
      })
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Created: ${results.created.length}`)
  console.log(`Failed: ${results.failed.length}\n`)

  if (results.created.length > 0) {
    console.log('Created issues:')
    results.created.forEach(({ title, url, number }) => {
      console.log(`  #${number}: ${title} - ${url}`)
    })
  }

  if (results.failed.length > 0) {
    console.log('\nFailed issues:')
    results.failed.forEach(({ title, error }) => {
      console.log(`  ${title}: ${error}`)
    })
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
