# Trabajo conjunto en JJK5e

Enviad la misma ficha de tarea a las tres IA al empezar. Cambiad únicamente el rol. El [Issue](https://github.com/crislobos14-art/JJK5e/issues) contiene el alcance, las pautas y los relevos. El [PR](https://github.com/crislobos14-art/JJK5e/pulls) contiene el código y su revisión.

1. **Codex coordinador** contrasta el encargo con el código y las fuentes, fija pautas y criterios verificables, y revisa el PR. Si la interfaz permite elegir nivel de razonamiento, usad el más alto disponible para la revisión.
2. **Claude Code del compañero** inspecciona la misma base, implementa en una rama propia, ejecuta las pruebas y entrega el PR.
3. **ChatGPT del compañero** apoya en paralelo con referencias, casos límite, propuestas de pruebas y dudas concretas. Comparte los hallazgos con enlaces y supuestos marcados.

Si el alcance está claro, Claude puede empezar mientras los otros dos examinan la tarea. Si una decisión puede cambiar la implementación, Claude avanza con la inspección y las pruebas mientras se resuelve en el Issue. Para la revisión final, compartid con Codex el PR y su último commit. Si una sesión carece de acceso a GitHub, una persona traslada sus aportaciones. Una persona autoriza la fusión.

## Mapa del repositorio

| Qué comprobar | Dónde empezar |
| --- | --- |
| Versión y compatibilidad con Foundry, dnd5e, Midi-QOL y DAE | [module.json](../module.json), [README.md](../README.md) |
| Cambios publicados | [CHANGELOG.md](../CHANGELOG.md), [Releases](https://github.com/crislobos14-art/JJK5e/releases) |
| Reglas, automatización y fichas | [scripts/](../scripts/), [docs/design/](../docs/design/) |
| Compendios y datos fuente | [src/packs/](../src/packs/), [data/](../data/), [build-packs.mjs](../tools/build-packs.mjs) |
| Auditoría de técnicas | [INNATE_SPELL_AUDIT.md](../docs/INNATE_SPELL_AUDIT.md), [audit-techniques.mjs](../tools/audit-techniques.mjs) |
| Pruebas y publicación | [tests/](../tests/), [validate.yml](../.github/workflows/validate.yml), [release.yml](../.github/workflows/release.yml) |

## Prompt común

> Trabajamos en JJK5e, https://github.com/crislobos14-art/JJK5e, un módulo de Foundry VTT. Lee el Issue, revisa la base indicada, `AGENTS.md`, `.ai/equipo.md` y los archivos pertinentes. Si te falta acceso, pide el enlace o fragmento e indica qué queda por confirmar.
>
> - **Issue:** [enlace]
> - **Objetivo:** [resultado deseado]
> - **Aceptación:** [cómo comprobaremos que está hecho]
> - **Base:** [commit o rama exacta]
> - **Rol:** [Claude Code / Codex coordinador / ChatGPT de apoyo]
>
> - **Claude Code:** Implementa en tu rama. Ejecuta las pruebas aplicables y entrega el PR, el commit y las comprobaciones pendientes.
> - **Codex coordinador:** Verifica el estado, las fuentes y los supuestos. Entrega pautas, orden de trabajo y pruebas de aceptación. Con el PR disponible, revisa el diff y las evidencias y emite un veredicto con hallazgos y bloqueos.
> - **ChatGPT de apoyo:** Investiga referencias y casos límite, propone alternativas y pruebas, y entrega al equipo resultados con fuentes y dudas concretas.
>
> Actúa según el rol elegido. Responde con la base que verificaste, tus hallazgos o cambios, las pruebas, los bloqueos y el siguiente paso. Registra lo necesario en el Issue o PR si tienes acceso y autorización, o deja el texto listo para que lo copiemos. Mantén los secretos y datos privados fuera del repositorio público.
