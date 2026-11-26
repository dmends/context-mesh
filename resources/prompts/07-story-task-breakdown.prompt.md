---
name: "Smith: Quebra de histórias e plano"
description: "Decompõe a especificação aprovada em histórias, tasks e plano de execução."
triggers:
  - story breakdown
  - quebra de histórias
  - decompor em histórias
---

Execute somente a etapa `story-task-breakdown` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para decompor e registrar os planos no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** gate `validation-gate` aprovado e artefato válido de `tech-solution-specification`.
- **Fonte:** especificação de solução reportada pelo workflow.
- **Saídas registradas:** `story-task-breakdown` e `execution-plan`.
- **Templates instalados:** `.copilot/plugins/smith/templates/006-story-task-breakdown.md` e `.copilot/plugins/smith/templates/007-execution-plan.md`.

**Economia de Contexto e Subagentes:** Utilize subagentes nativos para analisar a especificação técnica e mapear as dependências entre histórias, mantendo o contexto da conversa limpo e focado na estrutura das histórias e plano de execução.

Reutilize o `run-id` da iniciativa, o mesmo `tema` do subnó e a lista estável de arquivos-fonte, sem incluir artefatos gerados nos argumentos `--input`. Os caminhos são relativos à raiz do projeto. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `story-task-breakdown` aparece em `readySteps` e confira a especificação reportada. Se o pré-requisito estiver ausente ou inválido, não prossiga. Produza a quebra e o plano, apresente ambos ao usuário e aguarde aprovação explícita antes de gravar. Salve os dois arquivos em `workspace/.discovery/<iniciativa>/story-task-breakdown/`, cada um com o próximo número disponível e sem sobrescrita.

Depois que ambos os arquivos existirem, registre os dois caminhos relativos à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step story-task-breakdown --artifact story-task-breakdown=workspace/.discovery/<iniciativa>/story-task-breakdown/<arquivo-de-historias>.md --artifact execution-plan=workspace/.discovery/<iniciativa>/story-task-breakdown/<arquivo-de-plano>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
