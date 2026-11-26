import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';
import { StepStatus } from '../domain/status.mjs';
import { WorkflowError } from '../domain/errors.mjs';
import { acquireRunLock, processIsAlive } from './run-lock.mjs';
import { statePath, createInitialState, createInitialNodeState, saveState } from './state-store.mjs';
import { migrateState } from './state-migrations.mjs';

const APPROVAL_CONFIRMATION = 'APPROVE';

function topicSlug(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function assertRunContext({ workspaceRoot, runId, tema, inputFiles }) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new TypeError('workspaceRoot is required');
  }
  if (typeof runId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId)) {
    throw new TypeError('runId must contain 1–64 letters, numbers, underscores, or hyphens');
  }
  if (tema !== undefined && (typeof tema !== 'string' || !tema.trim())) {
    throw new TypeError('tema must be a non-empty string');
  }
  if (!Array.isArray(inputFiles)) {
    throw new TypeError('inputFiles must be an array');
  }
}

async function resolveRunContext(context) {
  assertRunContext(context);
  const workspaceRoot = resolve(context.workspaceRoot);
  const realRoot = await realpath(workspaceRoot);
  const inputs = [...new Set(context.inputFiles)].sort();
  const topics = new Set();

  if (inputs.length > 0) {
    for (const input of inputs) {
      if (typeof input !== 'string' || input.length === 0 || isAbsolute(input)) {
        throw new TypeError('inputFiles must contain non-empty relative paths');
      }

      const absolutePath = resolve(workspaceRoot, input);
      const relativePath = relative(workspaceRoot, absolutePath);
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
        throw new WorkflowError('PREREQ_NOT_MET', `Input path must stay inside the workspace: ${input}`);
      }

      let actualPath;
      try {
        actualPath = await realpath(absolutePath);
        const actualRelativePath = relative(realRoot, actualPath);
        if (
          !actualRelativePath ||
          actualRelativePath === '..' ||
          actualRelativePath.startsWith(`..${sep}`) ||
          isAbsolute(actualRelativePath)
        ) {
          throw new WorkflowError('PREREQ_NOT_MET', `Input resolves outside the workspace: ${input}`);
        }
        const topic = /^workspace\/\.discovery\/([^/]+)\/\.input\//.exec(actualRelativePath.split(sep).join('/'))?.[1];
        if (topic) topics.add(topic);
      } catch (error) {
        if (error.message.startsWith('Input resolves outside')) {
          throw error;
        }
        throw new WorkflowError('PREREQ_NOT_MET', `Input file cannot be read: ${input}`, { cause: error });
      }
    }
  }

  if (!context.tema && topics.size > 1) {
    throw new WorkflowError('PREREQ_NOT_MET', 'Workflow inputs belong to multiple discovery topics; provide an explicit tema');
  }
  if (inputs.length === 0 && !context.tema) {
    throw new WorkflowError('PREREQ_NOT_MET', '--tema is required when no --input files are provided');
  }
  const legacyTopic = [...topics][0] ?? context.runId;
  const tema = context.tema?.trim() ?? legacyTopic;
  const nodeId = topicSlug(tema);
  if (!nodeId) throw new WorkflowError('PREREQ_NOT_MET', `Invalid tema; it must contain letters or numbers: ${tema}`);
  return {
    ...context,
    workspaceRoot,
    tema,
    nodeId,
    initiative: context.tema ? context.runId : legacyTopic,
    legacyTopic,
  };
}


async function withRunLock(context, action) {
  const release = await acquireRunLock(statePath(context));
  try {
    return await action();
  } finally {
    await release();
  }
}

