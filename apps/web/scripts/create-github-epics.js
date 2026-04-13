#!/usr/bin/env node

/**
 * Script to create GitHub project epics from github-issues.json
 *
 * This script:
 * 1. Groups issues into logical epics
 * 2. Creates epic issues (regular issues with "epic" label)
 * 3. Updates child issues to reference their epic
 * 4. Optionally adds issues to a GitHub Project (interactive selection)
 *
 * Usage:
 *   GITHUB_TOKEN=your_token node scripts/create-github-epics.js
 *   # The script will prompt you to select a project interactively
 *
 *   # Or specify project number directly:
 *   GITHUB_TOKEN=your_token GITHUB_PROJECT_NUMBER=123 node scripts/create-github-epics.js
 *
 * Or with GitHub CLI:
 *   gh auth token | xargs -I {} GITHUB_TOKEN={} node scripts/create-github-epics.js
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_PROJECT_NUMBER = process.env.GITHUB_PROJECT_NUMBER
const GITHUB_API_URL = 'https://api.github.com'

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is required')
  console.error('Get a token from: https://github.com/settings/tokens')
  console.error('Required scopes: repo (and write:org for organization projects)')
  process.exit(1)
}

// Define epic groupings based on issue themes
// issueIndices refer to the index in the issues array from github-issues.json
const EPIC_GROUPS = {
  'Bug Fixes & Critical Issues': {
    description: 'Fix critical bugs and issues in the codebase',
    issueIndices: [0], // "Fix critical bugs in API routes"
    labels: ['epic', 'bug', 'priority: high']
  },
  'Error Handling & Infrastructure': {
    description: 'Comprehensive error handling, validation, and middleware infrastructure',
    issueIndices: [1, 2, 64, 65, 69, 70], // Error handling (1,2), validation (64,65,69,70)
    labels: ['epic', 'enhancement', 'backend', 'refactoring']
  },
  'Logging & Observability': {
    description: 'Structured logging and observability improvements',
    issueIndices: [3, 4], // Pino logger setup and replacement
    labels: ['epic', 'enhancement', 'backend', 'logging']
  },
  'Configuration & Environment': {
    description: 'Environment configuration, validation, and feature flags',
    issueIndices: [5, 6, 59], // Env vars (5), config loader (6), maintenance mode (59)
    labels: ['epic', 'enhancement', 'backend', 'configuration']
  },
  'Authorization & Security': {
    description: 'Roles, permissions, and security middleware',
    issueIndices: [7, 8, 9, 10, 11], // Roles & permissions (7-11)
    labels: ['epic', 'enhancement', 'backend', 'security', 'authorization']
  },
  'Security Middleware': {
    description: 'Rate limiting, request limits, and security middleware',
    issueIndices: [12, 13], // Rate limiting (12), request size limits (13)
    labels: ['epic', 'enhancement', 'backend', 'security']
  },
  'Testing Infrastructure': {
    description: 'Comprehensive testing setup, utilities, and test coverage',
    issueIndices: [14, 15, 16, 17], // Vitest setup (14), unit tests (15), integration tests (16), coverage (17)
    labels: ['epic', 'enhancement', 'testing', 'backend']
  },
  'CI/CD Pipeline': {
    description: 'GitHub Actions, Vercel, and deployment automation',
    issueIndices: [18, 19, 20], // GitHub Actions (18), Vercel (19), coverage reporting (20)
    labels: ['epic', 'enhancement', 'ci/cd']
  },
  'Documentation': {
    description: 'API documentation, architecture docs, and contributing guides',
    issueIndices: [21, 22, 23, 24, 25, 26], // API docs (21), architecture (22), testing (23), contributing (24), JSDoc (25), OpenAPI (26)
    labels: ['epic', 'documentation']
  }
}

async function makeRequest(url, options = {}) {
  // Projects API requires different Accept header
  const isProjectsApi = url.includes('/projects') && !url.includes('/columns') && !url.includes('/cards')
  const acceptHeader = isProjectsApi 
    ? 'application/vnd.github.inertia-preview+json' 
    : 'application/vnd.github.v3+json'
  
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: acceptHeader,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  if (!response.ok) {
    let error
    try {
      error = await response.json()
    } catch {
      const text = await response.text()
      error = { message: text }
    }

    let errorMessage = `Request failed: ${error.message || JSON.stringify(error)}`

    if (response.status === 403) {
      errorMessage += '\n   → This usually means:'
      errorMessage += '\n     1. Your token lacks required scopes (check: https://github.com/settings/tokens)'
      errorMessage += '\n     2. The repository is private and your token doesn\'t have access'
      errorMessage += '\n     3. The token has expired or is invalid'
      if (GITHUB_PROJECT_NUMBER) {
        errorMessage += '\n     4. For projects: token needs "write:org" scope for org projects or "repo" for user projects'
      }
    } else if (response.status === 401) {
      errorMessage += '\n   → Your token is invalid or expired. Get a new one at: https://github.com/settings/tokens'
    }

    throw new Error(errorMessage)
  }

  return response.json()
}

async function createIssue(repo, issue) {
  const url = `${GITHUB_API_URL}/repos/${repo}/issues`
  return makeRequest(url, {
    method: 'POST',
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels || []
    })
  })
}

async function updateIssue(repo, issueNumber, updates) {
  const url = `${GITHUB_API_URL}/repos/${repo}/issues/${issueNumber}`
  return makeRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  })
}

async function getAllProjects(repo) {
  const projects = []
  
  // Get repository projects
  try {
    const url = `${GITHUB_API_URL}/repos/${repo}/projects`
    const repoProjects = await makeRequest(url, { method: 'GET' })
    repoProjects.forEach(project => {
      projects.push({
        ...project,
        source: 'repository',
        displayName: `[Repo] ${project.name}`
      })
    })
  } catch (error) {
    console.warn(`Could not fetch repository projects: ${error.message}`)
  }

  // Get organization projects
  const [owner] = repo.split('/')
  try {
    const orgUrl = `${GITHUB_API_URL}/orgs/${owner}/projects`
    const orgProjects = await makeRequest(orgUrl, { method: 'GET' })
    orgProjects.forEach(project => {
      projects.push({
        ...project,
        source: 'organization',
        displayName: `[Org] ${project.name}`
      })
    })
  } catch (error) {
    // Organization projects might not be accessible
    console.warn(`Could not access organization projects: ${error.message}`)
  }

  return projects
}

async function getProjectId(repo, projectNumber) {
  const projects = await getAllProjects(repo)
  const project = projects.find(p => p.number === parseInt(projectNumber))
  
  if (!project) {
    throw new Error(`Project #${projectNumber} not found in repository or organization`)
  }
  
  return project.id
}

function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function createProject(repo, projectName = 'Lawallet NWC Epics') {
  const [owner] = repo.split('/')
  
  // Try to create organization project first (more common)
  try {
    console.log(`Creating organization project: ${projectName}...`)
    const orgUrl = `${GITHUB_API_URL}/orgs/${owner}/projects`
    const project = await makeRequest(orgUrl, {
      method: 'POST',
      body: JSON.stringify({
        name: projectName,
        body: 'Project for organizing Lawallet NWC development epics and issues',
        private: false
      })
    })
    console.log(`  ✓ Created organization project: #${project.number} - ${project.name}`)
    return project.number
  } catch (error) {
    // If org project creation fails, try repository project
    console.warn(`Could not create organization project: ${error.message}`)
    console.log(`Trying to create repository project instead...`)
    
    try {
      const repoUrl = `${GITHUB_API_URL}/repos/${repo}/projects`
      const project = await makeRequest(repoUrl, {
        method: 'POST',
        body: JSON.stringify({
          name: projectName,
          body: 'Project for organizing Lawallet NWC development epics and issues',
          private: false
        })
      })
      console.log(`  ✓ Created repository project: #${project.number} - ${project.name}`)
      return project.number
    } catch (repoError) {
      throw new Error(`Failed to create project: ${repoError.message}`)
    }
  }
}

async function selectProject(repo) {
  console.log('\nFetching available GitHub projects...')
  const projects = await getAllProjects(repo)

  if (projects.length === 0) {
    console.log('No projects found.')
    const answer = await promptUser('Would you like to create a new project? (y/n): ')
    
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      try {
        const projectNumber = await createProject(repo)
        console.log(`\nUsing newly created project #${projectNumber}\n`)
        return projectNumber
      } catch (error) {
        console.error(`\n✗ Failed to create project: ${error.message}`)
        console.error('You can create one manually at: https://github.com/orgs/lawalletio/projects/new')
        return null
      }
    } else {
      console.log('Skipping project creation.\n')
      return null
    }
  }

  console.log('\nAvailable projects:')
  projects.forEach((project, index) => {
    const state = project.state === 'open' ? '✓' : '✗'
    console.log(`  ${index + 1}. ${state} #${project.number} - ${project.displayName} (${project.state})`)
  })
  console.log(`  ${projects.length + 1}. Create new project`)
  console.log(`  ${projects.length + 2}. Skip (don't add to project)`)
  console.log('')

  while (true) {
    const answer = await promptUser(`Select a project (1-${projects.length + 2}): `)
    const selection = parseInt(answer)

    if (selection === projects.length + 2) {
      console.log('Skipping project selection.\n')
      return null
    }

    if (selection === projects.length + 1) {
      // Create new project
      const projectName = await promptUser('Enter project name (or press Enter for default): ') || 'Lawallet NWC Epics'
      try {
        const projectNumber = await createProject(repo, projectName)
        console.log(`\nUsing newly created project #${projectNumber}\n`)
        return projectNumber
      } catch (error) {
        console.error(`\n✗ Failed to create project: ${error.message}`)
        console.error('Please try again or select an existing project.')
        continue
      }
    }

    if (selection >= 1 && selection <= projects.length) {
      const selectedProject = projects[selection - 1]
      console.log(`Selected: #${selectedProject.number} - ${selectedProject.name}\n`)
      return selectedProject.number
    }

    console.log(`Invalid selection. Please enter a number between 1 and ${projects.length + 2}.`)
  }
}

async function addIssueToProject(projectId, issueId) {
  const url = `${GITHUB_API_URL}/projects/columns/${projectId}/cards`
  // Note: This requires the project to have a default column
  // For Projects v2, we need to use GraphQL API or get columns first
  try {
    // Get project columns first
    const columnsUrl = `${GITHUB_API_URL}/projects/${projectId}/columns`
    const columns = await makeRequest(columnsUrl, { method: 'GET' })
    
    if (columns.length === 0) {
      throw new Error('Project has no columns')
    }

    // Add to first column
    const columnId = columns[0].id
    return makeRequest(`${GITHUB_API_URL}/projects/columns/${columnId}/cards`, {
      method: 'POST',
      body: JSON.stringify({
        content_id: issueId,
        content_type: 'Issue'
      })
    })
  } catch (error) {
    console.warn(`Could not add issue to project: ${error.message}`)
    console.warn('You may need to add issues to the project manually')
  }
}

async function getExistingIssues(repo) {
  const issues = []
  let page = 1
  const perPage = 100

  while (true) {
    const url = `${GITHUB_API_URL}/repos/${repo}/issues?state=all&per_page=${perPage}&page=${page}`
    const pageIssues = await makeRequest(url, { method: 'GET' })
    
    if (pageIssues.length === 0) break
    
    issues.push(...pageIssues.filter(issue => !issue.pull_request))
    page++
    
    if (pageIssues.length < perPage) break
  }

  return issues
}

async function main() {
  const issuesFile = path.join(__dirname, '..', 'github-issues.json')

  if (!fs.existsSync(issuesFile)) {
    console.error(`Error: ${issuesFile} not found`)
    process.exit(1)
  }

  const data = JSON.parse(fs.readFileSync(issuesFile, 'utf8'))
  const { repository, issues: plannedIssues } = data

  console.log('Creating GitHub project epics...\n')
  console.log(`Repository: ${repository}`)
  
  // Get project number - either from env var or prompt user
  let projectNumber = GITHUB_PROJECT_NUMBER
  if (!projectNumber) {
    projectNumber = await selectProject(repository)
  } else {
    console.log(`Project: #${projectNumber}\n`)
  }

  // Fetch existing issues to get their numbers
  console.log('Fetching existing issues from GitHub...')
  const existingIssues = await getExistingIssues(repository)
  console.log(`Found ${existingIssues.length} existing issues\n`)

  // Create a map of issue title to issue number
  const issueMap = new Map()
  existingIssues.forEach(issue => {
    issueMap.set(issue.title, issue.number)
  })

  const results = {
    epics: [],
    linked: [],
    failed: []
  }

  // Create epic issues
  for (const [epicTitle, epicConfig] of Object.entries(EPIC_GROUPS)) {
    try {
      console.log(`Creating epic: ${epicTitle}`)
      
      const epicBody = `## Epic: ${epicTitle}\n\n${epicConfig.description}\n\n## Related Issues\n\nThis epic includes the following issues:\n${epicConfig.issueIndices.map(idx => `- ${plannedIssues[idx]?.title || `Issue #${idx}`}`).join('\n')}\n\n## Labels\n\n${epicConfig.labels.join(', ')}`

      const epicIssue = await createIssue(repository, {
        title: `[Epic] ${epicTitle}`,
        body: epicBody,
        labels: epicConfig.labels
      })

      results.epics.push({
        title: epicTitle,
        issueNumber: epicIssue.number,
        url: epicIssue.html_url,
        childIssueIndices: epicConfig.issueIndices
      })

      console.log(`  ✓ Created epic: #${epicIssue.number} - ${epicIssue.html_url}\n`)

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 200))
    } catch (error) {
      console.error(`  ✗ Failed to create epic "${epicTitle}": ${error.message}\n`)
      results.failed.push({
        epic: epicTitle,
        error: error.message
      })
    }
  }

  // Update child issues to reference their epic
  console.log('\nLinking issues to epics...\n')
  
  for (const epic of results.epics) {
    for (const issueIndex of epic.childIssueIndices) {
      if (issueIndex >= plannedIssues.length) {
        console.warn(`  ⚠️  Issue index ${issueIndex} out of range`)
        continue
      }

      const plannedIssue = plannedIssues[issueIndex]
      const issueNumber = issueMap.get(plannedIssue.title)
      
      if (!issueNumber) {
        console.warn(`  ⚠️  Issue "${plannedIssue.title}" not found in repository (may not be created yet)`)
        results.linked.push({
          issue: plannedIssue.title,
          epic: epic.title,
          epicNumber: epic.issueNumber,
          status: 'not_found'
        })
        continue
      }

      const epicReference = `\n\n---\n\n**Epic:** #${epic.issueNumber} - ${epic.title}`
      
      try {
        // Update issue body to include epic reference
        const currentIssue = existingIssues.find(i => i.number === issueNumber)
        const updatedBody = currentIssue.body + epicReference
        
        await updateIssue(repository, issueNumber, {
          body: updatedBody
        })
        
        console.log(`  ✓ Linked issue #${issueNumber} "${plannedIssue.title}" to epic #${epic.issueNumber}`)
        
        results.linked.push({
          issue: plannedIssue.title,
          issueNumber: issueNumber,
          epic: epic.title,
          epicNumber: epic.issueNumber,
          status: 'linked'
        })

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        console.error(`  ✗ Failed to link issue "${plannedIssue.title}": ${error.message}`)
        results.failed.push({
          issue: plannedIssue.title,
          epic: epic.title,
          error: error.message
        })
      }
    }
  }

  // Add to GitHub Project if project number is provided
  if (projectNumber) {
    console.log(`\nAdding issues to GitHub Project #${projectNumber}...\n`)
    
    try {
      const projectId = await getProjectId(repository, projectNumber)
      console.log(`  ✓ Found project ID: ${projectId}`)

      // Get project columns
      const columnsUrl = `${GITHUB_API_URL}/projects/${projectId}/columns`
      const columns = await makeRequest(columnsUrl, { method: 'GET' })
      
      if (columns.length === 0) {
        throw new Error('Project has no columns')
      }

      const columnId = columns[0].id
      console.log(`  ✓ Using column: ${columns[0].name} (ID: ${columnId})`)

      // Add epic issues to project
      for (const epic of results.epics) {
        try {
          const epicIssue = existingIssues.find(i => i.number === epic.issueNumber) || 
                          await makeRequest(`${GITHUB_API_URL}/repos/${repository}/issues/${epic.issueNumber}`, { method: 'GET' })
          
          await makeRequest(`${GITHUB_API_URL}/projects/columns/${columnId}/cards`, {
            method: 'POST',
            body: JSON.stringify({
              content_id: epicIssue.id,
              content_type: 'Issue'
            })
          })
          console.log(`  ✓ Added epic #${epic.issueNumber} to project`)
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch (error) {
          console.warn(`  ⚠️  Could not add epic #${epic.issueNumber} to project: ${error.message}`)
        }
      }

      // Add linked issues to project
      for (const linked of results.linked.filter(l => l.status === 'linked')) {
        try {
          const linkedIssue = existingIssues.find(i => i.number === linked.issueNumber)
          if (linkedIssue) {
            await makeRequest(`${GITHUB_API_URL}/projects/columns/${columnId}/cards`, {
              method: 'POST',
              body: JSON.stringify({
                content_id: linkedIssue.id,
                content_type: 'Issue'
              })
            })
            console.log(`  ✓ Added issue #${linked.issueNumber} to project`)
            await new Promise(resolve => setTimeout(resolve, 200))
          }
        } catch (error) {
          // Issue might already be in project, ignore
          console.warn(`  ⚠️  Could not add issue #${linked.issueNumber} to project: ${error.message}`)
        }
      }
    } catch (error) {
      console.error(`  ✗ Failed to add issues to project: ${error.message}`)
      console.error('   You may need to add issues to the project manually')
    }
  }

  // Summary
  console.log('\n=== Summary ===')
  console.log(`Epics created: ${results.epics.length}`)
  console.log(`Issues linked: ${results.linked.length}`)
  console.log(`Failed: ${results.failed.length}\n`)

  if (results.epics.length > 0) {
    console.log('Created epics:')
    results.epics.forEach(({ title, issueNumber, url }) => {
      console.log(`  #${issueNumber}: ${title} - ${url}`)
    })
  }

  if (results.linked.length > 0) {
    const linked = results.linked.filter(l => l.status === 'linked')
    const notFound = results.linked.filter(l => l.status === 'not_found')
    
    if (linked.length > 0) {
      console.log('\nLinked issues:')
      const grouped = {}
      linked.forEach(({ issue, issueNumber, epic, epicNumber }) => {
        if (!grouped[epic]) grouped[epic] = []
        grouped[epic].push({ issue, issueNumber, epicNumber })
      })
      Object.entries(grouped).forEach(([epic, items]) => {
        console.log(`\n  Epic #${items[0].epicNumber} - ${epic}:`)
        items.forEach(({ issue, issueNumber }) => {
          console.log(`    ✓ #${issueNumber}: ${issue}`)
        })
      })
    }

    if (notFound.length > 0) {
      console.log('\nIssues not found (may need to be created first):')
      const grouped = {}
      notFound.forEach(({ issue, epic, epicNumber }) => {
        if (!grouped[epic]) grouped[epic] = []
        grouped[epic].push({ issue, epicNumber })
      })
      Object.entries(grouped).forEach(([epic, items]) => {
        console.log(`\n  Epic #${items[0].epicNumber} - ${epic}:`)
        items.forEach(({ issue }) => {
          console.log(`    ⚠️  ${issue}`)
        })
      })
      console.log('\n  Run create-github-issues.js first to create these issues.')
    }
  }

  if (results.failed.length > 0) {
    console.log('\nFailed operations:')
    results.failed.forEach(({ epic, issue, error }) => {
      const name = epic || issue || 'Unknown'
      console.log(`  ${name}: ${error}`)
    })
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
