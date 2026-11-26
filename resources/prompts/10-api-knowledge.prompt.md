---
name: "Smith: Knowledge API"
description: "Documenta o contrato de entrada de API comprovado no código: rota, parâmetros, validações e respostas."
triggers:
  - api knowledge
  - knowledge api
  - documentar api
  - contrato de api
---

Execute somente a etapa `as-is-knowledge` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para documentar e registrar a API no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** nenhum.
- **Fontes:** fontes cadastradas com papel `legacy` ou `reference`, além do knowledge de entrada indicado pelo workflow. Não presuma uma estrutura fixa em `workspace/src/`.
- **Saída registrada:** `knowledge`.
- **Template instalado:** `.copilot/plugins/smith/templates/000-knowledge-api.md`.

**Economia de Contexto e Subagentes:** Delegue a varredura e leitura de rotas, esquemas DTOs e arquivos de validação a subagentes nativos de exploração, preservando o contexto principal da conversa.

Use `run-id` como ID estável da iniciativa e `tema` como nome do subnó atual. Vários temas compartilham o mesmo `run-id`; mantenha o mesmo tema e a mesma lista de arquivos-fonte em todos os comandos deste subnó. Os caminhos `--input` são relativos à raiz do projeto e não devem incluir artefatos gerados. Antes de redigir, execute:

Consulte `sources list` antes de explorar. Se o usuário indicar uma fonte local não cadastrada, confirme com ele o caminho, o tipo, o papel, o escopo e a stack antes de executar `sources add`; nunca edite `.smith/runs/` manualmente. Respeite o `scope` e limite a análise às fontes selecionadas pelo workflow.

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `as-is-knowledge` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída. Localize o endpoint e examine o código que implementa a rota: handler, desserialização, validações e mapeamento de resposta. Use somente fatos comprováveis no código; documente método HTTP, rota, headers, parâmetros de rota e query, campos do corpo da requisição, regras de validação em ordem de aplicação, e respostas para cada cenário observado. Salve o documento em `workspace/.discovery/<run-id>/as-is-knowledge/`, sem sobrescrever arquivos existentes.

A única gravação de documentos permitida é via `publish`. Consulte `outputDirectory` em `ready`; não invente um destino.

Não entregue o documento apenas na conversa. Só conclua depois que `publish` terminar com sucesso e informar o caminho do arquivo criado.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step as-is-knowledge --artifact knowledge=workspace/.discovery/<run-id>/as-is-knowledge/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
