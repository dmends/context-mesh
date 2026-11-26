---
name: "Smith: Detalhamento técnico"
description: "Detalha critérios de aceite e refinamento técnico de cada história para execução sem ambiguidade."
triggers:
  - technical refinement
  - detalhamento técnico
  - detalhar histórias
---

Execute somente a etapa `technical-refinement` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para detalhar e registrar as histórias no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** artefato válido de `story-task-breakdown`.
- **Fontes:** `workspace/.discovery/<iniciativa>/story-task-breakdown/` (histórias, tasks, plano de execução) e artefato de `tech-solution-specification`.
- **Saída registrada:** `technical-refinement`.
- **Template instalado:** `.copilot/plugins/smith/templates/008-technical-refinement.md`.

**Economia de Contexto e Subagentes:** O refinamento exige examinar o código de cada história detalhada. Delegue a inspeção das rotas, serviços e testes a subagentes nativos, evitando despejar arquivos inteiros de código na conversa principal.

Use `run-id` como ID estável da iniciativa e `tema` como nome do subnó atual. Os caminhos `--input` são relativos à raiz do projeto e não devem incluir artefatos gerados. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `technical-refinement` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída. Para cada história: detalhe critérios de aceite (Given/When/Then ou equivalente), refine as tasks com granularidade executável, identifique riscos e dependências técnicas, e valide cobertura com a especificação de solução. Salve o documento em `workspace/.discovery/<iniciativa>/technical-refinement/`.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step technical-refinement --artifact technical-refinement=workspace/.discovery/<iniciativa>/technical-refinement/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
