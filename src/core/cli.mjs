import { createInterface } from 'node:readline/promises';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';
import {
  approveValidationGate,
  getReadyStepDetails,
  publishWorkflowStep,
  readWorkflowRun,
  registerWorkflowOutputs,
  addSource,
  updateSource,
  removeSource,
  listSources,
} from './engine.mjs';
import { WorkflowError } from '../domain/errors.mjs';

const USAGE = `Usage:
  node plugin/core/cli.mjs template --step ID
  node plugin/core/cli.mjs init --run-id ID --tema TEMA
  node plugin/core/cli.mjs start|resume|status --run-id ID --tema TEMA --input PATH [--input PATH...]
  node plugin/core/cli.mjs ready --run-id ID --tema TEMA --input PATH [--input PATH...]
  node plugin/core/cli.mjs publish --run-id ID --tema TEMA --step ID --input PATH [--name SLUG] < documents.json
  node plugin/core/cli.mjs complete --run-id ID --tema TEMA --step ID --artifact NAME=PATH [--artifact NAME=PATH...] [--input PATH]
  node plugin/core/cli.mjs approve --run-id ID --tema TEMA --input PATH [--input PATH...] [--confirmation APPROVE]
  node plugin/core/cli.mjs sources add|update --run-id ID [--workspace PATH] < source.json
  node plugin/core/cli.mjs sources remove --run-id ID --source-id ID [--workspace PATH]
  node plugin/core/cli.mjs sources list --run-id ID [--workspace PATH]

All paths are relative to --workspace (default: current directory).`;

function discoveryDirectories(runId) {
  return WORKFLOW_STEPS.map(({ id }) => `workspace/.discovery/${runId}/${id}`);
}

async function createDiscoveryDirectories(workspaceRoot, runId) {
  for (const relativePath of discoveryDirectories(runId)) {
    let current = workspaceRoot;
    for (const segment of relativePath.split('/')) {
      current = join(current, segment);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try {
          await mkdir(current);
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError;
        }
        info = await lstat(current);
      }
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new WorkflowError('INVALID_DISCOVERY_DIRECTORY', `Discovery path must be a real directory: ${current}`);
      }
    }
  }
}

