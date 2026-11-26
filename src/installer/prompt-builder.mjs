import { readFile } from 'node:fs/promises';

const OLD_WORKFLOW_COMMAND = 'node .copilot/plugins/smith/core/cli.mjs';

export async function buildPromptContent(sourcePath, { stage, workflowCommand, step }) {
  const original = (await readFile(sourcePath, 'utf8')).replaceAll('\r\n', '\n');
  const transform = (text) => text
    .replace(/^.*\*\*Templates? instalado[s]?:\*\*.*$/gm, (line) => (stage === 'as-is-knowledge' || stage === 'api-knowledge') ? line : '')
    .replaceAll('.copilot/plugins/smith/templates/', '');
  const content = transform(original);
  const render = (text, launcher, extra = []) => {
    const guidance = [
      'Use somente as fontes e artefatos pertinentes. Não abra o código ou o README do plugin; se um comando falhar, reporte o erro e pare.',
      ...extra,
      ...(stage === 'validation-gate' ? [] : [
        'Consulte o modelo pelo comando abaixo. Preserve todos os títulos e subtítulos de cada modelo aplicável, marque as lacunas sem inventar fatos e confira a estrutura antes de registrar.',
        '```bash',
        `${launcher} template --step ${stage}`,
        '```',
      ]),
    ].join('\n');
    return Buffer.from(text.replaceAll(OLD_WORKFLOW_COMMAND, launcher).replace(/(\n---\n)/, `$1\n${guidance}\n`));
  };
  const extra = [
    'Nesta etapa, não use ferramentas do IDE para gravar documentos, não acione skills de planejamento e não crie planos auxiliares em disco.',
    'Se uma fonte for diretório, liste recursivamente os arquivos regulares pertinentes e passe cada arquivo como `--input`; nunca passe diretórios. Reutilize a mesma lista em todos os comandos.',
    'O comando `ready` cria e atualiza o estado da execução em `.smith/runs/<run-id>.json`; não crie nem edite esse arquivo manualmente.',
  ];
  let updated = content;
  if (step?.outputs.length) {
    const example = JSON.stringify(Object.fromEntries(step.outputs.map((name) => [name, '<Markdown completo>'])));
    const category = stage === 'as-is-knowledge' ? ' --knowledge-category <legado|refatorado|dominios>' : '';
    updated = content
      .replace('Gere arquivos somente dentro de `workspace/`.', '')
      .replace(/ (?:Crie o documento em|Salve (?:em|o documento|os dois arquivos)|Grave somente as definições).*?(?:arquivos existentes|sem substituir arquivos|sem sobrescrever arquivos|não sobrescreva arquivos|sem sobrescrita)\./g,
        stage === 'decision-record' ? ' Inclua somente as definições efetivamente aprovadas.' : '')
      .replace(/^Depois que .*:\n\n```bash\nnode .* complete .*?\n```/m,
        `Publique pelo terminal, sem salvar em outra pasta nem criar arquivos temporários no projeto. ` +
        `Envie via stdin um objeto JSON com o Markdown completo de cada saída (exemplo de formato: \`${example}\`). ` +
        `Use um heredoc literal ou o equivalente no shell, sem interpolar o conteúdo. ` +
        `O executor escolhe a pasta e a numeração. Informe os caminhos retornados; se falhar, pare.\n\n` +
        `\`\`\`bash\n${OLD_WORKFLOW_COMMAND} publish --workspace . --run-id <run-id> --tema "<tema>" --step ${stage}${category} --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]\n\`\`\``);
    extra.push(
      'A única gravação de documentos permitida é via `publish`. Consulte `outputDirectory` em `ready`; não invente um destino.',
      'Não entregue o documento apenas na conversa. Só conclua depois que `publish` terminar com sucesso e informar o caminho do arquivo criado.',
    );
  }
  return {
    content: render(updated, workflowCommand, extra),
    sourceContent: Buffer.from(original),
  };
}
