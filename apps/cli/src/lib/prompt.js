import readline from 'node:readline/promises'
import process from 'node:process'

function createPromptInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
}

export async function promptText({
  message,
  defaultValue = '',
  skipPrompt = false
}) {
  if (skipPrompt || !process.stdin.isTTY) {
    return defaultValue
  }

  const rl = createPromptInterface()
  const suffix = defaultValue ? ` [${defaultValue}]` : ''
  const answer = await rl.question(`${message}${suffix}: `)

  rl.close()

  return answer.trim() || defaultValue
}

export async function promptConfirm({
  message,
  defaultValue = true,
  skipPrompt = false
}) {
  if (skipPrompt || !process.stdin.isTTY) {
    return defaultValue
  }

  const rl = createPromptInterface()
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]'
  const answer = (await rl.question(`${message}${suffix}: `)).trim().toLowerCase()

  rl.close()

  if (!answer) {
    return defaultValue
  }

  return ['y', 'yes'].includes(answer)
}