function parseArguments(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') {
    return { command: 'help' };
  }
  if (command === 'template') {
    if (rest.length !== 2 || rest[0] !== '--step' || !rest[1]) {
      throw new WorkflowError('INVALID_ARGUMENT', 'template requires --step ID');
    }
    return { command, stepId: rest[1] };
  }

  if (command === 'init') {
    const options = {};
    const keys = new Map([
      ['--workspace', 'workspaceRoot'],
      ['--run-id', 'runId'],
      ['--tema', 'tema'],
    ]);
    for (let index = 0; index < rest.length; index += 1) {
      const option = rest[index];
      const key = keys.get(option);
      const value = rest[index + 1];
      if (!key || !value || value.startsWith('--') || options[key] !== undefined) {
        throw new WorkflowError('INVALID_ARGUMENT', `Invalid or repeated init option: ${option}`);
      }
      options[key] = value;
      index += 1;
    }
    if (!options.runId || !options.tema) {
      throw new WorkflowError('INVALID_ARGUMENT', 'init requires --run-id and --tema');
    }
    return {
      command,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      runId: options.runId,
      tema: options.tema,
      inputFiles: [],
    };
  }

  if (command === 'sources') {
    const [operation, ...sourceArgs] = rest;
    if (!['add', 'update', 'remove', 'list'].includes(operation)) {
      throw new WorkflowError('INVALID_SOURCE', 'sources requires add, update, remove, or list');
    }
    const options = {};
    for (let index = 0; index < sourceArgs.length; index += 1) {
      const option = sourceArgs[index];
      const value = sourceArgs[index + 1];
      if (!value || value.startsWith('--')) throw new WorkflowError('INVALID_SOURCE', `Missing value for ${option}`);
      const key = { '--workspace': 'workspaceRoot', '--run-id': 'runId', '--source-id': 'sourceId' }[option];
      if (!key || options[key] !== undefined) throw new WorkflowError('INVALID_SOURCE', `Unknown or repeated option: ${option}`);
      options[key] = value;
      index += 1;
    }
    if (!options.runId) throw new WorkflowError('INVALID_SOURCE', 'sources requires --run-id');
    if (operation === 'remove' && !options.sourceId) throw new WorkflowError('INVALID_SOURCE', 'sources remove requires --source-id');
    if (operation !== 'remove' && options.sourceId) throw new WorkflowError('INVALID_SOURCE', '--source-id is only valid with sources remove');
    return {
      command,
      operation,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      runId: options.runId,
      sourceId: options.sourceId,
    };
  }

  const options = { inputs: [], artifacts: [] };
  const singular = new Map([
    ['--workspace', 'workspaceRoot'],
    ['--run-id', 'runId'],
    ['--tema', 'tema'],
    ['--step', 'stepId'],
    ['--name', 'documentName'],
    ['--confirmation', 'confirmation'],
    ['--approval-fingerprint', 'approvalFingerprint'],
  ]);
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      throw new WorkflowError('INVALID_ARGUMENT', `Missing value for ${option}`);
    }
    if (option === '--input') {
      options.inputs.push(value);
    } else if (option === '--artifact') {
      options.artifacts.push(value);
    } else if (singular.has(option)) {
      const key = singular.get(option);
      if (options[key] !== undefined) {
        throw new WorkflowError('INVALID_ARGUMENT', `${option} can only be provided once`);
      }
      options[key] = value;
    } else {
      throw new WorkflowError('INVALID_ARGUMENT', `Unknown option: ${option}`);
    }
    index += 1;
  }

  if (!['start', 'resume', 'status', 'ready', 'complete', 'publish', 'approve'].includes(command)) {
    throw new WorkflowError('INVALID_ARGUMENT', `Unknown command: ${command}`);
  }
  if (typeof options.runId !== 'string' || !options.tema) {
    throw new WorkflowError('INVALID_ARGUMENT', '--run-id and --tema are required');
  }
  if (command !== 'complete' && options.inputs.length === 0) {
    throw new WorkflowError('INVALID_ARGUMENT', '--input is required');
  }
  if (command === 'complete' && (!options.stepId || options.artifacts.length === 0)) {
    throw new WorkflowError('INVALID_ARGUMENT', 'complete requires --step and at least one --artifact');
  }
  if (command !== 'complete' && options.artifacts.length > 0) {
    throw new WorkflowError('INVALID_ARGUMENT', '--artifact is only valid with complete');
  }
  if (command === 'publish' && !options.stepId) throw new WorkflowError('INVALID_ARGUMENT', 'publish requires --step');
  if (!['complete', 'publish'].includes(command) && options.stepId) {
    throw new WorkflowError('INVALID_ARGUMENT', '--step is only valid with complete or publish');
  }
  if (command !== 'publish' && options.documentName !== undefined) {
    throw new WorkflowError('INVALID_ARGUMENT', '--name is only valid with publish');
  }
  if (command !== 'approve' && options.confirmation !== undefined) {
    throw new WorkflowError('INVALID_ARGUMENT', '--confirmation is only valid with approve');
  }
  if (command !== 'approve' && options.approvalFingerprint !== undefined) {
    throw new WorkflowError('INVALID_ARGUMENT', '--approval-fingerprint is only valid with approve');
  }

  return {
    command,
    workspaceRoot: options.workspaceRoot ?? process.cwd(),
    runId: options.runId,
    tema: options.tema,
    inputFiles: options.inputs,
    stepId: options.stepId,
    documentName: options.documentName,
    confirmation: options.confirmation,
    approvalFingerprint: options.approvalFingerprint,
    artifactArguments: options.artifacts,
  };
}

function parseArtifacts(argumentsList) {
  const entries = argumentsList.map((argument) => {
    const separator = argument.indexOf('=');
    if (separator <= 0 || separator === argument.length - 1) {
      throw new WorkflowError('ARTIFACT_NOT_FOUND', `Invalid artifact reference "${argument}"; expected NAME=PATH`);
    }
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  });
  const artifacts = Object.fromEntries(entries);
  if (Object.keys(artifacts).length !== entries.length) {
    throw new WorkflowError('ARTIFACT_NOT_FOUND', 'Artifact names must be unique');
  }
  return artifacts;
}

function summarize(state, readyStepDetails, runId = state.runId, sources = []) {
  return {
    runId,
    tema: state.tema,
    sources,
    steps: Object.fromEntries(
      state.steps.map((step) => {
        const id = step.type;
        const hasArtifacts = step.artifacts.length > 0;
        return [
          id,
          { status: step.status, ...(hasArtifacts ? { artifacts: step.artifacts } : {}), ...(step.error ? { error: step.error } : {}) },
        ];
      }),
    ),
    readySteps: readyStepDetails.map(({ id }) => id),
    readyStepDetails,
  };
}

