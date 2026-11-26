# Épico de negócio — <tema>

> **Status inicial:** versão inicial para validação e evolução. Este documento consolida o entendimento extraído das agendas; não implica aprovação de todos os requisitos nem substitui registros de decisões adotadas.
>
> **Nota:** O título (primeira linha) será usado para gerar o nome do arquivo automaticamente.

## Metadados

- **ID:** `EPIC-<TEMA>-<NNN>`
- **Tema/domínio:** `<tema ou domínio>`
- **Versão:** `<número da versão>`
- **Status:** `versão inicial para validação e evolução`
- **Data da consolidação:** `<AAAA-MM-DD>`
- **Responsáveis pela validação:** `<pessoas ou áreas; "a definir" se desconhecido>`
- **Palavras-chave:** `<termos, siglas e sinônimos>`

## Contexto e problema de negócio

<Descreva a situação, necessidade ou oportunidade relatada e por que ela importa.>

## Objetivo e valor esperado

- **Objetivo de negócio:** `<resultado que se pretende alcançar>`
- **Valor esperado:** `<benefício para negócio, cliente ou operação>`
- **Indicadores de sucesso:** `<métrica e alvo, se informados; caso contrário, "a definir">`

## Épico

**Como** `<ator ou público beneficiado>`  
**Quero** `<capacidade ou resultado de negócio>`  
**Para** `<benefício ou objetivo>`

> Se as agendas não identificarem ator, capacidade ou benefício, marque o campo como `a validar`; não invente detalhes.

## Atores e partes interessadas

| Ator/área | Papel ou necessidade     |
|-----------|--------------------------|
| `<ator>`  | `<papel ou necessidade>` |

## Escopo de negócio

### Incluído

- `<capacidade ou necessidade coberta>`

### Não incluído ou explicitamente fora do escopo

- `<item ou "a validar">`

## Necessidades e requisitos de negócio

| ID       | Necessidade/requisito                 | Prioridade                     | Observações                          |
|----------|---------------------------------------|--------------------------------|--------------------------------------|
| `BN-001` | `<necessidade ou resultado esperado>` | `<alta/média/baixa/a validar>` | `<contexto ou validação necessária>` |

## Regras de negócio

| ID       | Regra              | Questão ou ressalva |
|----------|--------------------|---------------------|
| `RN-001` | `<regra relatada>` | `<detalhe ou "a validar">` |

## Fluxos e cenários de negócio

### Fluxo principal

1. `<etapa>`
2. `<etapa>`

### Exceções e variações

- **Cenário:** `<condição>`
- **Comportamento esperado ou relatado:** `<resultado>`

## Critérios de aceite de negócio

Escreva critérios observáveis e verificáveis. Marque como `a validar` quando as agendas não definirem o resultado esperado.

- **CA-001 — Dado** `<contexto>`**, quando** `<ação/evento>`**, então** `<resultado verificável>`.

## Dependências, restrições e riscos

- **Dependências:** `<área, processo, sistema ou contrato; "a validar" se desconhecido>`
- **Restrições:** `<limite de negócio, regulatório ou operacional; "a validar" se desconhecido>`
- **Riscos:** `<risco e impacto; "a validar" se desconhecido>`

## Divergências e questões para validação

| ID      | Questão ou divergência | Impacto no épico              | Validação necessária           |
|---------|------------------------|-------------------------------|--------------------------------|
| `Q-001` | `<questão>`            | `<o que depende da resposta>` | `<pessoa/área ou "a definir">` |

## Decisões relacionadas

Liste apenas decisões efetivamente adotadas e registradas em `decisions/`. Propostas e alternativas ainda não aprovadas permanecem nas questões de validação.

- `<título ou ID da decisão adotada, ou "nenhuma">`

## Histórico de evolução

| Versão             | Data           | Alteração                                                  | Situação da validação                    |
|--------------------|----------------|------------------------------------------------------------|------------------------------------------|
| `<versão inicial>` | `<AAAA-MM-DD>` | Consolidação inicial das agendas listadas neste documento. | Versão inicial para validação e evolução |

## Fontes consultadas e limites da consolidação

- **Agendas:** `<datas, participantes/áreas e assuntos>`
- **Código-fonte:** `<sistema e módulos consultados, se houver>`
- **Knowledge/documentação:** `<domínios, assuntos ou tipos de materiais consultados, se houver>`
- **Pontos a validar e grau de confiança geral:** `<lacunas, divergências relevantes e avaliação ampla da consolidação>`

Registre as fontes em conjunto, sem paths, links, IDs, classificações por requisito/regra ou referências por critério de aceite. Use a seção de questões para detalhar apenas as pendências que precisam de validação.
