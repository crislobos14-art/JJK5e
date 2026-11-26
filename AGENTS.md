# Colaboración en JJK5e

Lee [.ai/README.md](.ai/README.md) antes de empezar. Comprueba la rama, los cambios locales y el Issue asociado. Si alguien ya está trabajando en el mismo alcance, coordina el relevo antes de editar. Conserva los cambios locales de otras personas.

En las tareas compartidas, Claude Code implementa en su rama, el Codex coordinador define pautas y verifica el PR, y el ChatGPT del compañero apoya con investigación y pruebas. Sigue el [protocolo y prompt común](.ai/equipo.md). Una persona revisa y decide la fusión en `main`.

Para cambios del módulo, consulta el [README](README.md) y la [validación de GitHub Actions](.github/workflows/validate.yml). Ejecuta `node --test tests/*.test.mjs` y los controles pertinentes al cambio. Si cambia la automatización de Foundry, describe también qué comprobaste en Foundry o qué prueba en vivo queda pendiente.

Registra el avance en el Issue o PR y las decisiones duraderas en [.ai/decisiones.md](.ai/decisiones.md). Usa únicamente información apta para un repositorio público. Mantén tokens, datos privados y transcripciones de chats personales fuera de Git.
