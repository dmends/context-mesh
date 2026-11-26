# Lógica de instalação de skills por agente

## Build

Copia `resources/prompts/*.prompt.md` para `dist/smith-plugin/workflows/prompts/` como estão — sem transformação, sem substituir placeholders.

## Init por agente

- **Copilot** → lê os `.prompt.md` de `workflows/prompts/`, substitui os placeholders, e grava em `.github/prompts/<nome>.prompt.md` no projeto alvo
- **Claude-code** → lê os `.prompt.md` de `workflows/prompts/`, substitui os placeholders, e grava em `.claude/skills/<slug>/` no projeto alvo
- **Cursor** → lê os `.prompt.md` de `workflows/prompts/`, substitui os placeholders, e grava em `.cursor/skills/<slug>/` no projeto alvo
- **Gemini-cli** → lê os `.prompt.md` de `workflows/prompts/`, substitui os placeholders, e grava em `.gemini/skills/<slug>/` no projeto alvo
- **Antigravity** → lê os `.prompt.md` de `workflows/prompts/`, substitui os placeholders, transforma no formato de skill e grava em `skills/<slug>/SKILL.md` no projeto alvo
- **Codex** → lê os `.prompt.md` de `workflows/prompts/`, substitui os placeholders, e grava em `.agents/skills/<slug>/` no projeto alvo