async function askForApproval() {
  if (!process.stdin.isTTY) {
    throw new WorkflowError('INVALID_CONFIRMATION', 'Approval requires an interactive terminal; no approval was recorded');
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question('Review the upstream artifacts, then type APPROVE to continue: '))
      .trim();
  } finally {
    terminal.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (options.command === 'sources') {
    let result;
    if (options.operation === 'add' || options.operation === 'update') {
      if (process.stdin.isTTY) throw new WorkflowError('INVALID_SOURCE', `sources ${options.operation} expects one JSON object on stdin`);
      let input = '';
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) input += chunk;
      let source;
      try {
        source = JSON.parse(input);
      } catch (error) {
        throw new WorkflowError('INVALID_SOURCE', 'Source input must be a JSON object', { cause: error });
      }
      result = options.operation === 'add'
        ? await addSource({ ...options, source })
        : await updateSource({ ...options, source });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    result = options.operation === 'remove'
      ? await removeSource(options)
      : await listSources(options);
    process.stdout.write(`${JSON.stringify(options.operation === 'list' ? { sources: result } : result, null, 2)}\n`);
    return;
  }
  if (options.command === 'template') {
    const step = WORKFLOW_STEPS.find(({ id }) => id === options.stepId);
    if (!step || !step.templates.length) throw new WorkflowError('ARTIFACT_NOT_FOUND', `No template for step: ${options.stepId}`);
    const contents = await Promise.all(step.templates.map(async (file) => {
      try {
        return await readFile(new URL(`../../resources/${file}`, import.meta.url), 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      }
    }));
    process.stdout.write(contents.map((content, index) => contents.length === 1 ? content : `<!-- ${step.templates[index]} -->\n${content}`).join('\n\n'));
    return;
  }

  const context = {
    workspaceRoot: options.workspaceRoot,
    runId: options.runId,
    tema: options.tema,
    inputFiles: options.inputFiles,
  };

  if (options.command === 'init') {
    const state = await readWorkflowRun(context);
    await createDiscoveryDirectories(options.workspaceRoot, options.runId);
    process.stdout.write(`${JSON.stringify({
      runId: options.runId,
      tema: state.tema,
      nodeId: state.id,
      steps: state.steps.map(({ type, status }) => ({ type, status })),
    }, null, 2)}\n`);
    return;
  }

  if (options.command === 'publish') {
    if (process.stdin.isTTY) throw new WorkflowError('INVALID_ARGUMENT', 'Pipe a JSON object mapping artifact names to Markdown into publish');
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    let documents;
    try {
      documents = JSON.parse(input);
    } catch (error) {
      throw new WorkflowError('INVALID_ARGUMENT', 'publish expects a JSON object mapping artifact names to Markdown on stdin', { cause: error });
    }
    if (!documents || typeof documents !== 'object' || Array.isArray(documents)) {
      throw new WorkflowError('INVALID_ARGUMENT', 'publish expects a JSON object mapping artifact names to Markdown on stdin');
    }
    const state = await publishWorkflowStep({ ...context, stepId: options.stepId, documentName: options.documentName, documents });
    process.stdout.write(`${JSON.stringify(summarize(state, await getReadyStepDetails(context), options.runId, await listSources(context)), null, 2)}\n`);
    return;
  }

  if (options.command === 'complete') {
    const state = await registerWorkflowOutputs({
      ...context,
      stepId: options.stepId,
      paths: parseArtifacts(options.artifactArguments),
    });
    process.stdout.write(`${JSON.stringify(summarize(state, await getReadyStepDetails(context), options.runId, await listSources(context)), null, 2)}\n`);
    return;
  }

  if (options.command === 'approve') {
    if (!options.approvalFingerprint) {
      throw new WorkflowError('INVALID_CONFIRMATION', '--approval-fingerprint is required; get it from the ready command before approving');
    }
    const confirmation = options.confirmation ?? await askForApproval();
    const state = await approveValidationGate({
      ...context,
      confirmation,
      approvalFingerprint: options.approvalFingerprint,
    });
    process.stdout.write(`${JSON.stringify(summarize(state, await getReadyStepDetails(context), options.runId, await listSources(context)), null, 2)}\n`);
    return;
  }

  const state = await readWorkflowRun(context);
  const sources = await listSources(context);
  const readyStepDetails = await getReadyStepDetails(context);
  if (options.command === 'ready') {
    process.stdout.write(`${JSON.stringify({ runId: options.runId, tema: state.tema, sources, readySteps: readyStepDetails.map(({ id }) => id), readyStepDetails }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(summarize(state, readyStepDetails, options.runId, sources), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exitCode = 1;
  });
}