async function loadOrCreateState(context) {
  const filePath = statePath(context);
  let initiativeState;
  try {
    const text = await readFile(filePath, 'utf8');
    try {
      initiativeState = JSON.parse(text);
    } catch (error) {
      throw new WorkflowError('SCHEMA_MIGRATION_FAILED', `Workflow state is not valid JSON: ${filePath}`, { cause: error });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    initiativeState = createInitialState(context);
  }

  const { state: migratedInitiativeState, migrated } = migrateState(initiativeState, context, filePath);
  initiativeState = migratedInitiativeState;

  let state = Object.hasOwn(initiativeState.nodes, context.nodeId)
    ? initiativeState.nodes[context.nodeId]
    : undefined;
  if (!state) {
    state = createInitialNodeState(context);
    initiativeState.nodes[context.nodeId] = state;
    initiativeState.updatedAt = state.updatedAt;
    await saveState(filePath, initiativeState);
    return { initiativeState, state };
  }
  if (state.tema !== context.tema) {
    throw new WorkflowError('PREREQ_NOT_MET', `Tema "${context.tema}" collides with existing tema "${state.tema}" after normalization`);
  }

  let stepsMigrated = false;
  for (const { id } of WORKFLOW_STEPS) {
    if (!Object.hasOwn(state.steps, id)) {
      state.steps[id] = { status: StepStatus.PENDING, artifacts: {} };
      stepsMigrated = true;
    }
  }

  let changed = false;

  // Detect input file changes and invalidate non-accumulative completed steps
  if (context.inputFiles?.length > 0) {
    const currentFingerprint = await computeInputFingerprint(context.workspaceRoot, context.inputFiles);
    if (state.inputFingerprint && state.inputFingerprint !== currentFingerprint) {
      for (const step of WORKFLOW_STEPS) {
        const current = state.steps[step.id];
        if (current?.status === StepStatus.COMPLETED && !step.accumulative && step.kind !== 'approval') {
          state.steps[step.id] = { status: StepStatus.PENDING, artifacts: {} };
          changed = true;
        }
      }
    }
    if (state.inputFingerprint !== currentFingerprint) {
      state.inputFingerprint = currentFingerprint;
      changed = true;
    }
  }

  for (const step of WORKFLOW_STEPS) {
    const current = state.steps[step.id];
    if (!current || (current.status !== StepStatus.COMPLETED && current.status !== StepStatus.ACCUMULATING) || step.kind === 'approval') {
      continue;
    }
    try {
      await verifyStoredArtifacts(context, step, current.artifacts, state.legacyOutputPaths);
    } catch (error) {
      if (!(error instanceof ArtifactValidationError)) {
        throw error;
      }
      invalidateFromStep(state, step.id, error.message);
      state.updatedAt = new Date().toISOString();
      changed = true;
      break;
    }
  }

  const gate = WORKFLOW_STEPS.find(({ kind }) => kind === 'approval');
  const gateState = state.steps[gate.id];
  if (gateState?.status === StepStatus.COMPLETED) {
    for (const dependencyId of gate.requires) {
      const currentArtifacts = state.steps[dependencyId]?.artifacts;
      const approvedArtifacts = gateState.approvedArtifacts?.[dependencyId];
      if (!sameArtifactReferences(currentArtifacts, approvedArtifacts)) {
        invalidateFromStep(
          state,
          dependencyId,
          `Approval invalidated because "${dependencyId}" changed`,
        );
        state.updatedAt = new Date().toISOString();
        changed = true;
        break;
      }
    }
  }
  if (changed || migrated || stepsMigrated) {
    initiativeState.nodes[context.nodeId] = state;
    initiativeState.updatedAt = state.updatedAt;
    await saveState(filePath, initiativeState);
  }
  return { initiativeState, state };
}

class ArtifactValidationError extends Error {}

export async function createArtifactReference(workspaceRoot, artifactRelativePath) {
  if (
    typeof artifactRelativePath !== 'string' ||
    artifactRelativePath.length === 0 ||
    isAbsolute(artifactRelativePath)
  ) {
    throw new ArtifactValidationError('Artifact path must be a non-empty relative path');
  }

  const root = resolve(workspaceRoot);
  const artifactPath = resolve(root, artifactRelativePath);
  const workspaceRelativePath = relative(root, artifactPath);
  if (
    !workspaceRelativePath ||
    workspaceRelativePath === '..' ||
    workspaceRelativePath.startsWith(`..${sep}`)
  ) {
    throw new ArtifactValidationError('Artifact path must stay inside the workspace');
  }

  let realRoot;
  let realArtifact;
  let content;
  try {
    [realRoot, realArtifact] = await Promise.all([realpath(root), realpath(artifactPath)]);
    const realRelativePath = relative(realRoot, realArtifact);
    if (
      !realRelativePath ||
      realRelativePath === '..' ||
      realRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(realRelativePath)
    ) {
      throw new ArtifactValidationError('Artifact resolves outside the workspace');
    }
    content = await readFile(realArtifact);
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      throw error;
    }
    throw new ArtifactValidationError(`Artifact cannot be read: ${artifactRelativePath}`, {
      cause: error,
    });
  }

  return {
    path: artifactRelativePath,
  };
}

