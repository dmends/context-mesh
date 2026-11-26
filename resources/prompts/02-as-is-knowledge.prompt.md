---
name: "Smith: Knowledge As-Is"
description: "Documenta comportamento atual comprovado no código, separado por sistema e domínio."
triggers:
  - as-is knowledge
  - knowledge as-is
  - mapear comportamento atual
---

Execute somente a etapa `as-is-knowledge` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para analisar e registrar o documento no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** nenhum.
- **Fontes:** `workspace/src/legado/`, `workspace/src/refatorado/` e `workspace/.knowledge/`.
- **Saída registrada:** `knowledge`.
- **Templates instalados:** `.copilot/plugins/smith/templates/000-knowledge-api.md` para contrato de entrada de API; `.copilot/plugins/smith/templates/001-knowledge-as-is.md` para outros comportamentos As-Is.

**Economia de Contexto e Subagentes:** A exploração de código-fonte consome muitos tokens. Nunca leia pastas inteiras diretamente para o contexto principal da conversa. Delegue a busca e leitura de arquivos em `workspace/src/` a subagentes nativos de exploração, trazendo para a conversa principal apenas os trechos de código e comportamentos comprovados necessários para documentar o As-Is.

Use `run-id` como ID estável da iniciativa e `tema` como nome do subnó atual. Vários temas compartilham o mesmo `run-id`; mantenha o mesmo tema e a mesma lista de arquivos-fonte em todos os comandos deste subnó. Os caminhos `--input` são relativos à raiz do projeto e não devem incluir artefatos gerados. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `as-is-knowledge` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída. Examine o código pertinente e o knowledge existente. Use somente fatos comprováveis no código; não misture legado com refatorado nem infira comportamento de fontes externas.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step as-is-knowledge --artifact knowledge=workspace/.discovery/<run-id>/results/as-is-knowledge/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
