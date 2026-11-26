# Memoria compartida de JJK5e

JJK5e es un módulo de Foundry VTT para D&D 5e. El [README del módulo](../README.md) describe el desarrollo, las pruebas y la compatibilidad. Aquí se conserva el contexto de colaboración que Codex y Claude Code pueden leer desde ambos ordenadores.

## Flujo de trabajo

1. Revisa los [Issues](https://github.com/crislobos14-art/JJK5e/issues) y los [PR](https://github.com/crislobos14-art/JJK5e/pulls). Abre o retoma un Issue con alcance y criterio de aceptación. Deja constancia de quién lo toma y qué rama usará.
2. Actualiza las referencias con `git fetch origin`. Con el árbol de trabajo limpio, crea la rama desde `origin/main`, por ejemplo con `git switch -c fix/123-descripcion origin/main`. Para retomar una rama publicada por la otra persona, usa `git switch --track origin/fix/123-descripcion` si todavía no tienes esa rama local.
3. Abre la copia local con Codex o Claude Code. Pásale el número de Issue y la rama. Si trabajas desde un chat personal, comparte manualmente los enlaces y el contexto público necesario.
4. Publica tu rama y abre un PR hacia `main` con `Closes #123` si el cambio completa el Issue. Incluye resumen, pruebas y comprobaciones pendientes. La otra persona revisa el cambio y los resultados de Actions antes de fusionarlo.
5. Para un relevo, deja en el Issue o PR el objetivo, la rama y el último commit publicado, qué funciona, qué se ha probado y el siguiente paso. Apunta las decisiones que sobrevivan a la tarea en [decisiones.md](decisiones.md).

El Issue es el canal de coordinación. El PR concentra el código y su revisión. El proyecto JJK de ChatGPT aporta contexto a quienes tengan acceso. Usad el [protocolo y prompt común](equipo.md) para repartir el mismo encargo entre las tres IA.

## Primera prueba entre los dos ordenadores

Cuando se fusione el PR inicial, sincronizad vuestras copias y abrid la raíz del repo en Codex y Claude Code. Pedid a cada herramienta que explique el flujo del repositorio y localice los comandos de pruebas sin editar archivos. Usad el siguiente Issue real para comprobar que una persona puede publicar una rama y la otra puede revisarla.

El [diseño de JJK Hub](jjk-hub.md) recoge el prototipo local para agentes de API.
