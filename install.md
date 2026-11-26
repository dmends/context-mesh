# Smith — Guia de Instalação para Agentes de IA

Este documento é uma referência passo a passo para agentes de IA e desenvolvedores que realizam a instalação e configuração do Smith a partir do código-fonte ou de releases.

---

## 1. Validação de Dependências

Antes de iniciar a instalação, valide os pré-requisitos do ambiente de execução.

### Node.js

```bash
node --version
```

Requisito: **22.0.0 ou superior**. O instalador impõe essa verificação em tempo de execução; qualquer versão inferior gera um erro fatal.

```bash
# Saída mínima aceitável
v22.x.x
```

Se a versão for inferior a 22, interrompa o processo e oriente o usuário a atualizar o Node.js antes de continuar.

### Git

```bash
git --version
```

Qualquer versão estável recente é aceita. Necessário apenas para clonar o repositório ou sincronizar catálogos.

### Sem dependências npm em tempo de execução

O Smith não possui dependências npm em tempo de execução. `npm install` não é necessário para compilar ou utilizar os artefatos. Toda a tooling nativa utiliza os módulos da biblioteca padrão do Node.js (`node:fs`, `node:path`, `node:crypto`, etc.).

---

### Dependências opcionais e Ferramentas Complementares

O ecossistema do Smith integra-se opcionalmente a ferramentas complementares de alto valor:

#### 1. Dynamic Workflow (Nativo e Auto-contido)
- **Finalidade:** Implementação própria incluída no pacote, sem qualquer dependência externa de pacotes npm.
- **Funcionamento:** O executor local (`core/cli.mjs`) gerencia estado de execução em arquivos JSON locais sob `.smith/runs/`, funcionando com qualquer agente de IA (Antigravity, Claude Code, Cursor, Copilot, Codex, Gemini CLI). Nenhuma instalação adicional é necessária.

#### 2. Superpowers ([obra/superpowers](https://github.com/obra/superpowers))
- **Finalidade e Escopo:** Framework de skills e disciplina de engenharia que orienta a metodologia de trabalho dos agentes de IA (TDD rigoroso, refatoração sistemática, decomposição de problemas e colaboração orientada a contratos).
- **Divisão de Responsabilidades:** Enquanto o Superpowers provê as regras metodológicas e habilidades de raciocínio, o Dynamic Workflow do Smith controla as dependências entre artefatos, transições de estado, gates de validação humana upstream e rastreabilidade documental.
- **Instalação:**
  - **GitHub Copilot CLI:** O instalador suporta integração automática através da flag `--install-superpowers` (requer autorização interativa `INSTALL`).
  - **Outros Clientes e Agentes (`jetbrains`, `vscode`, `antigravity`, `claude-code`, `cursor`):** Configure o Superpowers manualmente no cliente desejado seguindo as instruções oficiais do repositório Superpowers.

```bash
# Instalação automática — somente com --client copilot-cli
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/do/projeto \
  --client copilot-cli \
  --install-superpowers
```

#### 3. Multi-CLI MCP ([@osanoai/multicli](https://www.npmjs.com/package/@osanoai/multicli))
- **Finalidade e Escopo:** Servidor MCP (Model Context Protocol) que padroniza e protege a execução de comandos CLI através de uma allowlist explícita de comandos permitidos (ex.: ferramentas de análise, Git e inspeção).
- **Quando Utilizar:** Recomendado em ambientes operados via GitHub Copilot CLI ou VS Code onde se deseja permitir que o modelo execute comandos de terminal com controle de permissões e segurança.
- **Versão Fixada:** O integrador utiliza a versão fixada `@osanoai/multicli@1.5.41`.
- **Como Ativar:**
  - Passe as flags `--include-multicli --configure-mcp` durante a inicialização do plugin.
  - O instalador exibe uma prévia completa das alterações planejadas e exige a confirmação literal `CONFIGURE` antes de alterar qualquer arquivo de configuração.
  - *Nota sobre JetBrains:* O Multi-CLI é omitido no cliente `jetbrains` até que o filtro de ferramentas seja validado no runtime JetBrains.

```bash
# Configuração interativa com Multi-CLI em clientes suportados
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/do/projeto \
  --client vscode \
  --configure-mcp \
  --include-multicli
```

---

## 2. Obter o Pacote

Escolha uma das duas formas abaixo.

### Opção A — Download de release (recomendado para uso direto)

Baixa o pacote já compilado diretamente de uma release do GitHub:

```bash
curl -L \
  https://github.com/dmends/smith/releases/latest/download/smith-plugin-latest.zip \
  -o smith-plugin.zip

unzip smith-plugin.zip
```

### Opção B — Clone e build a partir do código-fonte

