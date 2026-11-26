---
name: "Smith: Resultado de discovery"
description: "Sintetiza fontes de discovery com knowledge existente e código pertinente."
triggers:
  - discovery result
  - resultado de discovery
  - sintetizar discovery
---

Este comando é um alias para a etapa `discovery-consolidation` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para criar e registrar o documento no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** artefatos válidos de `business-epic` e `as-is-knowledge`.
- **Fontes:** pastas `business-epic/` e `as-is-knowledge/` da iniciativa, `workspace/.knowledge/` e `workspace/src/` quando pertinente.
- **Saída registrada:** `discovery-consolidation`.
- **Template instalado:** `.copilot/plugins/smith/templates/002-discovery-result.md`.

**Economia de Contexto e Subagentes:** Utilize subagentes nativos para sintetizar previamente os materiais brutos das pastas de etapa e o knowledge existente antes da consolidação, evitando poluir a conversa principal.

Reutilize o `run-id` da iniciativa, o mesmo `tema` do subnó e a lista estável de arquivos-fonte, sem incluir artefatos gerados nos argumentos `--input`. Os caminhos são relativos à raiz do projeto. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `discovery-consolidation` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída. A partir do épico, do knowledge existente e da leitura de código quando pertinente, sintetize o entendimento alcançado: o problema de negócio, os fluxos observados, as convergências e divergências entre as fontes, dependências, riscos e lacunas que ainda exigem investigação. Não declare decisões arquiteturais aqui — documente o resultado da investigação. Salve o documento em `workspace/.discovery/<iniciativa>/results/discovery-consolidation/`.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step discovery-consolidation --artifact discovery-consolidation=workspace/.discovery/<iniciativa>/results/discovery-consolidation/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
