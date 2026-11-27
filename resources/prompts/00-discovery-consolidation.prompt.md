---
name: "Smith: Consolidado"
description: "Consolida épico inicial e knowledge As-Is em documento estruturado com dependências, riscos e porte."
triggers:
  - consolidar discovery
  - consolidado
  - mapear dependências e riscos
---

Execute somente a etapa `discovery-consolidation` do workflow `project-lifecycle`.

A seleção deste prompt é um pedido explícito para criar e registrar o documento no projeto. Use a ferramenta de terminal para executar os comandos, não apenas para sugeri-los. Execute `ready` antes de redigir. Se a ferramenta não puder executar comandos ou o usuário negar a execução, informe o bloqueio e não entregue um substituto como resposta.

Não altere instruções globais do projeto, configurações pessoais ou MCP; não instale componentes nem sincronize repositórios. Gere arquivos somente dentro de `workspace/`.

- **Pré-requisitos:** artefatos válidos de `business-epic` e `as-is-knowledge`.
- **Fontes:** épico inicial em `workspace/.discovery/<iniciativa>/results/business-epic/`, knowledge As-Is em `workspace/.discovery/<iniciativa>/results/as-is-knowledge/`, análises em `workspace/.analysis/` e contexto em `workspace/.context/`.
- **Saída registrada:** `discovery-consolidation`.
- **Template instalado:** `.copilot/plugins/smith/templates/000-discovery-consolidation.md`.

**Economia de Contexto e Subagentes:** Não carregue arquivos brutos inteiros na conversa principal. Divida a leitura de `business-epic` e `as-is-knowledge` em tarefas independentes e delegue-as via MCP aos CLIs locais Claude Code/Antigravity. Peça conclusões concisas e evidências; use referências a arquivos quando disponíveis, sem copiar o conteúdo bruto. Ao fornecer caminhos de arquivos ou diretórios ao MCP, use somente caminhos absolutos do filesystem local; resolva qualquer caminho relativo antes da chamada. Consulte o catálogo do agente e escolha a faixa de menor custo antes de cada chamada. Nunca inclua credenciais ou segredos.

Use `run-id` como ID estável da iniciativa e `tema` como nome do subnó atual. Os caminhos `--input` são relativos à raiz do projeto e não devem incluir artefatos gerados. Antes de redigir, execute:

> Se o usuário não informar `run-id` e `tema`, inspecione as iniciativas existentes em `workspace/.discovery/` e apresente sugestões válidas antes de solicitar a definição.

```bash
node .copilot/plugins/smith/core/cli.mjs ready --workspace . --run-id <run-id> --tema "<tema>" --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```

Confirme que `discovery-consolidation` aparece em `readySteps`. Se não aparecer, explique o bloqueio e não gere nem registre a saída.

## Conteúdo obrigatório do Consolidado

Confronte o épico inicial com as fronteiras técnicas reais do knowledge As-Is. O documento deve cobrir:

1. **Objetivo e escopo revisado** — o que se mantém do épico e o que foi ajustado após confronto com a realidade técnica.
2. **Jornadas e fluxos principais** — descrição funcional verificável nas fontes; não invente comportamento.
3. **Mapeamento de dependências** — dependências internas (outros módulos/serviços do mesmo sistema) e externas (sistemas fora do domínio), com o trecho de integração sob responsabilidade desta iniciativa.
4. **Mapeamento de riscos** — riscos por fronteira técnica, decisões ainda em aberto que podem alterar o escopo, e questões sem dono definido.
5. **Dimensionamento (porte)** — classifique o porte da demanda usando a escala abaixo e atribua um nível de clareza:

| Porte | Referência qualitativa                                                                        |
|-------|-----------------------------------------------------------------------------------------------|
| XS    | Capacidade isolada, simples, fronteira muito clara, poucas regras e dependências.             |
| S     | Capacidade pequena e coesa, fluxo principal claro, poucas variações.                          |
| M     | Escopo moderado, várias regras, estados ou cenários relevantes.                               |
| L     | Ampla, múltiplos fluxos, exceções ou interações significativas entre fronteiras.              |
| XL    | Escopo amplo demais para uma única entrega; requer decomposição antes de assumir compromisso. |

**Clareza:** Alta (objetivo e fronteira compreendidos), Média (incerteza funcional parcial), Baixa (falta decisão sobre objetivo ou responsabilidade).

Se a clareza for Baixa por incerteza funcional, eleve o porte ao menos uma faixa e explique a hipótese. Para itens XL, proponha uma decomposição em capacidades menores. Não converta o porte em prazo ou esforço.

Leia o template instalado. Preserve todos os títulos e seções do template; preencha todas as seções, usando `a validar`, `a definir` ou `nenhuma` quando a informação não estiver disponível. Não invente fatos. Trate o Consolidado como versão para validação, nunca como decisão aprovada.

Depois que o arquivo existir em `workspace/.discovery/<iniciativa>/results/discovery-consolidation/`, registre seu caminho relativo à raiz do projeto:

```bash
node .copilot/plugins/smith/core/cli.mjs complete --workspace . --run-id <run-id> --tema "<tema>" --step discovery-consolidation --artifact discovery-consolidation=workspace/.discovery/<iniciativa>/results/discovery-consolidation/<arquivo>.md --input <arquivo-fonte> [--input <outro-arquivo-fonte>...]
```