```bash
git clone https://github.com/dmends/smith.git
cd smith
git status
# Esperado: On branch main, nothing to commit
```

---

## 3. Executar o Build

Execute o build a partir da raiz do repositório:

```bash
node build.mjs
```

O build do Smith gera automaticamente a distribuição modular pré-renderizada para cada agente e ecossistema em `dist/`:

### Estrutura de Saída Gerada em `dist/`

```text
dist/
├── smith-plugin/        ← Runtime package (mjs + assets + tooling) usado pelo Copilot e releases
│   ├── installer/
│   ├── core/
│   ├── mcp/
│   ├── report/
│   ├── templates/
│   ├── utils/
│   └── plugin.json
│
├── copilot/                   ← Arquivos de projeto para clientes Copilot (JetBrains/VS Code/CLI)
│   └── .github/
│       ├── instructions/
│       │   └── smith.instructions.md
│       ├── copilot-instructions.md
│       └── prompts/ (10 prompts prontos com {{workflowCommand}})
│
├── antigravity/               ← Diretório completo pronto para cópia direta ao projeto alvo
│   ├── .antigravity-plugin/plugin.json
│   ├── AGENTS.md              ← Renderizado de smith.instructions.md
│   └── skills/ (12 skills prontas, incluindo using-smith)
│
├── claude-code/               ← Diretório completo pronto para cópia direta ao projeto alvo
│   ├── .claude-plugin/plugin.json
│   ├── CLAUDE.md              ← Renderizado de smith.instructions.md
│   └── .claude/skills/ (12 skills prontas)
│
├── cursor/                    ← Diretório completo pronto para cópia direta ao projeto alvo
│   ├── .cursor-plugin/plugin.json
│   ├── .cursor/rules/smith.mdc (com frontmatter alwaysApply)
│   └── .cursor/skills/ (12 skills prontas)
│
├── codex/                     ← Diretório completo pronto para cópia direta ao projeto alvo
│   ├── .codex-plugin/plugin.json
│   ├── AGENTS.md
│   └── .agents/skills/ (12 skills prontas + manifests openai.yaml)
│
└── gemini-cli/                ← Diretório completo pronto para cópia direta ao projeto alvo
    ├── gemini-extension.json
    ├── GEMINI.md
    └── .gemini/skills/ (12 skills prontas)
```

---

## 4. Instalar em um Projeto Alvo

Existem duas abordagens de instalação para atender diferentes fluxos de trabalho:

### Opção 1: Implantação Rápida por Cópia Direta (Zero Overhead)

Para agentes autônomos que operam diretamente na raiz do workspace, basta copiar a pasta do agente em `dist/<agente>/` diretamente para o projeto alvo. Não requer execução de scripts:

```bash
# Antigravity
cp -R dist/smith-plugin/agents/antigravity/. /caminho/para/projeto-alvo/

# Claude Code
cp -R dist/smith-plugin/agents/claude-code/. /caminho/para/projeto-alvo/

# Cursor
cp -R dist/smith-plugin/agents/cursor/. /caminho/para/projeto-alvo/

# Gemini CLI
cp -R dist/smith-plugin/agents/gemini-cli/. /caminho/para/projeto-alvo/

# Codex
cp -R dist/smith-plugin/agents/codex/. /caminho/para/projeto-alvo/
```

### Opção 2: Instalação via CLI (`init.mjs`)

O instalador `init.mjs` automatiza a verificação de integridade, diagnóstico de conflitos, configuração compartilhada de runtime e MCP, além de inicializar as pastas padrão do workspace (`workspace/.context`, `workspace/.discovery`, `workspace/.knowledge`, `workspace/src`):

#### ⚠️ REGRA FUNDAMENTAL PARA AGENTES DE IA (Quem é você?)

1. **Se você é o Antigravity (ou o usuário quer configurar para o Antigravity):**
   - Execute a instalação **Standalone** usando `--agent antigravity`.
   - **NÃO informe `--client`!** Passar `--client jetbrains` ou `--client vscode` criará arquivos `.github/` específicos do Copilot que poluem o contexto do Antigravity.
2. **Se você é outro Agente Autônomo (Claude Code, Cursor, Gemini CLI, Codex):**
   - Use o `--agent` respectivo sem `--client`.
3. **Se o alvo é o GitHub Copilot (JetBrains, VS Code ou Copilot CLI):**
   - Utilize `--client jetbrains`, `--client vscode` ou `--client copilot-cli`.

#### Parâmetros do instalador

