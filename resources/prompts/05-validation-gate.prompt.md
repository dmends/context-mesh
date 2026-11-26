---
name: "Smith: Gate de validação"
description: "Apresenta os artefatos upstream e registra aprovação humana explícita."
triggers:
  - validation gate
  - gate de validação
  - aprovar upstream
---

Execute somente a etapa `validation-gate` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para consultar e registrar a validação no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não avance o workflow.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** artefatos válidos de `business-epic`, `tech-solution-specification` e `decision-record`.
- **Fontes revisadas:** os três artefatos informados pelo estado do workflow.
- **Saídas:** nenhuma; esta etapa registra uma aprovação humana.
- **Template:** nenhum.

**Economia de Contexto:** Apresente um resumo claro e estruturado dos três artefatos upstream ao usuário, evitando despejar o conteúdo bruto completo na conversa.

Reutilize o `run-id` da iniciativa, o mesmo `tema` do subnó e a lista estável de arquivos-fonte, sem incluir artefatos gerados nos argumentos `--input`. Os caminhos são relativos à raiz do projeto. Consulte o gate antes de pedir aprovação:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `validation-gate` aparece em `readySteps`. Se o gate não aparecer ou algum dos três artefatos (`business-epic`, `tech-solution-specification`, `decision-record`) estiver ausente ou inválido, explique o bloqueio e não aprove. Apresente ao usuário o conteúdo dos três artefatos e aguarde que ele digite exatamente `APPROVE` nesta conversa. Silêncio, resposta ambígua ou aprovação de um agente não contam.

Somente depois de receber essa confirmação exata, registre-a:

```bash
node .copilot/plugins/smith/core/cli.mjs approve --workspace . --run-id <run-id> --tema "<tema>" --confirmation APPROVE --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
