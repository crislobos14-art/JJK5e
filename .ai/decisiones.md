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
- **Dominios en 2.16:** todo cierre pasa por `closeDomainOf`. Sin `openingId` cierra el dominio abierto; con un `openingId` explícito (incluido `null` de una petición vieja) solo cierra si coincide. Las acciones de ApplicationV2 no se llaman `close`, `tab` ni `toggleControls`, porque esos nombres son acciones propias de la ventana.
- **Íconos en 2.16:** los íconos del módulo se generan con `tools/build-icons.mjs` a partir de las familias de `jjk-identity.mjs` y de glifos de Font Awesome Free (CC BY 4.0, atribución en README). Un ícono nuevo se añade ahí, no a mano con letras.

- **Invocaciones en 2.17:** las criaturas de una técnica se invocan con actividades `summon` de dnd5e que apuntan a la copia del mundo (`Actor.<id>`). Su BC iguala el del invocador, y la CA y los PG escalan con el BC. Si una ficha usa la EM del invocador, lleva `flags.jjk5e.summonerCEMod`: un hook de `createToken` lo rellena con el modificador de EM del invocador, leído de `flags.dnd5e.summon.origin`.
- **Contadores en 2.18:** las actividades declaran en los flags del objeto qué contador mueven (`trackerUse`) y cuántos dados tira su daño (`trackerDice`). El número de dados se cambia en `dnd5e.preRollDamageV2`, para que valga igual con o sin Midi-QOL. Los Milagros y las Marcas de Calamidad se guardan en los usos de su objeto, y no en un flag aparte. Las cargas de Lightning Discharge se cuentan del lado del usuario, no en cada objetivo. Samsara Rewind solo lo aplica el DJ, desde la tarjeta, porque mueve fichas que no son del jugador.
- **Origen de invocaciones de dnd5e (2.18.1):** dnd5e 5/6 guarda `flags.dnd5e.summon.origin` (la UUID del **objeto** que invoca) en el actor invocado, o en su delta si el token no está vinculado, y no en el token. Para encontrar al invocador hay que leer `token.actor.flags.dnd5e.summon.origin`. Los dados de los contadores se fijan dentro del `preRollDamageV2` de `jjk5e.js`, antes de los críticos y de la potencia del dominio.
- **EM transaccional (#60).** El DJ vincula cada recibo confirmado con la tarjeta original. Midi puede reanudar la actividad desde esa tarjeta para su autor. Una actividad encadenada con coste propio obtiene otro recibo. Los tipos sin adaptador conservan el gasto habitual de EM.
Las actividades de seguimiento de Dark Vortex y Sunny Day exigen que el efecto inicial siga activo. Reversal Red reserva Prone para la actividad de colisión. Sunshine consume un ataque de la acción de Atacar. Las reacciones registradas en el cliente se reinician al inicio del turno propio. Cursed Silence cancela la acción desde el hook asíncrono de Midi-QOL.
En 2.21.0 el perfil de energía es común a la ficha y a ambos modos de consumo. El daño al alma se registra al aplicar los PG y el descanso distingue daño temporal de persistente. La RCT consume sus dos reservas dentro de la misma cola que el daño al alma.
- **Auditoría 2.21.1:** dnd5e compara `visibility.level` de las técnicas con el nivel del conjuro, así que el bloqueo por nivel de personaje se declara en `flags.jjk5e.activityLevel.<actividad>` y lo aplica `preUseActivity`. La EM actual se refleja siempre en `flags.jjk5e.ceNow`, para las fórmulas. El mantenimiento por turno se declara en el flag `upkeep` del efecto y lo cobra el DJ. El motor de EM rechaza antes de reservar lo que dnd5e o el módulo van a rechazar. Una negativa nativa imprevista sigue yendo a revisión del DJ. Las tarjetas de dnd5e 6 se leen con `cardMeta()` (`message.type` + `message.system`).
