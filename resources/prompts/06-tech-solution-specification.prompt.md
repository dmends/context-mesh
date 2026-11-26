---
name: "Smith: Especificação de Solução"
description: "Produz a especificação de solução To-Be a partir do resultado de discovery e decisões registradas."
triggers:
  - tech spec
  - especificação técnica
  - especificação de solução
---

Execute somente a etapa `tech-solution-specification` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para criar e registrar o documento no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** artefato válido de `discovery-consolidation` (Consolidado).
- **Fontes:** consolidado em `workspace/.discovery/<iniciativa>/results/discovery-consolidation/`, ARD do arquiteto em `workspace/.discovery/<iniciativa>/results/tech-solution-specification/` e `workspace/.context/`.
- **Saída registrada:** `tech-solution-specification`.
- **Template instalado:** `.copilot/plugins/smith/templates/005-tech-solution-specification.md`.

**Economia de Contexto e Subagentes:** Utilize subagentes nativos para explorar os detalhes técnicos no código e no consolidado. Se a solução envolver impactos arquiteturais profundos em múltiplos serviços ou decisões de design complexas, consulte o MCP `Ask-Claude` para revisão e recomendações antes de formalizar a especificação.

Reutilize o `run-id` da iniciativa, o mesmo `tema` do subnó e a lista estável de arquivos-fonte, sem incluir artefatos gerados nos argumentos `--input`. Os caminhos são relativos à raiz do projeto. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `tech-solution-specification` aparece em `readySteps` e confira os artefatos de pré-requisito reportados. Se algum pré-requisito estiver ausente ou inválido, não prossiga. Produza uma proposta de especificação de solução, apresente-a ao usuário e aguarde aprovação explícita antes de gravar. Salve em `workspace/.discovery/<iniciativa>/results/tech-solution-specification/` com o próximo número disponível; não sobrescreva arquivos.

Depois que o usuário aprovar e o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step tech-solution-specification --artifact tech-solution-specification=workspace/.discovery/<iniciativa>/results/tech-solution-specification/<arquivo>.md
```
