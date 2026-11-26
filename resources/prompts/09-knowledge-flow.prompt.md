---
name: "Smith: Knowledge Flow"
description: "Documenta o fluxo completo de uma funcionalidade no código-fonte: API, validações, regras de negócio e retornos por cenário."
triggers:
  - knowledge flow
  - documentar fluxo
  - rastrear fluxo
---

Execute somente a etapa `as-is-knowledge` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para rastrear e registrar o fluxo no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** nenhum.
- **Fontes:** fontes cadastradas com papel `legacy` ou `reference`, além do knowledge de entrada indicado pelo workflow. Não presuma uma estrutura fixa em `workspace/src/`.
- **Template instalado:** `.copilot/plugins/smith/templates/008-knowledge-flow.md`.

**Economia de Contexto e Subagentes:** O rastreamento de fluxos ponta a ponta envolve múltiplos arquivos. Utilize subagentes nativos para seguir o fluxo no código (handlers, serviços, repositórios), trazendo para a conversa principal apenas o mapeamento resumido das etapas e cenários.

Use `run-id` como ID estável da iniciativa e `tema` como nome do fluxo documentado. Os caminhos `--input` são relativos à raiz do projeto e não devem incluir artefatos gerados. Antes de redigir, execute:

Consulte `sources list` antes de explorar. Só proponha o cadastro de uma fonte quando o usuário indicar explicitamente seu caminho, e solicite confirmação de caminho, tipo, papel, escopo e stack antes de `sources add`. Não edite `.smith/runs/` manualmente e respeite o escopo e os papéis das fontes escolhidas pelo workflow.

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `as-is-knowledge` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída. Localize o endpoint principal que implementa a funcionalidade solicitada. A partir dele, rastreie o fluxo de execução: handlers, serviços, repositórios e integrações externas acionados. Documente validações em ordem de aplicação, regras de negócio com suas condições e os possíveis retornos para cenários de sucesso e de erro. Use somente fatos comprováveis no código. Salve o documento em `workspace/.discovery/<run-id>/as-is-knowledge/`, sem sobrescrever arquivos existentes.

A única gravação de documentos permitida é via `publish`. Consulte `outputDirectory` em `ready`; não invente um destino.

Não entregue o documento apenas na conversa. Só conclua depois que `publish` terminar com sucesso e informar o caminho do arquivo criado.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step as-is-knowledge --artifact knowledge=workspace/.discovery/<run-id>/as-is-knowledge/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
