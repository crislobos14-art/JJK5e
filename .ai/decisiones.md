# Decisiones de colaboración

## GitHub como registro del trabajo

Cada tarea tiene un Issue, una rama y un PR cuando hay cambios que revisar. Los relevos van en el Issue o PR. Las decisiones duraderas van en este archivo con el enlace que explica su contexto.

## Reparto de trabajo

Claude Code implementa, el Codex coordinador define pautas y verifica, y el ChatGPT del compañero apoya. Comparten la misma tarea y la misma base. Una persona decide los cambios de alcance y aprueba la fusión.

## Una entrada común para Codex y Claude Code

`AGENTS.md` contiene las reglas comunes y `CLAUDE.md` las importa. El flujo y la memoria se versionan con el módulo para que ambos ordenadores puedan sincronizarlos junto con el código.

## Interpretaciones de reglas de dominio (V.6)

Ver [#23](https://github.com/crislobos14-art/JJK5e/issues/23) y los PR #38–#42.

- **Diferencia de refinamiento de 1 a 9 en un choque:** la tabla del manual empieza en 10 (9 rondas). El módulo usa 10 rondas.
- **Área de choque:** «350 ft» se entiende como el diámetro para dos dominios, con 175 ft más por cada dominio extra. Se dibuja como un círculo de 87,5 ft × n de radio, centrado entre los lanzadores. Es solo visual: las reglas usan el radio de cada dominio.
- **Abrir un punto débil:** la barrera debe haber perdido al menos 1/3 de sus PG máximos. La salvación se tira contra la CD de EM del lanzador, porque el manual no da una CD.
- **Tinte de escena de FXMaster:** se usa un id fijo (`apiMacro_jjk5eDomain_f`) y no se multiplica el mapa por un color oscuro.
- **Medios propios (2.11):** todos los sonidos, efectos de vídeo y fondos de dominio se generan con código en `tools/build-fx.py` y `tools/fx_recipes.py`. No se usa audio ni imagen de terceros ni del anime. Las descripciones públicas de cómo suenan las técnicas solo guían la síntesis. Para regenerarlos: `python3 tools/build-fx.py`.
- **Recursos de técnica:** solo se automatizan los cambios que el texto fija (descansos, fin de combate, inicio de turno, ataque cuerpo a cuerpo fallado de Fa Jin). Lo que depende de la mesa (presenciar un milagro, una calamidad, domar un shikigami) se marca a mano en el panel.
- **Visibilidad de la EM en combate:** por defecto, los jugadores ven su EM y la de los demás personajes jugadores, pero no la de los PNJ. Los combatientes ocultos nunca se muestran.
- **Integraciones de 2.14:** JJK no reemplaza a los módulos de la mesa: se engancha a sus API públicas (`tokenActionHudCoreAddActionHandlerExtenders`, `renderPortraitPanelArgonComponent`, `combat-tracker-dock-init`, `game.MonksTokenBar.requestRoll`) y cada puente se apaga solo si el módulo no está activo. Sin Monk's TokenBar, la salvación de grupo es una tarjeta con el enricher `[[/save]]` de dnd5e. El daño automático de los perfiles de dominio sigue en manos del DJ, que ahora tira todas las salvaciones sin diálogos.
- **Compatibilidad en 2.14:** los avisos al arrancar siguen los requisitos que publica cada módulo (por ejemplo, Midi-QOL 14.6 exige dnd5e 6.0.6 y Foundry 14.369). El DJ recibe una tarjeta solo cuando cambia el conjunto de avisos. En Foundry 14 la caducidad de efectos la lleva DAE, así que el respaldo propio de JJK queda solo para versiones anteriores; las lecturas de `-=` se mantienen porque solo detectan borrados en mundos de Foundry 13.