| Flag                 | Obrigatoriedade                           | Descrição                                                                                 |
|----------------------|-------------------------------------------|-------------------------------------------------------------------------------------------|
| `--target DIR`       | **Obrigatório**                           | Caminho absoluto do projeto onde o Smith será instalado                            |
| `--agent NAME`       | *Obrigatório se `--client` não for usado* | Agente autônomo: `antigravity`, `claude-code`, `cursor`, `gemini-cli`, `codex`, `copilot` |
| `--client NAME`      | *Obrigatório se `--agent` não for usado*  | Cliente de IDE / Copilot: `jetbrains`, `vscode` ou `copilot-cli`                          |
| `--dry-run`          | Opcional                                  | Pré-visualiza todas as ações planejadas sem gravar nenhum arquivo                         |
| `--configure-mcp`    | Opcional                                  | Grava a configuração MCP (requer confirmação interativa)                                  |
| `--include-multicli` | Opcional                                  | Adiciona Multi-CLI à configuração MCP (usar junto com `--configure-mcp`)                  |
| `--force`            | Opcional                                  | Sobrescreve arquivos existentes                                                           |

#### Exemplos de Instalação com `init.mjs`

```bash
# Antigravity Standalone
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/para/projeto-alvo \
  --agent antigravity

# Claude Code Standalone
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/para/projeto-alvo \
  --agent claude-code

# JetBrains IntelliJ com Copilot
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/para/projeto-alvo \
  --client jetbrains

# Instalação Híbrida (IDE Copilot + Antigravity)
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/para/projeto-alvo \
  --client jetbrains \
  --agent antigravity
```

---

## 5. Localização do Runtime Compartilhado (Clientes Copilot)

Para os clientes `jetbrains` e `vscode`, o runtime é instalado fora do projeto alvo para evitar poluição do repositório:

| SO      | Caminho                                                                                              |
|---------|------------------------------------------------------------------------------------------------------|
| macOS   | `~/Library/Application Support/Smith/versions/<versão>/`                                      |
| Linux   | `~/.local/share/smith/versions/<versão>/` (ou `$XDG_DATA_HOME/smith/versions/<versão>/`) |
| Windows | `%LOCALAPPDATA%/Smith/versions/<versão>/`                                                     |

---

## 6. Validação Pós-Instalação

### 6.1 Verificar arquivos instalados no projeto alvo

**Se instalado para Antigravity (`--agent antigravity` ou cópia direta):**
```bash
ls /caminho/para/projeto-alvo/.antigravity-plugin/
# Esperado: plugin.json

cat /caminho/para/projeto-alvo/AGENTS.md
# Esperado: Catálogo de fases, triggers e orientações do Smith

ls /caminho/para/projeto-alvo/skills/
# Esperado: 12 diretórios de skills com SKILL.md (using-smith + 11 etapas)
```

**Se instalado para Claude Code:**
```bash
ls /caminho/para/projeto-alvo/.claude-plugin/
# Esperado: plugin.json

cat /caminho/para/projeto-alvo/CLAUDE.md
# Esperado: Regras e triggers do Smith

ls /caminho/para/projeto-alvo/.claude/skills/
# Esperado: 12 diretórios de skills
```

**Se instalado para Cursor:**
```bash
ls /caminho/para/projeto-alvo/.cursor-plugin/
# Esperado: plugin.json

cat /caminho/para/projeto-alvo/.cursor/rules/smith.mdc
# Esperado: Regras com alwaysApply: true

ls /caminho/para/projeto-alvo/.cursor/skills/
# Esperado: 12 diretórios de skills
```

**Se instalado para GitHub Copilot (`--client jetbrains` ou `--client vscode`):**
```bash
ls /caminho/para/projeto-alvo/.github/instructions/
# Esperado: smith.instructions.md

ls /caminho/para/projeto-alvo/.github/prompts/
# Esperado: 10 arquivos .prompt.md

ls /caminho/para/projeto-alvo/.smith/report/
# Esperado: index.html, workflow.css, workflow.js
```

### 6.2 Executar o doctor

O script doctor diagnostica o estado da instalação:

```bash
node dist/smith-plugin/installer/doctor.mjs \
  --target /caminho/para/projeto-alvo \
  --client jetbrains
```

---

## 7. Referência Rápida

```bash
# 1. Clonar o repositório
git clone https://github.com/dmends/smith.git && cd smith

# 2. Validar versão do Node (deve ser >= 22)
node --version

# 3. Compilar distribuições para todos os agentes
node build.mjs

# 4. Implantação Direta para Antigravity
cp -R dist/smith-plugin/agents/antigravity/. /caminho/para/projeto/

# OU Instalar via init.mjs para Antigravity
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/para/projeto \
  --agent antigravity

# OU Instalar via init.mjs para Copilot JetBrains
node dist/smith-plugin/installer/init.mjs \
  --target /caminho/para/projeto \
  --client jetbrains
```
