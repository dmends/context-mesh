# Smith — Instruções de Desenvolvimento do Plugin

Este repositório contém o código-fonte, runtime, instalador e ferramentas do **Plugin Smith**.  
Estas instruções orientam o desenvolvimento, manutenção e evolução dos módulos deste repositório.

---

## 1. Idioma e Comunicação

- **Sempre responder em Português (pt-br).**
- **Comunicação direta e concisa:** Não faça narrações passo-a-passo da execução ("Vou verificar o arquivo X, agora vou alterar Y..."). Entregue diretamente o resultado, explicando erros ou bloqueios quando houver.
- **Economia de contexto:** Utilize subagentes nativos do ambiente para leitura de arquivos extensos e exploração ampla de código, mantendo o contexto principal limpo.

---

## 2. Padrões de Desenvolvimento de Código (`*.mjs`)

Todas as alterações em código JavaScript/Node.js neste repositório devem seguir estritamente estas diretrizes:

### 2.1 Sem Valores Hardcoded
- **Configuração de Ambiente** (versões, URLs, timeouts, portas, limites): exclusivamente via `src/config/env.mjs`. Nunca acesse `process.env` diretamente fora desse módulo.
- **Status e Estados**: exclusivamente via ENUMs de `src/domain/status.mjs` (`StepStatus`, `CheckStatus`, `SyncStatus`, `InstallStatus`). Nunca compare ou atribua strings literais de estado (`'running'`, `'completed'`, `'pending'`) fora das definições de domínio.
- **Artefatos de Texto** (templates, instruções, prompts, markdowns): exclusivamente armazenados em `resources/` com placeholders no formato `{{chave}}`. Nunca embute blocos de texto multi-linha diretamente em constantes JS.
- **Dados Estáticos** (hashes, listas de ferramentas, versões anteriores): exclusivamente em `resources/` como arquivos de dados estruturados (`.json`, `.txt`).

### 2.2 Erros Tipados e Estruturados
- Lance erros exclusivamente utilizando as classes especializadas de `src/domain/errors.mjs` (`WorkflowError`, `InstallError`, `SyncError`, `ConfigError`).
- Nunca use `throw new Error('mensagem genérica')` dentro de módulos de domínio ou serviços.
- Forneça sempre um `code` descritivo em `SCREAMING_SNAKE_CASE` que identifique a condição técnica da falha de forma rastreável.

### 2.3 Responsabilidade Única (SRP) e Modularidade
- Cada módulo `.mjs` deve ter um propósito único e coeso. Módulos que acumulam I/O de disco, transformação de dados e orquestração de chamadas devem ser refatorados em funções ou arquivos dedicados.
- Orquestradores de entrada (`init.mjs`, `cli.mjs`) apenas coordenam chamadas para módulos especializados, sem conter regras de negócio embutidas.
- Mantenha funções pequenas e legíveis (em torno de ~30 linhas).

### 2.4 Cobertura de Testes Obrigatória
- Todo módulo novo ou modificado deve possuir testes co-locados (`*.test.mjs`) ou na suíte de testes de integração em `tests/`.
- Os testes devem cobrir: caminho feliz, caminhos de falha esperados, validação de tipos de erro e ENUMs de status.
- Execute `npm test` antes de considerar qualquer alteração concluída.

### 2.5 Filosofia SMART para Código
- **S (Simples):** Prefira a solução mais direta e sem complexidade acidental.
- **M (Manutenível):** Nomes expressivos que revelem intenção técnica; evite abreviações obscuras.
- **A (Atestável):** Funções puras sempre que possível; efeitos colaterais de I/O isolados e dependências injetáveis.
- **R (Rastreável):** Erros com códigos claros para diagnóstico imediato.
- **T (Testado):** Suíte de testes automatizados verde.

