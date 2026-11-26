{{header}}
# Smith — Workflow

Smith estrutura o trabalho de desenvolvimento em fases sequenciais rastreadas pelo agente de IA.

| Fase                  | Trigger                              |
|-----------------------|--------------------------------------|
| Épico de negócio      | `business epic`                      |
| Knowledge As-Is       | `as-is knowledge`                    |
| Consolidado           | `consolidar discovery`               |
| Especificação técnica | `tech spec`                          |
| Registro de decisão   | `decision record`                    |
| **Gate de validação** | `validation gate` — requer `APPROVE` |
| Quebra de histórias   | `story breakdown`                    |
| Detalhamento técnico  | `technical refinement`               |
| Knowledge Flow        | `knowledge flow`                     |
| Knowledge API         | `api knowledge`                      |

{{command-mapping}}

## Contexto do Projeto
- Ao gerar código, documentação ou respostas, sempre considere o contexto do projeto configurado.

## Idioma
- **Sempre responder em Português (pt-br).**

## Regras de Execução e Economia de Contexto
- Sempre use subagentes nativos do próprio ambiente/IDE para leitura de arquivos longos, materiais em `.input/` e `.knowledge/` e exploração de código, evitando poluir a janela de contexto principal com conteúdo bruto.
- Agentes externos via MCP (`Claude` e `Antigravity`) devem ser usados exclusivamente conforme os critérios definidos na seção `Orquestração Multi-Agente via MCP`.

## Política de Documentação
- **NÃO criar arquivos .md de nenhum tipo a menos que explicitamente solicitado pelo usuário.**
- Sempre economize nas gerações de tokens, evitando textos e explicações desnecessários.

### Onde registrar cada conteúdo
Classifique pelo tipo de conhecimento produzido, não apenas pela origem do material:

| Conteúdo produzido     | Critério                                                                                                                                                                            | Destino                                                                                                                                                                               |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Conhecimento As-Is     | Análise baseada exclusivamente no código, descrevendo o comportamento atual sem misturar insumos externos ou decisões propostas.                                                    | `workspace/.knowledge/legado/` ou `workspace/.knowledge/refatorado/`, conforme a implementação; use `workspace/.knowledge/dominios/` para conhecimento independente da implementação. |
| Resultado de discovery | Síntese de uma investigação que combina materiais de `workspace/.discovery/[iniciativa]/.input/` — como transcrições ou documentação importada via MCP — com o knowledge existente. | `workspace/.discovery/[iniciativa]/results/`                                                                                                                                          |
| Decisão                | Escolha ou definição adotada, em vez de uma descrição do comportamento atual ou de um achado da investigação.                                                                       | `workspace/.discovery/[iniciativa]/decisions/`                                                                                                                                        |

Os materiais-fonte permanecem em `.input/`; `results/` recebe a síntese produzida a partir deles. Uma investigação pode gerar um resultado em `results/` e, se consolidar conhecimento As-Is reutilizável, também atualizar o `knowledge` pertinente. Não duplique a análise inteira: registre em cada local apenas o conteúdo correspondente à sua finalidade.

### Fluxo de análise e produção de documentação
Identifique primeiro o tipo de pedido. O knowledge pode orientar a investigação, mas afirmações As-Is sobre o sistema devem ser verificadas no código. Só crie ou atualize arquivos quando o usuário solicitar o registro.

Uma menção ou proposta em transcrição não é automaticamente uma decisão: registre em `decisions/` apenas escolhas ou definições adotadas. Se forem produzidos tipos diferentes de conteúdo, registre cada um no destino correspondente, sem duplicar a análise inteira.

#### Fluxo de Downstream (Especificação To-Be, Quebras e Planos)
O Downstream parte de artefatos consolidados em `.discovery/<iniciativa>/results/` e `.discovery/<iniciativa>/decisions/`, validados pelo usuário no Gate de Validação e Aprovação. Suas saídas — especificações técnicas To-Be, histórias/tasks quebradas e planos de execução — devem ser registradas em `.discovery/<iniciativa>/plans/`, somente após solicitação explícita do usuário. Antes de gerar cada arquivo, apresente o conteúdo intermediário na conversa para revisão e aguarde a aprovação explícita do usuário.

## Estrutura de Documentação
Use esta árvore como referência para localizar e classificar os documentos. O `run-id` identifica a iniciativa e `tema` identifica um subnó, sem criar uma pasta por tema. Substitua `<iniciativa>` e `<dominio>` pelos identificadores correspondentes.

