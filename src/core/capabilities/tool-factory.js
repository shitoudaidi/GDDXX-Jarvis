import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { paths } from '../paths.js'
import {
  analyzeToolCode,
  installTool,
  isInstalledTool,
  normalizeToolPermissions,
  validateToolManifest,
} from './marketplace/index.js'

const PROPOSALS_DIR = path.join(paths.sandboxDir, 'tool_proposals')
const REVIEW_TIMEOUT_MS = 3000
const MAX_CODE_CHARS = 12000
const MAX_TESTS = 20

function ensureProposalDir() {
  fs.mkdirSync(PROPOSALS_DIR, { recursive: true })
}

function toolJson(payload) {
  return JSON.stringify(payload, null, 2)
}

function nowIso() {
  return new Date().toISOString()
}

function safeNamePart(value = '') {
  return String(value || 'tool').replace(/[^a-z0-9_]+/gi, '_').slice(0, 32) || 'tool'
}

function newProposalId(name) {
  const stamp = Date.now().toString(36)
  const rand = crypto.randomBytes(3).toString('hex')
  return `tp_${safeNamePart(name)}_${stamp}_${rand}`
}

function proposalPath(id) {
  if (!/^tp_[a-zA-Z0-9_]+_[a-z0-9]+_[a-f0-9]{6}$/.test(String(id || ''))) {
    throw new Error('invalid proposal_id')
  }
  return path.join(PROPOSALS_DIR, `${id}.json`)
}

