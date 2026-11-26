import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_STEPS } from '../workflows/project-lifecycle.mjs';
import {
  approveValidationGate,
  getReadyStepDetails,
  publishWorkflowStep,
  readWorkflowRun,
  registerWorkflowOutputs,
} from './engine.mjs';

const USAGE = `Usage:
  node plugin/core/cli.mjs template --step ID
  node plugin/core/cli.mjs start|resume|status --run-id ID --tema TEMA --input PATH [--input PATH...]
  node plugin/core/cli.mjs ready --run-id ID --tema TEMA --input PATH [--input PATH...]
  node plugin/core/cli.mjs publish --run-id ID --tema TEMA --step ID --input PATH [--name SLUG] < documents.json
  node plugin/core/cli.mjs complete --run-id ID --tema TEMA --step ID --artifact NAME=PATH [--artifact NAME=PATH...] [--input PATH]
  node plugin/core/cli.mjs approve --run-id ID --tema TEMA --input PATH [--input PATH...] [--confirmation APPROVE]

All paths are relative to --workspace (default: current directory).`;

function parseArguments(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') {
    return { command: 'help' };
  }
  if (command === 'template') {
    if (rest.length !== 2 || rest[0] !== '--step' || !rest[1]) {
      throw new Error('template requires --step ID');
    }
    return { command, stepId: rest[1] };
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
      throw new Error(`Missing value for ${option}`);
    }
    if (option === '--input') {
      options.inputs.push(value);
    } else if (option === '--artifact') {
      options.artifacts.push(value);
    } else if (singular.has(option)) {
      const key = singular.get(option);
      if (options[key] !== undefined) {
        throw new Error(`${option} can only be provided once`);
      }
      options[key] = value;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
    index += 1;
  }

  if (!['start', 'resume', 'status', 'ready', 'complete', 'publish', 'approve'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  if (typeof options.runId !== 'string' || !options.tema) {
    throw new Error('--run-id and --tema are required');
  }
  if (command !== 'complete' && options.inputs.length === 0) {
    throw new Error('--input is required');
  }
  if (command === 'complete' && (!options.stepId || options.artifacts.length === 0)) {
    throw new Error('complete requires --step and at least one --artifact');
  }
  if (command !== 'complete' && options.artifacts.length > 0) {
    throw new Error('--artifact is only valid with complete');
  }
  if (command === 'publish' && !options.stepId) throw new Error('publish requires --step');
  if (!['complete', 'publish'].includes(command) && options.stepId) {
    throw new Error('--step is only valid with complete or publish');
  }
  if (command !== 'publish' && options.documentName !== undefined) {
    throw new Error('--name is only valid with publish');
  }
  if (command !== 'approve' && options.confirmation !== undefined) {
    throw new Error('--confirmation is only valid with approve');
  }
  if (command !== 'approve' && options.approvalFingerprint !== undefined) {
    throw new Error('--approval-fingerprint is only valid with approve');
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
      throw new Error(`Invalid artifact reference "${argument}"; expected NAME=PATH`);
    }
    return [argument.slice(0, separator), argument.slice(separator + 1)];
  });
  const artifacts = Object.fromEntries(entries);
  if (Object.keys(artifacts).length !== entries.length) {
    throw new Error('Artifact names must be unique');
  }
  return artifacts;
}

function summarize(state, readyStepDetails) {
  return {
    runId: state.runId,
    tema: state.tema,
    steps: Object.fromEntries(
      Object.entries(state.steps).map(([id, step]) => {
        const hasArtifacts = Array.isArray(step.artifacts)
          ? step.artifacts.length > 0
          : Object.keys(step.artifacts).length > 0;
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
    throw new Error('Approval requires an interactive terminal; no approval was recorded');
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
  if (options.command === 'template') {
    const step = WORKFLOW_STEPS.find(({ id }) => id === options.stepId);
    if (!step || !step.templates.length) throw new Error(`No template for step: ${options.stepId}`);
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

  if (options.command === 'publish') {
    if (process.stdin.isTTY) throw new Error('Pipe a JSON object mapping artifact names to Markdown into publish');
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    let documents;
    try {
      documents = JSON.parse(input);
    } catch (error) {
      throw new Error('publish expects a JSON object mapping artifact names to Markdown on stdin', { cause: error });
    }
    if (!documents || typeof documents !== 'object' || Array.isArray(documents)) {
      throw new Error('publish expects a JSON object mapping artifact names to Markdown on stdin');
    }
    const state = await publishWorkflowStep({ ...context, stepId: options.stepId, documentName: options.documentName, documents });
    process.stdout.write(`${JSON.stringify(summarize(state, await getReadyStepDetails(context)), null, 2)}\n`);
    return;
  }

  if (options.command === 'complete') {
    const state = await registerWorkflowOutputs({
      ...context,
      stepId: options.stepId,
      paths: parseArtifacts(options.artifactArguments),
    });
    process.stdout.write(`${JSON.stringify(summarize(state, await getReadyStepDetails(context)), null, 2)}\n`);
    return;
  }

  if (options.command === 'approve') {
    if (!options.approvalFingerprint) {
      throw new Error('--approval-fingerprint is required; get it from the ready command before approving');
    }
    const confirmation = options.confirmation ?? await askForApproval();
    const state = await approveValidationGate({
      ...context,
      confirmation,
      approvalFingerprint: options.approvalFingerprint,
    });
    process.stdout.write(`${JSON.stringify(summarize(state, await getReadyStepDetails(context)), null, 2)}\n`);
    return;
  }

  const state = await readWorkflowRun(context);
  const readyStepDetails = await getReadyStepDetails(context);
  if (options.command === 'ready') {
    process.stdout.write(`${JSON.stringify({ runId: state.runId, tema: state.tema, readySteps: readyStepDetails.map(({ id }) => id), readyStepDetails }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(summarize(state, readyStepDetails), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
