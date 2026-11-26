# Smith

Plataforma de orquestração de contexto, regras de IA e governança de ciclo de vida de software para múltiplos agentes de IA (**Antigravity**, **Claude Code**, **Cursor**, **Codex**, **Gemini CLI** e **GitHub Copilot**).

## Instalação rápida via release

Baixe o pacote já compilado de uma release do GitHub — sem precisar clonar o repositório nem rodar o build:

```bash
curl -L \
  https://github.com/dmends/smith/releases/latest/download/smith-plugin-latest.zip \
  -o smith-plugin.zip

unzip smith-plugin.zip

node smith-plugin/installer/init.mjs \
  --target /caminho/do/projeto \
  --client jetbrains
```

Para instruções detalhadas de build, distribuição e validação por agente, consulte [install.md](install.md).

## Requisitos

- Node.js 22 ou superior.
- Não há dependências npm para instalar em tempo de execução.

### Dependências opcionais e Ferramentas Complementares

- **Dynamic Workflow:** implementação própria e auto-contida incluída no pacote, sem qualquer dependência externa npm. O executor (`core/cli.mjs`) gerencia o estado das etapas e artefatos localmente em JSON (`.smith/runs/`), funcionando universalmente com qualquer agente de IA.
- **Superpowers ([obra/superpowers](https://github.com/obra/superpowers)):** framework de metodologia e engenharia (TDD disciplinado, refatoração e decomposição) que complementa o Smith. Suporta instalação automática via `--install-superpowers` no `copilot-cli` e manual nos demais agentes.
- **Multi-CLI MCP ([@osanoai/multicli](https://www.npmjs.com/package/@osanoai/multicli)):** servidor MCP opcional fixado em `@osanoai/multicli@1.5.41` para execução padronizada e segura de comandos CLI permitidos. Ativado interativamente com `--include-multicli --configure-mcp` (clientes Copilot CLI e VS Code).

## O que o Smith oferece

- **Dynamic Workflow:** um fluxo estruturado com etapas encadeadas que guiam o desenvolvimento desde a descoberta e épico inicial até a especificação técnica e o refinamento das histórias.
- **Transparência e Contratos de Artefatos:** cada etapa declara explicitamente suas entradas e saídas, validadas antes de avançar.
- **Gate de Validação Upstream:** checkpoint obrigatório com aprovação humana explícita antes de liberar as etapas downstream de entrega.
- **Relatório Visual do Workflow:** visualizador HTML interativo gerado localmente em `.smith/report/index.html`.
- **Arquitetura Pura de Recursos:** separação rigorosa entre instruções (`smith.instructions.md`), templates de negócio (`000` a `008`), prompts de workflow e manifestos de plataformas.
- **Distribuição Multi-Agente Pré-renderizada:** geração no build de artefatos prontos e nativos para cada agente de IA.

---

## Fases do Workflow

| Fase | Gatilho / Trigger | Entradas | Saída |
|---|---|---|---|
| Épico de negócio | `business epic` | Transcrições, histórias de negócio | `business-epic` |
| Knowledge As-Is | `as-is knowledge` | Código legado, refatorado | `knowledge` |
| Consolidado | `consolidar discovery` | Épico + Knowledge As-Is | `discovery-consolidation` |
| Resultado de discovery | `discovery result` | Fontes de discovery + knowledge | `discovery-result` |
| Especificação técnica | `tech spec` | Consolidado, ARD | `tech-solution-specification` |
| Registro de decisão | `decision record` | Especificação técnica aprovada | `decision-record` |
| **Gate de validação** | `validation gate` | Épico + Spec + Decisões | Requer confirmação `APPROVE` |
| Quebra de histórias | `story breakdown` | Especificação aprovada | `story-task-breakdown` + `execution-plan` |
| Detalhamento técnico | `technical refinement` | Histórias e tarefas | `technical-refinement` |

---

## Build e Distribuição Multi-Agente (`dist/`)

Ao executar `node build.mjs`, o Smith gera diretórios dedicados e pré-renderizados para cada plataforma em `dist/`:

| Diretório | Destinado a | Conteúdo |
|---|---|---|
| `dist/antigravity/` | Google Antigravity | `.antigravity-plugin/plugin.json`, `AGENTS.md`, `skills/` (12 skills) |
| `dist/claude-code/` | Claude Code | `.claude-plugin/plugin.json`, `CLAUDE.md`, `.claude/skills/` (12 skills) |
| `dist/cursor/` | Cursor IDE | `.cursor-plugin/plugin.json`, `.cursor/rules/smith.mdc`, `.cursor/skills/` |
| `dist/codex/` | OpenAI Codex | `.codex-plugin/plugin.json`, `AGENTS.md`, `.agents/skills/` (com `openai.yaml`) |
| `dist/gemini-cli/` | Gemini CLI | `gemini-extension.json`, `GEMINI.md`, `.gemini/skills/` |
| `dist/copilot/` | GitHub Copilot (IDE / CLI) | `.github/instructions/`, `.github/copilot-instructions.md`, `.github/prompts/` |
| `dist/smith-plugin/` | Runtime do Pacote | Pacote executável com instalador, core, templates e sync |

### Implantação Rápida por Cópia Direta

Para agentes autônomos, você pode dispensar scripts de instalação e simplesmente copiar a pasta correspondente de `dist/` para a raiz do seu projeto:

```bash
# Exemplo para Antigravity
cp -R dist/antigravity/ /caminho/do/projeto/

# Exemplo para Claude Code
cp -R dist/claude-code/ /caminho/do/projeto/
```

---

## Instalação via CLI (`init.mjs`)

O instalador suporta a flag `--agent` tanto de forma **autônoma (standalone)** quanto combinada com `--client`:

- **Standalone (sem `--client`):** recomendado quando o projeto for operado exclusivamente pelo agente (ex.: **Antigravity**, **Claude Code**, **Cursor**, **Codex**, **Gemini CLI**). Não cria pasta `.github/` nem artefatos específicos do GitHub Copilot.
- **Híbrido (com `--client`):** quando o projeto for operado pelo GitHub Copilot no IDE e também por outro agente.

```bash
# Antigravity Standalone (sem pasta .github/)
node ./dist/smith-plugin/installer/init.mjs \
  --target /caminho/do/projeto \
  --agent antigravity

# Claude Code Standalone
node ./dist/smith-plugin/installer/init.mjs \
  --target /caminho/do/projeto \
  --agent claude-code

# JetBrains Copilot
node ./dist/smith-plugin/installer/init.mjs \
  --target /caminho/do/projeto \
  --client jetbrains

# Instalação Híbrida (JetBrains Copilot + Antigravity)
node ./dist/smith-plugin/installer/init.mjs \
  --target /caminho/do/projeto \
  --client jetbrains \
  --agent antigravity
```

---

## Diagnóstico e Validação

O script doctor diagnostica o estado da instalação:

```bash
node ./dist/smith-plugin/installer/doctor.mjs \
  --target /caminho/do/projeto \
  --client jetbrains
```
