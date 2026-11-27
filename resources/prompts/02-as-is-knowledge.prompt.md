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
- **Fontes:** fontes cadastradas com papel `legacy` ou `reference`, além do knowledge de entrada indicado pelo workflow. Não presuma uma estrutura fixa em `workspace/src/`.
- **Saída registrada:** `knowledge`.
- **Destino:** publique o artefato do step em `workspace/.discovery/<run-id>/results/as-is-knowledge/`. `workspace/.knowledge/` é apenas material de entrada; não publique o resultado nela nem classifique o artefato por categoria.
- **Templates instalados:** `.copilot/plugins/smith/templates/000-knowledge-api.md` para contrato de entrada de API; `.copilot/plugins/smith/templates/001-knowledge-as-is.md` para outros comportamentos As-Is.

**Economia de Contexto e Subagentes:** A exploração de código consome contexto. Nunca leia pastas inteiras na conversa principal: divida a busca por fluxos ou módulos e delegue via MCP aos CLIs locais Claude Code/Antigravity, trazendo apenas comportamentos comprovados e referências. Ao fornecer caminhos de arquivos ou diretórios ao MCP, use somente caminhos absolutos do filesystem local; resolva qualquer caminho relativo antes da chamada. Para Antigravity, use referências `@/caminho/absoluto/arquivo` quando disponíveis, em vez de copiar arquivos. Consulte a lista de modelos e escolha a faixa de menor custo. Nunca inclua credenciais ou segredos.

Use `run-id` como ID estável da iniciativa e `tema` como nome do subnó atual. Vários temas compartilham o mesmo `run-id`; mantenha o mesmo tema e a mesma lista de arquivos-fonte em todos os comandos deste subnó. Os caminhos `--input` são relativos à raiz do projeto e não devem incluir artefatos gerados. Antes de redigir, execute:

Consulte o catálogo com `sources list`. Se o usuário apontar explicitamente uma fonte ainda não cadastrada, proponha `path`, `kind`, `role`, `scope` e stack; só após confirmação registre-a com `sources add` ou ajuste-a com `sources update`. Não inspecione fontes antes da indicação explícita do usuário, não percorra o repositório durante o cadastro e nunca edite `.smith/runs/` manualmente. Respeite o `scope` e use somente fontes `legacy`/`reference` selecionadas pelo workflow.

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `as-is-knowledge` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída. Examine o código pertinente e o knowledge existente. Use somente fatos comprováveis no código; não misture legado com refatorado nem infira comportamento de fontes externas.

Depois que o arquivo existir, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step as-is-knowledge --artifact knowledge=workspace/.discovery/<run-id>/results/as-is-knowledge/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