```text
workspace/
├── .context/                         # contexto comum a todo o projeto
├── .templates/                       # modelos para documentos recorrentes
├── .discovery/
│   └── <iniciativa>/
│       ├── plans/                    # planos
│       ├── results/                  # resultados de investigações e ou documentos consolidados
│       ├── decisions/                # escolhas e definições adotadas
│       └── .input/
│           ├── .transcripts/         # transcrições de agendas
│           └── business-stories/     # histórias de negócio de entrada
└── .knowledge/
    ├── dominios/                     # conhecimento independente da implementação
    ├── legado/                       # conhecimento As-Is do sistema legado
    └── refatorado/                   # conhecimento As-Is do sistema refatorado
```

Arquivos de artefatos de uma iniciativa devem usar nomes descritivos em kebab-case com número sequencial e slug do tema, como `001-regra-da-primeira-parcela.md`. Mantenha os temas juntos na pasta de resultados correspondente e não reutilize números dentro dela.

## Diretórios de Conhecimento:
Organize o conteúdo de cada uma das três categorias acima por domínio ou assunto, sem misturar conhecimento do legado com o refatorado.

## Templates de Documentação
Use os modelos em `plugin/templates/` ao criar documentos desses tipos:

| Template                         | Usar para                                                                                               | Destino do documento preenchido                                                                                            |
|----------------------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| `001-knowledge-as-is.md`         | Registrar comportamento As-Is verificado exclusivamente no código.                                      | `workspace/.knowledge/legado/`, `workspace/.knowledge/refatorado/` ou `workspace/.knowledge/dominios/`, conforme o escopo. |
| `002-discovery-result.md`        | Consolidar uma investigação que combina materiais de `.input/`, knowledge e, quando pertinente, código. | `workspace/.discovery/<iniciativa>/results/`                                                                               |
| `003-decision-record.md`         | Registrar uma escolha ou definição efetivamente adotada.                                                | `workspace/.discovery/<iniciativa>/decisions/`                                                                             |
| `004-business-epic.md`           | Consolidar agendas em um épico de negócio tratado como versão inicial para validação e evolução.        | `workspace/.discovery/<iniciativa>/results/`                                                                               |
| `000-knowledge-api.md`           | Documentar o contrato As-Is de entrada de uma API, comprovado exclusivamente pelo código.               | `workspace/.knowledge/legado/` ou `workspace/.knowledge/refatorado/`, conforme o sistema.                                  |
| `005-technical-specification.md` | Especificação técnica To-Be.                                                                            | `workspace/.discovery/<iniciativa>/plans/` (somente após solicitação explícita e aprovação do usuário).                    |
| `006-story-task-breakdown.md`    | Quebra de histórias/tasks.                                                                              | `workspace/.discovery/<iniciativa>/plans/` (somente após solicitação explícita e aprovação do usuário).                    |
| `007-execution-plan.md`          | Plano de execução.                                                                                      | `workspace/.discovery/<iniciativa>/plans/` (somente após solicitação explícita e aprovação do usuário).                    |

Os arquivos em `plugin/templates/` são modelos reutilizáveis, não resultados de discovery. Ao preencher um modelo, cite as fontes consultadas em uma seção agregada no final: por exemplo, agendas por data e participantes/áreas, ou código por sistema e nome dos módulos. Não exija paths, URLs, commits, símbolos ou IDs de fonte, nem vincule cada afirmação a uma referência individual. Registre incertezas, divergências e limitações de forma ampla no final; não classifique cada item individualmente, a menos que seja necessário para destacar uma pendência relevante. O template de contrato de entrada descreve somente o que está implementado no código; não presuma que uma especificação externa representa o comportamento atual. O épico consolidado de agendas é uma versão inicial para validação e evolução, não um rascunho nem uma decisão aprovada. Só crie um documento preenchido quando o usuário solicitar o registro.

## Diretórios de Código-Fonte
Os repositórios podem ficar em `workspace/src/` usando seus nomes naturais; não exija as pastas `legado/` ou `refatorado/`. Registre cada fonte local pelo CLI e selecione-a conforme o papel semântico:

```text
workspace/src/
├── <repositorio-legado>/
├── <servico-alvo>/
└── <contratos-compartilhados>/
```

Consulte `sources list` para obter fontes, papéis e escopos. As etapas recebem somente fontes explicitamente cadastradas e autorizadas para o seu papel; nunca amplie `scope` nem varra repositórios não selecionados. Cadastre ou atualize fontes somente após indicação e confirmação do usuário, usando `sources add`/`sources update`; não altere `.smith/runs/` manualmente. O schema persistido aceito é exclusivamente a versão 1; estados incompatíveis falham sem migração ou escrita.

# Orquestração Multi-Agente via MCP
Economize cota e evite trabalho redundante. Use o MCP `mcp-agents` somente quando a tarefa se beneficiar claramente de outra perspectiva ou de uma análise especializada; tarefas simples devem ser resolvidas diretamente.

## 1. Regras de roteamento