function readProposal(id) {
  ensureProposalDir()
  const filePath = proposalPath(id)
  if (!fs.existsSync(filePath)) throw new Error(`proposal not found: ${id}`)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function writeProposal(proposal) {
  ensureProposalDir()
  proposal.updated_at = nowIso()
  fs.writeFileSync(proposalPath(proposal.id), JSON.stringify(proposal, null, 2), 'utf-8')
  return proposal
}

function normalizeTests(tests) {
  if (!Array.isArray(tests)) return []
  return tests.slice(0, MAX_TESTS).map((t, index) => ({
    name: String(t?.name || `test_${index + 1}`).slice(0, 80),
    args: t?.args && typeof t.args === 'object' ? t.args : {},
    expect: t?.expect ?? t?.expected_result,
    expect_contains: t?.expect_contains,
    expect_json: t?.expect_json,
  }))
}

function packageFromArgs(args = {}) {
  const permissions = normalizeToolPermissions(args.permissions || {})
  return {
    name: args.name,
    description: args.description,
    parameters: args.parameters_schema || args.parameters,
    permissions,
    code: args.code,
    tests: normalizeTests(args.tests),
  }
}

function runToolTests(pkg) {
  const runner = `
    import { readFileSync } from 'node:fs';
    const payload = JSON.parse(readFileSync(0, 'utf-8'));
    const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const stringify = (v) => typeof v === 'string' ? v : JSON.stringify(v);
    const helpers = {
      fetch: async () => { throw new Error('network disabled during tool proposal tests'); },
      exec: async () => { throw new Error('exec disabled during tool proposal tests'); },
      log: () => {},
    };
    let fn;
    try {
      fn = new Function(
        'args',
        'helpers',
        'fetch',
        'process',
        'globalThis',
        'require',
        'module',
        'exports',
        'Buffer',
        '"use strict";\\nreturn (async () => {\\n' + payload.code + '\\n})()'
      );
    } catch (err) {
      console.log(JSON.stringify({ ok: false, issue: 'compile failed: ' + err.message }));
      process.exit(0);
    }
    const results = [];
    for (const test of payload.tests) {
      try {
        const raw = await fn(test.args || {}, helpers, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
        let ok = true;
        const checks = [];
        if (Object.prototype.hasOwnProperty.call(test, 'expect')) {
          ok = ok && deepEqual(raw, test.expect);
          checks.push('expect');
        }
        if (test.expect_contains !== undefined) {
          ok = ok && stringify(raw).includes(String(test.expect_contains));
          checks.push('expect_contains');
        }
        if (test.expect_json !== undefined) {
          let parsed = raw;
          if (typeof raw === 'string') parsed = JSON.parse(raw);
          ok = ok && deepEqual(parsed, test.expect_json);
          checks.push('expect_json');
        }
        results.push({ name: test.name, ok, checks, result: stringify(raw).slice(0, 300) });
      } catch (err) {
        results.push({ name: test.name, ok: false, error: err.message });
      }
    }
    console.log(JSON.stringify({ ok: results.every(r => r.ok), results }));
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', runner], {
    input: JSON.stringify({ code: pkg.code, tests: pkg.tests }),
    encoding: 'utf-8',
    timeout: REVIEW_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
  })
  if (child.error) {
    return { ok: false, issue: child.error.message, results: [] }
  }
  if (child.status !== 0) {
    return {
      ok: false,
      issue: (child.stderr || child.stdout || `test process exited ${child.status}`).trim().slice(0, 500),
      results: [],
    }
  }
  try {
    return JSON.parse(String(child.stdout || '').trim())
  } catch {
    return { ok: false, issue: 'test process returned non-json output', results: [] }
  }
}

export function reviewToolPackage(pkg = {}) {
  const issues = []
  const warnings = []
  let normalized = null

  try {
    if (String(pkg.code || '').length > MAX_CODE_CHARS) {
      issues.push(`code is too long; max ${MAX_CODE_CHARS} chars`)
    }
    if (pkg.permissions?.exec === true) {
      issues.push('generated tools may not request exec permission in this managed pipeline')
    }
    normalized = validateToolManifest(pkg)
  } catch (err) {
    issues.push(err.message)
  }

  const staticIssues = analyzeToolCode(pkg.code || '', pkg.permissions || {})
  for (const issue of staticIssues) {
    if (!issues.includes(issue)) issues.push(issue)
  }

  const tests = normalizeTests(pkg.tests)
  let testResult = { ok: false, results: [] }
  if (tests.length === 0) {
    issues.push('at least one test is required')
  } else if (issues.length === 0) {
    testResult = runToolTests({ ...pkg, tests })
    if (!testResult.ok) {
      issues.push(testResult.issue || 'one or more tests failed')
    }
  }

  if (pkg.permissions?.network === true) {
    warnings.push('network permission requested; tests run with network disabled')
  }

  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? 'approved' : 'rejected',
    issues,
    warnings,
    test_results: testResult.results || [],
    manifest: normalized ? {
      name: normalized.name,
      description: normalized.description,
      parameters: normalized.parameters,
      permissions: normalized.permissions,
      code: normalized.code,
    } : null,
  }
}

function listProposals() {
  ensureProposalDir()
  return fs.readdirSync(PROPOSALS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(PROPOSALS_DIR, f), 'utf-8'))
        return {
          id: p.id,
          name: p.package?.name,
          status: p.status,
          created_at: p.created_at,
          updated_at: p.updated_at,
          issues: p.review?.issues || [],
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export async function execManageToolFactory(args = {}) {
  const action = String(args.action || '').trim().toLowerCase()
  try {
    if (action === 'propose') {
      const pkg = packageFromArgs(args)
      const id = newProposalId(pkg.name)
      const proposal = writeProposal({
        id,
        status: 'draft',
        package: pkg,
        review: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      })
      return toolJson({
        ok: true,
        action,
        proposal_id: proposal.id,
        status: proposal.status,
        next: 'Call manage_tool_factory with action="review" and this proposal_id. Only approved proposals can be installed.',
      })
    }

    if (action === 'review') {
      const proposal = readProposal(args.proposal_id)
      const review = reviewToolPackage(proposal.package)
      proposal.review = {
        ...review,
        reviewed_at: nowIso(),
      }
      proposal.status = review.status
      writeProposal(proposal)
      return toolJson({
        ok: review.ok,
        action,
        proposal_id: proposal.id,
        status: proposal.status,
        issues: review.issues,
        warnings: review.warnings,
        test_results: review.test_results,
      })
    }

    if (action === 'install') {
      const proposal = readProposal(args.proposal_id)
      if (proposal.status !== 'approved' || !proposal.review?.ok) {
        return toolJson({
          ok: false,
          action,
          proposal_id: proposal.id,
          status: proposal.status,
          error: 'proposal is not approved; review it first and fix all issues',
          issues: proposal.review?.issues || [],
        })
      }
      if (isInstalledTool(proposal.package.name)) {
        return toolJson({ ok: false, action, proposal_id: proposal.id, error: `tool already installed: ${proposal.package.name}` })
      }
      const result = await installTool({
        name: proposal.package.name,
        description: proposal.package.description,
        parameters: proposal.package.parameters,
        permissions: proposal.package.permissions,
        code: proposal.package.code,
      })
      proposal.status = 'installed'
      proposal.installed_at = nowIso()
      writeProposal(proposal)
      return toolJson({
        ok: true,
        action,
        proposal_id: proposal.id,
        status: proposal.status,
        tool: proposal.package.name,
        result,
      })
    }

    if (action === 'get') {
      const proposal = readProposal(args.proposal_id)
      return toolJson({ ok: true, action, proposal })
    }

    if (action === 'list') {
      return toolJson({ ok: true, action, proposals: listProposals() })
    }

    if (action === 'delete') {
      const filePath = proposalPath(args.proposal_id)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return toolJson({ ok: true, action, proposal_id: args.proposal_id })
    }

    return toolJson({
      ok: false,
      tool: 'manage_tool_factory',
      error: 'unsupported action',
      supported_actions: ['propose', 'review', 'install', 'get', 'list', 'delete'],
    })
  } catch (err) {
    return toolJson({ ok: false, tool: 'manage_tool_factory', action, error: err.message })
  }
}

export const __internal = {
  PROPOSALS_DIR,
  packageFromArgs,
  reviewToolPackage,
  runToolTests,
}