async function verifyArtifact(workspaceRoot, reference) {
  if (!reference || typeof reference.path !== 'string') {
    throw new ArtifactValidationError('Artifact reference is invalid');
  }
  return await createArtifactReference(workspaceRoot, reference.path);
}

const KNOWLEDGE_CATEGORIES = ['legado', 'refatorado', 'dominios'];

function outputDirectory(context, step) {
  return step.outputDirectory?.replace('<iniciativa>', context.initiative);
}

function markdownTableHeaders(markdown) {
  const lines = markdown.split(/\r?\n/);
  return lines.flatMap((line, index) => {
    if (!line.trim().startsWith('|') || !/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1] ?? '')) {
      return [];
    }
    return [line.trim().split('|').slice(1, -1).map((cell) => cell.trim()).join('|')];
  });
}

async function validateTemplateHeadings(context, step, documents) {
  if (step.id !== 'business-epic') return;

  let templatePath = new URL(`../../resources/${step.templates[0]}`, import.meta.url);
  let template;
  try {
    template = await readFile(templatePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    templatePath = new URL(`../${step.templates[0]}`, import.meta.url);
    template = await readFile(templatePath, 'utf8');
  }
  const requiredHeadings = [...template.matchAll(/^#{1,6}\s+.+$/gm)]
    .map(([heading]) => heading.replaceAll('<tema>', context.tema));
  const documentHeadings = [...documents[step.outputs[0]].matchAll(/^#{1,6}\s+.+$/gm)]
    .map(([heading]) => heading);
  let documentIndex = 0;
  const missingHeadings = requiredHeadings.filter((heading) => {
    while (documentIndex < documentHeadings.length && documentHeadings[documentIndex] !== heading) {
      documentIndex += 1;
    }
    if (documentIndex === documentHeadings.length) return true;
    documentIndex += 1;
    return false;
  });
  const requiredTables = markdownTableHeaders(template);
  const documentTables = markdownTableHeaders(documents[step.outputs[0]]);
  let tableIndex = 0;
  const missingTables = requiredTables.filter((table) => {
    while (tableIndex < documentTables.length && documentTables[tableIndex] !== table) {
      tableIndex += 1;
    }
    if (tableIndex === documentTables.length) return true;
    tableIndex += 1;
    return false;
  });

  if (missingHeadings.length || missingTables.length) {
    throw new WorkflowError(
      'ARTIFACT_NOT_FOUND',
      `Document for "${step.id}" must preserve the template headings and tables; missing headings: ${missingHeadings.join(', ') || 'none'}; missing tables: ${missingTables.join(', ') || 'none'}`,
    );
  }
}

async function assertOutputLocation(context, step, path) {
  const directory = outputDirectory(context, step);
  const prefix = `${directory}/`;
  const tail = typeof path === 'string' && path.startsWith(prefix) ? path.slice(prefix.length) : '';
  const parts = tail.split('/');
  const safe = parts.every((segment) => segment && segment !== '.' && segment !== '..' && !/[\\:]/.test(segment));
  const scope = parts.length === 1;
  if (!safe || !scope || !parts.at(-1).endsWith('.md')) {
    throw new ArtifactValidationError(`Output for "${step.id}" must be a Markdown file in ${directory}`);
  }
  await checkOutputDirectory(context.workspaceRoot, dirname(path).split(sep).join('/'));
  const info = await lstat(resolve(context.workspaceRoot, path)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (info && !info.isFile()) throw new ArtifactValidationError(`Output is not a regular file: ${path}`);
}

async function checkOutputDirectory(root, directory, create = false) {
  let current = root;
  for (const segment of directory.split('/')) {
    current = resolve(current, segment);
    if (create) {
      await mkdir(current).catch((error) => {
        if (error.code !== 'EEXIST') throw error;
      });
    }
    const info = await lstat(current).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!info) return;
    if (!info.isDirectory()) throw new ArtifactValidationError(`Output directory must not be a symlink or file: ${current}`);
  }
}

async function assertLegacyOutputLocation(context, step, path) {
  const isKnowledge = step.id === 'as-is-knowledge';
  const prefix = isKnowledge
    ? 'workspace/.knowledge/'
    : `workspace/.discovery/${context.legacyTopic}/results/`;
  const tail = typeof path === 'string' && path.startsWith(prefix) ? path.slice(prefix.length) : '';
  const parts = tail.split('/');
  const safe = parts.every((segment) => segment && segment !== '.' && segment !== '..' && !/[\\:]/.test(segment));
  const scope = isKnowledge
    ? parts.length >= 3 && KNOWLEDGE_CATEGORIES.includes(parts[0]) && parts[1] === context.legacyTopic
    : parts.length >= 1;
  if (!safe || !scope || !parts.at(-1).endsWith('.md')) {
    throw new ArtifactValidationError(`Stored legacy output for "${step.id}" is outside its original directory`);
  }
  await checkOutputDirectory(context.workspaceRoot, dirname(path).split(sep).join('/'));
  const info = await lstat(resolve(context.workspaceRoot, path)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!info?.isFile()) throw new ArtifactValidationError(`Stored legacy output is not a regular file: ${path}`);
}

async function verifyStoredArtifacts(context, step, artifacts, allowLegacyOutputPaths = false) {
  if (step.accumulative && Array.isArray(artifacts)) {
    for (const artifactGroup of artifacts) {
      const expected = [...step.outputs].sort();
      const actual = Object.keys(artifactGroup ?? {}).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new ArtifactValidationError(`Stored outputs for "${step.id}" are incomplete`);
      }
      for (const name of expected) {
        try {
          await assertOutputLocation(context, step, artifactGroup[name]?.path);
        } catch (error) {
          if (!allowLegacyOutputPaths || !(error instanceof ArtifactValidationError)) throw error;
          await assertLegacyOutputLocation(context, step, artifactGroup[name]?.path);
        }
        await verifyArtifact(context.workspaceRoot, artifactGroup[name]);
      }
    }
  } else {
    const expected = [...step.outputs].sort();
    const actual = Object.keys(artifacts ?? {}).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new ArtifactValidationError(`Stored outputs for "${step.id}" are incomplete`);
    }
    for (const name of expected) {
      try {
        await assertOutputLocation(context, step, artifacts[name]?.path);
      } catch (error) {
        if (!allowLegacyOutputPaths || !(error instanceof ArtifactValidationError)) throw error;
        await assertLegacyOutputLocation(context, step, artifacts[name]?.path);
      }
      await verifyArtifact(context.workspaceRoot, artifacts[name]);
    }
  }
}

async function saveCurrentState(context, record) {
  record.initiativeState.nodes[context.nodeId] = record.state;
  record.initiativeState.updatedAt = record.state.updatedAt;
  await saveState(statePath(context), record.initiativeState);
}

function computeApprovalFingerprint(state, gate) {
  const data = gate.requires
    .map((depId) => JSON.stringify({ depId, artifacts: state.steps[depId]?.artifacts ?? {} }))
    .join('\n');
  return createHash('sha256').update(data).digest('hex');
}

async function computeInputFingerprint(workspaceRoot, inputFiles) {
  const parts = await Promise.all(
    [...inputFiles].sort().map(async (file) => {
      try {
        const content = await readFile(resolve(workspaceRoot, file), 'utf8');
        return `${file}:${createHash('sha256').update(content).digest('hex')}`;
      } catch {
        return `${file}:missing`;
      }
    }),
  );
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function extractArtifactPaths(artifacts) {
  if (!artifacts || typeof artifacts !== 'object') return [];
  if (typeof artifacts.path === 'string') {
    return [artifacts.path];
  }
  const paths = [];
  for (const value of Object.values(artifacts)) {
    if (typeof value === 'string') {
      paths.push(value);
    } else if (typeof value?.path === 'string') {
      paths.push(value.path);
    } else if (value && typeof value === 'object') {
      paths.push(...extractArtifactPaths(value));
    }
  }
  return paths.sort();
}

function sameArtifactReferences(current, approved) {
  if (!current || !approved) {
    return false;
  }
  if (Array.isArray(current) && Array.isArray(approved)) {
    if (current.length !== approved.length) return false;
    return current.every((curr, idx) => {
      const app = approved[idx];
      return JSON.stringify(extractArtifactPaths(curr)) === JSON.stringify(extractArtifactPaths(app));
    });
  }
  if (Array.isArray(current) || Array.isArray(approved)) {
    return false;
  }
  return JSON.stringify(extractArtifactPaths(current)) === JSON.stringify(extractArtifactPaths(approved));
}

function invalidateFromStep(state, stepId, reason) {
  const affected = new Set([stepId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of WORKFLOW_STEPS) {
      if (!affected.has(step.id) && step.requires.some((dependency) => affected.has(dependency))) {
        affected.add(step.id);
        changed = true;
      }
    }
  }

  for (const id of affected) {
    const reset = {
      status: id === stepId ? StepStatus.FAILED : StepStatus.PENDING,
      artifacts: {},
    };
    if (id === stepId) {
      reset.error = reason;
    }
    state.steps[id] = reset;
  }
}

async function validatedPrerequisites(workspaceRoot, state, step) {
  const prerequisites = {};
  for (const dependencyId of step.requires) {
    const dependency = state.steps[dependencyId];
    if (!dependency || (dependency.status !== StepStatus.COMPLETED && dependency.status !== StepStatus.ACCUMULATING)) {
      throw new WorkflowError('PREREQ_NOT_MET', `Workflow blocked: prerequisite "${dependencyId}" is incomplete`);
    }

    const validatedArtifacts = {};
    if (dependencyId === 'validation-gate') {
      for (const [approvedStepId, artifacts] of Object.entries(dependency.approvedArtifacts ?? {})) {
        validatedArtifacts[approvedStepId] = {};
        if (Array.isArray(artifacts)) {
          validatedArtifacts[approvedStepId] = [];
          for (const artifactGroup of artifacts) {
            const validated = {};
            for (const [name, reference] of Object.entries(artifactGroup)) {
              validated[name] = await verifyArtifact(workspaceRoot, reference);
            }
            validatedArtifacts[approvedStepId].push(validated);
          }
        } else if (typeof artifacts?.path === 'string') {
          const verified = await verifyArtifact(workspaceRoot, artifacts);
          validatedArtifacts[approvedStepId] = {
            path: verified.path,
            [approvedStepId]: verified,
          };
        } else {
          for (const [name, reference] of Object.entries(artifacts)) {
            const verified = typeof reference === 'string'
              ? await verifyArtifact(workspaceRoot, { path: reference })
              : await verifyArtifact(workspaceRoot, reference);
            validatedArtifacts[approvedStepId][name] = verified;
          }
          if (typeof validatedArtifacts[approvedStepId][approvedStepId]?.path === 'string') {
            validatedArtifacts[approvedStepId].path = validatedArtifacts[approvedStepId][approvedStepId].path;
          }
        }
      }
    } else {
      for (const [name, reference] of Object.entries(dependency.artifacts)) {
        if (typeof reference === 'string') {
          validatedArtifacts[name] = await verifyArtifact(workspaceRoot, { path: reference });
        } else {
          validatedArtifacts[name] = await verifyArtifact(workspaceRoot, reference);
        }
      }
    }
    prerequisites[dependencyId] = validatedArtifacts;
  }
  return prerequisites;
}

async function validateOutputs(context, step, result) {
  if (!result || typeof result.artifacts !== 'object' || result.artifacts === null) {
    throw new ArtifactValidationError(`Step "${step.id}" did not return its artifact outputs`);
  }

  assertOutputKeys(step, result.artifacts);
  const artifacts = {};
  for (const name of step.outputs) {
    await assertOutputLocation(context, step, result.artifacts[name]?.path);
    artifacts[name] = await verifyArtifact(context.workspaceRoot, result.artifacts[name]);
  }
  return artifacts;
}

function assertOutputKeys(step, outputs) {
  const expected = [...step.outputs].sort();
  const actual = Object.keys(outputs).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ArtifactValidationError(
      `Step "${step.id}" output keys must be: ${expected.join(', ') || '(none)'}`,
    );
  }
}

export async function readWorkflowRun(context) {
  const resolvedContext = await resolveRunContext(context);
  return withRunLock(resolvedContext, async () => (await loadOrCreateState(resolvedContext)).state);
}

export async function getReadyStepDetails(context) {
  const resolvedContext = await resolveRunContext(context);
  return withRunLock(resolvedContext, async () => {
    const record = await loadOrCreateState(resolvedContext);
    const { state } = record;
    let reconciled = false;
    for (const current of Object.values(state.steps)) {
      if (current.status === StepStatus.RUNNING && !(await processIsAlive(current.executionPid))) {
        current.status = StepStatus.FAILED;
        current.error = 'Previous stage execution was interrupted and can be retried';
        delete current.executionPid;
        delete current.executionToken;
        reconciled = true;
      }
    }
    if (reconciled) {
      state.updatedAt = new Date().toISOString();
      await saveCurrentState(resolvedContext, record);
    }

    const ready = [];
    for (const step of WORKFLOW_STEPS) {
      const current = state.steps[step.id];
      if (current.status !== StepStatus.PENDING && current.status !== StepStatus.FAILED
          && !(step.accumulative && current.status === StepStatus.ACCUMULATING)) {
        continue;
      }
      try {
        const prerequisites = await validatedPrerequisites(
          resolvedContext.workspaceRoot,
          state,
          step,
        );
        const detail = {
          id: step.id,
          kind: step.kind ?? 'work',
          inputs: step.inputs,
          outputs: step.outputs,
          outputDirectory: outputDirectory(resolvedContext, step),
          templates: step.templates,
          instructions: step.instructions,
          prerequisites,
          ...(step.kind === 'approval' ? { approvalFingerprint: computeApprovalFingerprint(state, step) } : {}),
        };
        ready.push(detail);
      } catch (error) {
        if (!(error instanceof ArtifactValidationError) && !/Workflow blocked:/.test(error.message)) {
          throw error;
        }
      }
    }
    return ready;
  });
}

export async function getReadySteps(context) {
  return (await getReadyStepDetails(context)).map(({ id }) => id);
}

export async function registerWorkflowOutputs({ stepId, paths, ...rawContext }) {
  const context = await resolveRunContext(rawContext);
  const step = WORKFLOW_STEPS.find(({ id }) => id === stepId);
  if (!step?.outputDirectory) throw new WorkflowError('ARTIFACT_NOT_FOUND', `Step "${stepId}" does not register documents`);
  assertOutputKeys(step, paths);
  const artifacts = {};
  for (const name of step.outputs) {
    await assertOutputLocation(context, step, paths[name]);
    artifacts[name] = await createArtifactReference(context.workspaceRoot, paths[name]);
  }
  return withRunLock(context, async () => {
    const record = await loadOrCreateState(context);
    const { state } = record;
    const completedAt = new Date().toISOString();
    state.steps[stepId] = { status: StepStatus.COMPLETED, artifacts, completedAt };
    state.updatedAt = completedAt;
    await saveCurrentState(context, record);
    return state;
  });
}

function extractDocumentSlug(markdown, stepId) {
  if (!markdown || typeof markdown !== 'string') return null;

  if (stepId === 'decision-record') {
    const idMatch = markdown.match(/^-\s*\*\*ID:\*\*\s*`([^`]+)`/m);
    if (idMatch) {
      return idMatch[1]
        .toLowerCase()
        .replace(/^dec-/, '')
        .replace(/_/g, '-');
    }
  }

  const titleMatch = markdown.match(/^#+\s+(.+?)(?:\s*#+)?$/m);
  if (titleMatch) {
    const title = titleMatch[1];
    if (!title.includes(' — ')) return null;
    const afterDash = title.split(' — ').slice(1).join(' — ');
    return afterDash
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '');
  }

  return null;
}

export async function publishWorkflowStep({ stepId, documents, documentName, ...rawContext }) {
  const context = await resolveRunContext(rawContext);
  const step = WORKFLOW_STEPS.find(({ id }) => id === stepId);
  if (!step?.outputDirectory) throw new WorkflowError('ARTIFACT_NOT_FOUND', `Step "${stepId}" does not publish documents`);
  const names = Object.keys(documents ?? {});
  if (names.length !== step.outputs.length ||
    !step.outputs.every((name) => typeof documents[name] === 'string' && documents[name].trim())) {
    throw new WorkflowError('ARTIFACT_NOT_FOUND', `Expected non-empty Markdown for: ${step.outputs.join(', ')}`);
  }
  await validateTemplateHeadings(context, step, documents);
  if (documentName !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(documentName)) {
    throw new WorkflowError('ARTIFACT_NOT_FOUND', '--name must match /^[a-z0-9][a-z0-9-]*$/');
  }
  const directory = outputDirectory(context, step);
  const release = await acquireRunLock(resolve(dirname(statePath(context)), '..', 'publication'));
  const published = [];
  try {
    return await runWorkflowStep({
      ...rawContext,
      stepId,
      execute: async () => {
        await checkOutputDirectory(context.workspaceRoot, directory, true);
        const absolute = resolve(context.workspaceRoot, directory);
        const entries = await readdir(absolute);
        let next = entries.reduce((max, name) => {
          const number = /^(\d+)-/.exec(name)?.[1];
          return number ? (BigInt(number) > max ? BigInt(number) : max) : max;
        }, 0n) + 1n;

        let slug = documentName;
        if (!slug) {
          const firstOutput = step.outputs[0];
          const markdown = documents[firstOutput];
          slug = extractDocumentSlug(markdown, stepId);
        }
        slug = slug ?? context.nodeId;

        const artifacts = {};
        for (const name of step.outputs) {
          const path = `${directory}/${String(next++).padStart(3, '0')}-${slug}.md`;
          const destination = resolve(context.workspaceRoot, path);
          const temporary = resolve(absolute, `.smith-${randomUUID()}.tmp`);
          await writeFile(temporary, documents[name], { flag: 'wx' });
          try {
            await checkOutputDirectory(context.workspaceRoot, directory);
            await link(temporary, destination);
            published.push(destination);
          } finally {
            await unlink(temporary);
          }
          artifacts[name] = await createArtifactReference(context.workspaceRoot, path);
        }
        return { artifacts };
      },
    });
  } catch (error) {
    for (const file of published) await unlink(file);
    throw error;
  } finally {
    await release();
  }
}

export async function runWorkflowStep(options) {
  const { stepId, execute, ...rawContext } = options;
  const context = await resolveRunContext(rawContext);
  if (typeof execute !== 'function') {
    throw new TypeError('execute must be a function');
  }

  const step = WORKFLOW_STEPS.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new WorkflowError('PREREQ_NOT_MET', `Unknown workflow step: ${stepId}`);
  }
  if (step.kind === 'approval') {
    throw new WorkflowError('INVALID_CONFIRMATION', `Step "${stepId}" requires explicit user approval`);
  }

  const filePath = statePath(context);
  const preparation = await withRunLock(context, async () => {
    const record = await loadOrCreateState(context);
    const { state } = record;
    let current = state.steps[stepId];
    if (current.status === StepStatus.COMPLETED || current.status === StepStatus.ACCUMULATING) {
      if (step.accumulative) {
        // Accumulative steps always allow re-execution; downstream is not invalidated
      } else {
        return { state, completed: true };
      }
    }
    if (current.status === StepStatus.RUNNING && (await processIsAlive(current.executionPid))) {
      throw new WorkflowError('STEP_LOCKED', `Workflow step "${stepId}" is already running`);
    }
    const prerequisites = await validatedPrerequisites(context.workspaceRoot, state, step);
    const executionToken = randomUUID();
    current.status = StepStatus.RUNNING;
    current.error = undefined;
    current.executionPid = process.pid;
    current.executionToken = executionToken;
    state.updatedAt = new Date().toISOString();
    await saveCurrentState(context, record);
    return { state, prerequisites, executionToken, completed: false };
  });
  if (preparation.completed) {
    return preparation.state;
  }

  try {
    const result = await execute({
      step,
      workspaceRoot: resolve(context.workspaceRoot),
      inputFiles: [...context.inputFiles],
      prerequisites: preparation.prerequisites,
    });
    const artifacts = await validateOutputs(context, step, result);
    return await withRunLock(context, async () => {
      const record = await loadOrCreateState(context);
      const { state } = record;
      const current = state.steps[stepId];
      if (current.executionToken !== preparation.executionToken) {
        throw new WorkflowError('STEP_LOCKED', `Workflow step "${stepId}" was invalidated before its output was saved`);
      }
      current.artifacts = artifacts;
      current.status = step.accumulative ? StepStatus.ACCUMULATING : StepStatus.COMPLETED;
      current.completedAt = new Date().toISOString();
      delete current.error;
      delete current.executionPid;
      delete current.executionToken;
      state.updatedAt = current.completedAt;
      await saveCurrentState(context, record);
      return state;
    });
  } catch (error) {
    await withRunLock(context, async () => {
      const record = await loadOrCreateState(context);
      const { state } = record;
      const current = state.steps[stepId];
      if (current.executionToken === preparation.executionToken) {
        current.status = StepStatus.FAILED;
        current.error = error instanceof Error ? error.message : String(error);
        current.artifacts = {};
        delete current.executionPid;
        delete current.executionToken;
        state.updatedAt = new Date().toISOString();
        await saveCurrentState(context, record);
      }
    });
    throw error;
  }
}

export async function approveValidationGate(options) {
  const { confirmation, approvalFingerprint, ...rawContext } = options;
  const context = await resolveRunContext(rawContext);
  if (confirmation !== APPROVAL_CONFIRMATION) {
    throw new WorkflowError('INVALID_CONFIRMATION', `Explicit user confirmation must be "${APPROVAL_CONFIRMATION}"`);
  }

  const gate = WORKFLOW_STEPS.find(({ id }) => id === 'validation-gate');
  return withRunLock(context, async () => {
    const record = await loadOrCreateState(context);
    const { state } = record;

    const currentFingerprint = computeApprovalFingerprint(state, gate);
    if (approvalFingerprint !== currentFingerprint) {
      throw new WorkflowError('APPROVAL_FINGERPRINT_MISMATCH', 'Approval fingerprint does not match current state; artifacts may have changed since review');
    }

    const validated = await validatedPrerequisites(context.workspaceRoot, state, gate);

    const approvedArtifacts = {};
    for (const [depId, artifacts] of Object.entries(validated)) {
      if (artifacts && typeof artifacts === 'object' && !Array.isArray(artifacts)) {
        if (typeof artifacts.path === 'string') {
          approvedArtifacts[depId] = { path: artifacts.path };
        } else if (artifacts[depId] && typeof artifacts[depId].path === 'string') {
          approvedArtifacts[depId] = { path: artifacts[depId].path };
        } else if (Object.keys(artifacts).length === 1 && typeof Object.values(artifacts)[0]?.path === 'string') {
          approvedArtifacts[depId] = { path: Object.values(artifacts)[0].path };
        } else {
          approvedArtifacts[depId] = artifacts;
        }
      } else {
        approvedArtifacts[depId] = artifacts;
      }
    }

    const approvedAt = new Date().toISOString();
    state.steps[gate.id] = {
      status: StepStatus.COMPLETED,
      artifacts: {},
      approvedArtifacts,
      approvedAt,
    };
    state.updatedAt = approvedAt;
    await saveCurrentState(context, record);
    return state;
  });
}