### Checklist Rápido
- [ ] Nenhum acesso direto a `process.env` fora de `src/config/env.mjs`
- [ ] Nenhum status ou estado hardcoded como string literal
- [ ] Nenhum bloco de texto multi-linha embutido em constantes de código
- [ ] Erros lançados com classes de `src/domain/errors.mjs` e `code` padronizado
- [ ] Teste unitário ou de integração cobrindo a alteração
- [ ] Suíte de testes verificada com sucesso

---

## 3. Estrutura Interna do Repositório

O repositório está organizado nas seguintes camadas:

```text
smith/
├── src/
│   ├── config/             # Configuração centralizada e acesso a variáveis de ambiente
│   ├── domain/             # Modelos de domínio, ENUMs de status e erros tipados
│   ├── core/               # Motor de estados, trava de concorrência e CLI do workflow
│   ├── installer/          # Instalador (init.mjs), diagnósticos (doctor.mjs) e runtime
│   ├── mcp/                # Configurador de servidores MCP e ferramentas
│   ├── report/             # Relatório e visualizador gráfico local do workflow
│   └── utils/              # Carregadores de template, sincronizador Git (utils/repository/sync) e utilitários auxiliares
│
├── resources/
│   ├── instructions/       # Template mestre único de instruções de IA (smith.instructions.md)
│   ├── prompts/            # Prompts originais das 10 etapas do workflow
│   ├── templates/          # Modelos de documentos de saída gerados pelo workflow (000 a 008)
│   └── agents/             # Manifestos e meta-templates de cada IA/plataforma
│
├── tests/                  # Testes de integração, empacotamento e migração
├── build.mjs               # Script de compilação e montagem do pacote de distribuição
└── plugin.json             # Manifesto principal do plugin Smith
```

---

## 4. Diretrizes dos Módulos Principais

### 4.1 Dynamic Workflow Engine (`src/core/`)
- **Papel:** Controla a execução sequencial de etapas, resolução de dependências, contratos de entrada/saída e checkpoints de aprovação.
- **Persistência:** O estado de execução de cada iniciativa reside em `.smith/runs/<run-id>.json`.
- **Interface CLI:** Acessível via `cli.mjs start, cli.mjs resume e cli.mjs approve` bem como comandos complementares (`ready`, `complete`, `status`, `publish`).
- **Gate de Validação:** A liberação para downstream requer obrigatoriamente a verificação de fingerprint dos artefatos revisados e a confirmação literal e explícita com **`APPROVE`**. Nunca infira aprovação tácita.
- **Distinção Importante:** **Superpowers vs Dynamic Workflow**:
  - **Superpowers** ([obra/superpowers](https://github.com/obra/superpowers)) é uma extensão externa que amplia capacidades de execução do agente no sistema operacional.
  - **Dynamic Workflow** é o motor interno do Smith que governa regras, dependências e persistência do ciclo de vida de desenvolvimento. Não misture os conceitos.

### 4.2 Sincronizador de Repositórios (`src/utils/repository/sync/sync.mjs`)
- **Papel:** Sincronização multi-repositório via Git a partir de catálogo externo informado via `--config <arquivo.json>`.
- **Segurança:** Suporte obrigatório a `--dry-run` para prever ações sem tocar no disco. O sincronizador apenas avança repositórios limpos via fast-forward e bloqueia alterações se houver branches divergentes ou arquivos modificados.
- **Regra Rígida:** **Não execute sincronização automaticamente** durante comandos como `init`, `doctor` ou qualquer inicialização sem solicitação direta e deliberada do usuário.

---

## 5. Build e Empacotamento (`build.mjs`)

- O comando `node build.mjs` gera a versão distribuível do plugin em `dist/smith-plugin/` e os pacotes específicos por agente em `dist/<agente>/`.
- O build valida a integridade do manifesto `plugin.json` conforme o esquema oficial da Agent Plugins Specification.
- Templates em `resources/` devem ser preservados e carregados via `loadTemplate()`.