### IA Nativamente
* **Use para:** tarefas pontuais, leitura básica, alterações localizadas, implementação e execução/verificação de testes.
* **Regra:** não chame um agente externo se puder concluir a tarefa com segurança e confiança sem ele.

### Claude Code (`mcp-agents-Ask-Claude`) — arquitetura e análise aprofundada
* **Use para:** planejar mudanças que envolvam vários arquivos, analisar fluxos de negócio difíceis ou obter uma revisão independente de decisões importantes.
* **Pré-requisito:** antes de cada chamada a `mcp-agents-Ask-Claude`, chame `mcp-agents-List-Claude-Models` e escolha um modelo adequado.
* **Como pedir:** descreva a tarefa, o objetivo e as restrições relevantes. Não leia arquivos previamente só para copiar seu conteúdo no prompt; o Claude Code tem acesso ao sistema de arquivos e deve explorar o projeto por conta própria.
* **Escopo:** peça análise ou recomendações por padrão. O Copilot continua responsável por implementar e validar. Só peça ao Claude para editar ou executar tarefas quando o usuário solicitar explicitamente.
* **Permissões:** não solicite modos que ignorem as verificações de segurança ou aprovações do Claude Code.
* **Duração:** chamadas podem levar vários minutos. Quando a interface permitir, execute `Ask-Claude` como tarefa em segundo plano ou delegue a chamada a um subagente, sem bloquear a conversa principal.

### Antigravity (`mcp-agents-Ask-Antigravity`) — execução de modelos Gemini e outros
* **O que é:** a ferramenta chama o CLI Antigravity (`agy`), que pode executar modelos de diferentes famílias. Gemini é uma família de modelos disponível no Antigravity, não o nome da ferramenta de delegação.
* **Use para:** sintetizar documentação ou logs extensos, analisar grande volume de material ou obter uma segunda opinião quando ela puder mudar uma decisão.
* **Pré-requisito:** antes de cada chamada a `mcp-agents-Ask-Antigravity`, chame `mcp-agents-List-Antigravity-Models` e escolha um modelo adequado.
* **Como pedir:** formule uma pergunta específica e peça uma resposta objetiva, com riscos, evidências e incertezas separados.
* **Contexto:** inclua somente o material necessário. Não envie conteúdo extenso se o agente puder acessar os arquivos relevantes diretamente.
* **Duração e permissões:** chamadas podem levar vários minutos. Não solicite modo que ignore aprovações; use sandbox quando apropriado.

---

## 2. Comunicação e economia de tokens

**Não descrever execução passo-a-passo.** Responder de forma concisa, apenas com o resultado pedido:
- Sem narrações do tipo "Vou verificar X, agora vou fazer Y, encontrei Z..."
- Remover descrições desnecessárias durante execução de tarefas
- Se há erro ou bloqueador, explicar; caso contrário, apenas o resultado

---

## 3. Fluxo para tarefas complexas

1. **Decida se delegar agrega valor.** Não delegue automaticamente só porque a tarefa é grande; escolha o agente conforme a seção de roteamento.
2. **Planeje quando necessário.** Para mudanças arquiteturais ou de vários arquivos, consulte Claude antes de implementar. Use Antigravity com um modelo adequado (por exemplo, Gemini) para material extenso ou uma segunda opinião realmente útil; não chame ambos por padrão.
3. **Implemente.** O Copilot aplica as mudanças no workspace, salvo solicitação explícita do usuário para delegar a implementação.
4. **Verifique.** Execute os testes e verificações pertinentes no ambiente. Trate as respostas dos agentes como recomendações: confira-as no código e não declare testes executados se não os executou.
5. **Comunique o resultado.** Resuma decisões, mudanças e verificações; sinalize claramente limitações ou pontos que não puderam ser confirmados.

## 4. Ferramentas MCP disponíveis

Use os nomes exatos expostos pelo servidor `mcp-agents`:
* Claude: `mcp-agents-List-Claude-Models`, `mcp-agents-Ask-Claude`, `mcp-agents-Claude-Help`.
* Antigravity: `mcp-agents-List-Antigravity-Models`, `mcp-agents-Ask-Antigravity`, `mcp-agents-Antigravity-Help`.
* `mcp-agents-List-Gemini-Models`, `mcp-agents-Ask-Gemini` e `mcp-agents-Gemini-Help` são aliases legados do Antigravity; prefira os nomes `Antigravity`.

Não use `ask_codex` ou atribua tarefas ao Codex: essa ferramenta não está configurada neste ambiente. Se outra IA ou ferramenta for adicionada, atualize esta lista e as regras de roteamento para corresponder às capacidades realmente disponíveis.

## Configuração opcional dos MCPs

