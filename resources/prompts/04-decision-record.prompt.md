---
name: "Smith: Registro de decisão"
description: "Registra escolhas explicitamente adotadas, sem converter propostas em decisões."
triggers:
  - decision record
  - registro de decisão
  - adr
  - registrar decisão
---

Execute somente a etapa `decision-record` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para registrar a decisão no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** `tech-solution-specification` válida e escolhas que o time tenha explicitamente adotado.
- **Fontes:** a especificação de solução em `workspace/.discovery/<iniciativa>/results/tech-solution-specification/` e as escolhas explicitamente aprovadas pelo time (negócio + arquitetura).
- **Saída registrada:** `decision-record`.
- **Template instalado:** `.copilot/plugins/smith/templates/003-decision-record.md`.

**Economia de Contexto e Subagentes:** Registre apenas decisões e escolhas efetivamente adotadas. Delegue a consulta de propostas upstream via MCP aos CLIs locais Claude Code/Antigravity e traga somente as definições aprovadas, com referências. Ao fornecer caminhos de arquivos ou diretórios ao MCP, use somente caminhos absolutos do filesystem local; resolva qualquer caminho relativo antes da chamada. Antes de cada chamada, consulte a lista de modelos e use a faixa de menor custo. Nunca inclua credenciais ou segredos.

Reutilize o `run-id` da iniciativa, o mesmo `tema` do subnó e a lista estável de arquivos-fonte, sem incluir artefatos gerados nos argumentos `--input`. Os caminhos são relativos à raiz do projeto. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confira se `decision-record` aparece em `readySteps` e verifique a especificação de solução reportada. Se não estiver pronta, informe quais pré-requisitos faltam, mas ainda pode registrar decisões solicitadas pelo usuário como progresso. Identifique as decisões efetivamente tomadas e aprovadas pelo time. Uma menção ou proposta em transcrição não é uma decisão: registre apenas escolhas adotadas. Grave somente as definições aprovadas em `workspace/.discovery/<iniciativa>/results/decision-record/`, com o próximo número disponível e sem sobrescrever arquivos.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step decision-record --artifact decision-record=workspace/.discovery/<iniciativa>/results/decision-record/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Sem pré-requisitos satisfeitos, omita `--allow-out-of-order` para registrar o documento como `IN_PROGRESS`. Só inclua essa opção se o usuário autorizar explicitamente concluir esta operação fora de ordem. Isso não substitui o gate de validação: etapas posteriores ao gate continuam bloqueadas até a aprovação literal `APPROVE` com fingerprint válido.
