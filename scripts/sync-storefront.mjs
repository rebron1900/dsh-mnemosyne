#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const storefrontOwner = process.env.STOREFRONT_OWNER ?? 'awesome-dsh-plugin'
const storefrontRepo = process.env.STOREFRONT_REPO ?? 'awesome-dsh-plugin'
const pluginOwner = process.env.PLUGIN_OWNER ?? 'rebron1900'
const pluginRepo = process.env.PLUGIN_REPO ?? 'dsh-mnemosyne'
const pluginPackage = process.env.PLUGIN_PACKAGE ?? 'dsh-mnemosyne'
const pluginUrl = `https://github.com/${pluginOwner}/${pluginRepo}`
const branch = `sync/${pluginOwner}__${pluginRepo}`
// The upstream storefront repo is read-only for contributors (its README/CI
// review each PR). We push the branch to our own fork and open a cross-repo PR
// with `gh pr create --head owner:branch`, which works without push access.
const forkOwner = process.env.STOREFRONT_FORK_OWNER ?? pluginOwner
const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const dryRun = process.env.DRY_RUN === '1'

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
}

function ghApi(path) {
  return JSON.parse(run('gh', ['api', path]))
}

function yamlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function checkRequirements() {
  const repoInfo = ghApi(`repos/${pluginOwner}/${pluginRepo}`)
  const commits = ghApi(`repos/${pluginOwner}/${pluginRepo}/commits?per_page=100`).length
  const topics = ghApi(`repos/${pluginOwner}/${pluginRepo}/topics`).names ?? []
  const failures = []
  const ageDays = (Date.now() - Date.parse(repoInfo.created_at)) / 86_400_000

  if (ageDays < 1) failures.push(`repository age is ${ageDays.toFixed(2)} days; at least 1 day is required`)
  if (commits < 10) failures.push(`repository has ${commits} commits; at least 10 are required`)
  if (!topics.includes('dsh-plugin')) failures.push('repository is missing the dsh-plugin topic')
  if (!packageJson.dsh?.bundle) failures.push('package.json is missing dsh.bundle')
  if (repoInfo.archived) failures.push('repository is archived')
  if (failures.length) throw new Error(`storefront requirements not met:\n- ${failures.join('\n- ')}`)
}

function getPublishedVersion() {
  const metadata = JSON.parse(run('npm', ['view', pluginPackage, '--json']))
  const version = metadata.version
  const publishedAt = metadata.time?.[version]
  if (!version || !publishedAt) throw new Error(`npm metadata has no publish time for ${pluginPackage}`)
  return { version, publishedAt }
}

function buildEntry() {
  return [
    `url: ${pluginUrl}`,
    `name: ${pluginOwner}/${pluginRepo}`,
    'category: memory',
    'description:',
    `  en: ${yamlQuote(packageJson.description)}`,
    `  zh: ${yamlQuote('Mnemosyne 记忆插件 for DeepSeek Harness：提供 remember / recall / forget / stats / sleep 工具、内嵌技能、Settings 面板和可选的自动记忆功能。')}`,
    '',
  ].join('\n')
}

function hasExistingEntry() {
  try {
    run('gh', ['api', `repos/${storefrontOwner}/${storefrontRepo}/contents/data/plugins/${pluginOwner}__${pluginRepo}.yml?ref=main`])
    return true
  } catch {
    return false
  }
}

function hasOpenSyncPullRequest() {
  // gh api -f q=... sends the value unencoded; the search API rejects the
  // colon-heavy qualifier string with 404. Percent-encode the query instead.
  const query = encodeURIComponent(`repo:${storefrontOwner}/${storefrontRepo} is:pr is:open head:${forkOwner}:${branch}`)
  return JSON.parse(run('gh', ['api', `search/issues?q=${query}`])).total_count > 0
}

function updateStorefront() {
  const worktree = resolve(root, '.storefront-sync')
  run('git', ['clone', `https://github.com/${storefrontOwner}/${storefrontRepo}.git`, worktree])
  // Contributions land via a fork: the bot token has no push on the upstream
  // repo, so the branch is pushed to forkOwner's remote instead.
  const forkUrl = `https://github.com/${forkOwner}/${storefrontRepo}.git`
  run('git', ['-C', worktree, 'remote', 'add', 'fork', forkUrl])
  const entryFile = `data/plugins/${pluginOwner}__${pluginRepo}.yml`
  const entryPath = resolve(worktree, entryFile)
  const exists = hasExistingEntry()

  run('git', ['-C', worktree, 'switch', '-c', branch])

  writeFileSync(entryPath, buildEntry())
  run('npm', ['ci'], { cwd: worktree })
  run('node', ['scripts/generate-readme.mjs'], { cwd: worktree })
  run('git', ['-C', worktree, 'config', 'user.name', 'github-actions[bot]'])
  run('git', ['-C', worktree, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  run('git', ['-C', worktree, 'add', entryFile, 'README.md', 'README.zh.md'])

  try {
    run('git', ['-C', worktree, 'diff', '--cached', '--quiet'])
    console.log('skip: storefront entry is already current')
    return
  } catch {
    // A non-zero status means there are staged changes to submit.
  }

  const action = exists ? 'update' : 'add'
  run('git', ['-C', worktree, 'commit', '-m', `${action}: ${pluginOwner}/${pluginRepo}`])
  // Push to the fork, never the read-only upstream remote.
  run('git', ['-C', worktree, 'push', '--set-upstream', 'fork', `HEAD:${branch}`])

  if (!hasOpenSyncPullRequest()) {
    run('gh', ['pr', 'create', '-R', `${storefrontOwner}/${storefrontRepo}`, '--base', 'main', '--head', `${forkOwner}:${branch}`, '--title', `${action === 'add' ? 'Add' : 'Update'} ${pluginPackage} plugin`, '--body', `Automated storefront ${action} for ${pluginPackage}@${packageJson.version}.`])
  }
}

checkRequirements()
const published = getPublishedVersion()
const ageDays = (Date.now() - Date.parse(published.publishedAt)) / 86_400_000
if (ageDays < 1) {
  console.log(`skip: ${pluginPackage}@${published.version} was published ${ageDays.toFixed(2)} days ago`)
  process.exit(0)
}
if (hasOpenSyncPullRequest()) {
  console.log(`skip: an open storefront sync PR already exists for ${pluginUrl}`)
  process.exit(0)
}
if (dryRun) {
  console.log(`would sync ${pluginPackage}@${published.version} to ${branch}`)
  process.exit(0)
}
updateStorefront()