- O GitHub MCP é integrado ao Copilot CLI; não adicione uma segunda entrada quando o cliente escolhido for Copilot CLI.
- A configuração GitHub do VS Code fica em `.mcp.json` no workspace, arquivo que também pode ser lido pelo Copilot CLI. A prévia informa que a entrada somente leitura poderá ser redundante nesse cliente.
- No VS Code e no IntelliJ, o configurador usa o endpoint remoto oficial em modo somente leitura. Autentique por um mecanismo suportado pelo cliente; o endpoint configurado, sozinho, não comprova autenticação ou conexão. Não grave tokens em arquivos do projeto.
- O Multi-CLI é opcional e fixado em `@osanoai/multicli@1.5.41`. Somente Copilot CLI e VS Code recebem uma allowlist explícita de ferramentas Claude/Antigravity. Não habilite Multi-CLI no IntelliJ enquanto o filtro de ferramentas não estiver verificado.
- A configuração MCP não instala nem inicia servidores durante `--dry-run`. Antes de gravar, mostre a prévia e exija confirmação interativa `CONFIGURE`; iniciar Multi-CLI pode baixar sua versão fixada pelo npm.
- O diagnóstico verifica presença da configuração e executáveis locais, mas não conecta ao servidor nem confirma autenticação. Conclua a conexão e o login no cliente e verifique uma operação de leitura antes de considerar o MCP funcional.

Para inspecionar sem alterar arquivos, use `node plugin/mcp/configure.mjs --client <copilot-cli|vscode|jetbrains> --dry-run`. Para incluir Multi-CLI, informe `--include-multicli`; sua configuração exige confirmação e não habilita Codex ou outros agentes.

## Execução do Dynamic Workflow

Superpowers orienta a metodologia de trabalho; o Dynamic Workflow controla dependências, contratos, gates e estado persistente. Não confunda as skills do Superpowers com o executor.

As sete etapas e seus contratos ficam em `plugin/workflows/project-lifecycle.mjs`; o executor local, sem dependências externas, fica em `plugin/core/engine.mjs`. Execute a partir da raiz do repositório, informando cada arquivo de entrada como caminho relativo ao workspace:

```bash
node plugin/core/cli.mjs start --run-id <iniciativa> --tema "<tema>" --input <arquivo>
node plugin/core/cli.mjs ready --run-id <iniciativa> --tema "<tema>" --input <arquivo>
node plugin/core/cli.mjs complete --run-id <iniciativa> --tema "<tema>" --step <etapa> --artifact <chave>=<arquivo> --input <arquivo>
node plugin/core/cli.mjs approve --run-id <iniciativa> --tema "<tema>" --input <arquivo> --approval-fingerprint <fingerprint-revisado>
node plugin/core/cli.mjs resume --run-id <iniciativa> --tema "<tema>" --input <arquivo>
```

Repita `--input` para todos os arquivos que determinam o subnó e reutilize a mesma lista, o mesmo `run-id` e o mesmo `tema` em cada comando dele. Um mesmo `run-id` pode conter vários temas, com etapas, fingerprints, artefatos e aprovações independentes. `complete` registra somente caminhos e hashes de artefatos relativos ao workspace; o executor valida existência, integridade e dependências antes de liberar a próxima etapa. Alterar fontes reinicia apenas o subnó correspondente.

O gate upstream só pode ser liberado após aprovação explícita do usuário. `approve` exige o fingerprint dos artefatos revisados, retornado por `ready`, e a confirmação literal `APPROVE` (no terminal ou via `--confirmation`); nunca infira aprovação por silêncio, resposta ambígua ou decisão do agente. O estado fica em `.smith/runs/`, é ignorado pelo Git neste repositório e não armazena credenciais nem conteúdo dos arquivos de entrada.

## Sincronização de repositórios

Não execute sincronização durante `init`, `doctor` ou qualquer outra etapa automaticamente. Exija solicitação explícita do usuário e um catálogo JSON externo informado por `--config`; nunca inclua o catálogo pessoal no pacote.

Confira primeiro a previsão, que não consulta remotos nem executa comandos Git:

```bash
node plugin/utils/repository/sync/sync.mjs --config <arquivo.json> --base-dir <diretorio> --dry-run
```

Só execute sem `--dry-run` após revisar a previsão e confirmar que o destino é o esperado. O sincronizador clona projetos ausentes e só avança repositórios limpos, na branch configurada e com o remoto esperado, por fast-forward. Ele bloqueia alterações locais, commits locais, histórico divergente, operação Git em andamento e conflitos; nunca descarta arquivos, troca branches silenciosamente nem aborta operações em andamento.

O catálogo informa `baseUrl`, opcionalmente `defaultBranch`, e uma lista `projects` com `folder`, `gitPath` e `name`; cada projeto pode definir `branch` e `localBranch`. Git usa a autenticação normal do ambiente. Não coloque tokens ou credenciais no catálogo.
