# Changelog

## 1.102.0 — Dominio dentro del mapa, sin capa oscura e identidad JJK
- La barrera dibujada cabe en el mapa. El alcance de las reglas sigue en pies (175 ft; 655 ft sin barrera): cuando el círculo se sale del mapa, se dibuja solo la parte que queda dentro, sin invadir el borde. La zona se vuelve a ajustar cuando encoge en un choque. Si Foundry usa una plantilla en lugar de una región, la plantilla se reduce hasta caber, con un mínimo de una casilla.
- Ya no aparece el rectángulo oscuro: el ambiente de dominio de FXMaster ya no tiñe el mapa de morado oscuro (en mapas oscuros parecía negro). Ahora solo baja un poco la saturación y sube el contraste. La zona del dominio usa un violeta más claro.
- Tarjetas de dominio más cortas, con lo importante primero:
  - Apertura: PG, CA, refinamiento y alcance en pies en una sola línea.
  - Choque: quién gana y por cuánto, en cuántas rondas se rompe el perdedor (o «se rompe ya»), y que el impacto garantizado queda suspendido en ambos hasta resolver el choque.
  - Empate: se resume en una línea.
  - Reacción: una frase.
- Sello JJK por técnica y objeto: cada técnica, dominio, herramienta maldita, voto o rasgo JJK lleva un sello en la ficha, en su hoja y en el chat.
  - El color y el icono indican la familia: fuego, vacío, sombra, sangre, dominio, herramienta…
  - El patrón, el giro y los anillos salen del nombre, así que dos técnicas de la misma familia se distinguen.
  - Es el mismo en todos los clientes y no modifica ningún documento.
## 1.101.0 — Avisos sin solapes
- Los avisos emergentes de Sealed Ink ya no quedan debajo de los avisos de Foundry. Antes empezaban siempre a 65 px y Foundry los cubría. Ahora se colocan justo debajo de los avisos de Foundry y de la barra de escenas.
- El botón de avisos y su panel ya no tapan las tarjetas de chat de Foundry (las que aparecen junto a la barra lateral), la barra de accesos rápidos ni la lista de jugadores. Se colocan encima de ellas y se recolocan solos cuando esas tarjetas aparecen o desaparecen.
- El panel ajusta su altura al espacio libre, así que en pantallas de 768 px o menos ya no se monta sobre los avisos. Mientras está abierto, los avisos emergentes se ocultan, porque el panel ya los lista todos.
- Tarjeta de choque de dominios: el refinamiento y el estado de cada participante quedan alineados aunque los nombres tengan distinta longitud.
- Auditoría en Chrome con una maqueta de la interfaz de Foundry: barra lateral abierta y plegada, en 1920×1080, 1366×768, 1100×700 y 800×600. Antes de la corrección había 8 combinaciones con solapes; ahora ninguna.
## 1.100.0 — Motores de dominio y EM
- Choque múltiple: si se cierra uno de los dominios de un choque entre 3 o más, el choque se vuelve a resolver entre los que siguen abiertos. Antes los demás conservaban el papel calculado contra el dominio que ya no estaba. Por ejemplo, dos dominios con el mismo refinamiento, perdedores ante un tercero, seguían encogiéndose y se rompían en la ronda 6. Ahora quedan empatados, como dicta su refinamiento.
- Technique Burnout: ya no se puede abrir un dominio nuevo, completo o incompleto, mientras dura. Antes Incomplete Domain (dote) y la apertura desde el panel o una macro lo permitían.
- Auditoría simulada sin fallos:
  - 5 ciclos seguidos de abrir y cerrar no dejan restos.
  - Un doble clic en abrir crea un solo efecto.
  - El dominio caduca por rondas.
  - La barrera rechaza daño negativo o NaN y, al llegar a 0, cierra el dominio y aplica el burnout.
  - Borrar al actor con el dominio abierto no da error.
  - En la EM, 10 gastos simultáneos de 3 sobre 20 aprueban exactamente 6, y la recuperación y las fracciones son correctas.
## 1.99.0 — Rendimiento
- Ventanas JJK más fluidas: el panel JJK, Dominio, Carrera, Votos y el creador ya no se redibujan varias veces seguidas. Cuando un gasto de EM actualiza a la vez el objeto, el actor y sus efectos, cada ventana abierta se redibuja una sola vez por fotograma.
- Menos tirones cada 30 s: la recuperación periódica de reservas de EM ya no recorre todos los tokens de todas las escenas. Antes eso obligaba a Foundry a preparar los actores de escenas que nadie miraba. Ahora solo revisa los actores del mundo y los tokens de las escenas activas o abiertas, y solo procesa los que tienen una reserva pendiente antigua. Al iniciar la partida se sigue revisando todo.
- Subir de nivel: el selector de dotes de la Mejora de característica ya no vuelve a cargar todo el compendio de dotes cada vez que cambia cualquier objeto del mundo, como al gastar EM. Ahora solo lo recarga si se edita el compendio.
- HUD de combate y centro de avisos: arrastrar un token ya no los redibuja en cada paso del movimiento, solo una vez por fotograma.
- El botón de subir de nivel parpadea 3 veces en lugar de hacerlo sin parar. Con «reducir movimiento» del sistema, no parpadea.
## 1.98.0 — Motor de dominios y Sealed Ink
- Rectángulo negro o morado que no desaparecía tras cerrar un dominio: era el tinte de escena de FXMaster. Antes se guardaba con un id aleatorio en memoria del DJ. Al recargar o cerrar con otro DJ, ese id se perdía y el tinte quedaba en la escena para siempre. Ahora usa un id fijo, hay un solo tinte por escena y se quita solo al cerrarse el último dominio abierto en esa escena. Se quita también aunque se desactive la opción de FXMaster mientras el dominio está abierto.
- Limpieza automática: al iniciar la partida (DJ) y al cerrar cualquier dominio, se borran los restos de dominios ya cerrados: el tinte (incluido el que dejaron versiones anteriores), las zonas, los marcadores de barrera y las animaciones de Sequencer. Macro manual: `game.modules.get("jjk5e").api.cleanupDomains()`.
- Las animaciones de apertura ya no dejan una capa negra persistente (`jb2a.darkness.black` sin duración): todas las capas terminan solas y se limpian al cerrar.
- Sealed Ink ajusta la cabecera, agrupa los recursos en su tarjeta nativa y permite leer los accesos JJK completos en fichas estrechas. La pestaña JJK reorganiza sus secciones según el espacio disponible.
- El choque muestra el refinamiento y el estado de cada participante en el chat. Las animaciones de apertura y choque respetan el área de la escena y no modifican el alcance ni el resultado de las reglas.
## 1.97.0 — Dotes de técnica en la Mejora de característica
- El grupo «Tu técnica: <técnica>» del selector de dotes ya no incluye las 8 dotes generales de Técnica maldita (Cursed Lotus, Flow Technique, Stone Cutting Style, Infinity y Voracity (Minor Innate Technique), Simple Domain (Minor Cursed Technique), Falling Blossom Emotion (Major Cursed Technique)). Estas dotes las puede tomar cualquier hechicero y ahora aparecen en su categoría. Pasaba con todas las técnicas.
- Un trasfondo que concede una técnica (por ejemplo, Clan Sorcerer) ya no hace que las dotes que lo piden como requisito cuenten como dotes de técnica.
- Prueba nueva: para cada una de las técnicas con dotes propias, el grupo de técnica solo contiene dotes de esa técnica.
## 1.96.0 — Auditoría de automatizaciones para dnd5e 6.1
- Velocidad: 19 efectos de técnicas y dotes (Blue Hour, Golden Week, Extreme Cold, Illusive Terrain, Immobilizing Eyes, Indigestion, Energizing Gaze, Event Horizon, Reverse Transcendence, Aerokinesis, piernas inmovilizadas, Flowing Red Scale…) usaban `system.attributes.movement.all`. dnd5e 6 guarda las velocidades en `movement.speeds`, así que los que la multiplicaban (×0,5, ×2, ×3, ×¼) no hacían nada. Ahora se traducen al multiplicador nativo de movimiento de dnd5e, y los que la fijan a 0 (Grounding, X-Axis Shot, Stance of the Sparks, Projection, Majestic Pose, Light Manipulation) usan el mismo multiplicador en lugar de depender de DAE.
- Resistencias e inmunidades totales: `dr.all` y `di.all` (Analgesic, Core Reversal, Intangibility, Inverse Ratio, World Anchor, Medical Clinic, Comedy) se escriben como el tipo de daño nativo «ALL» de dnd5e, sin depender del mapeo de DAE.
- Agotamiento temporal: dnd5e 6 recalcula el agotamiento desde su propio efecto después de aplicar los demás, así que 10 efectos que sumaban niveles (Blackened Blood, Improved Bindings, Extreme Cold, Heat Dissociation, las 5 fases de Amber Release, Noxious Poison) no daban agotamiento. Ahora suman niveles reales mientras dura el efecto y, al terminar o desactivarse, quitan exactamente los que añadieron (máximo 6).
- Las tres correcciones se aplican al crear el efecto, así que también arreglan los objetos ya importados en los mundos, sin volver a importarlos Funcionan tanto con cambios de efecto en formato `mode` como en el formato `type` de Foundry 14.
- Robustez sin escena activa: invocaciones de respaldo, clones y la comprobación de aliados adyacentes ya no lanzan error cuando no hay lienzo o escena.
- Limpieza: se elimina del repositorio un `module.zip` antiguo (v1.22.2) que seguía en la raíz y podía confundirse con la versión publicada.
- Verificación: un barrido simulado ejecuta las 1688 actividades de las 469 técnicas, con y sin la autoridad de EM del DJ. Las 1202 con coste cobran exactamente lo previsto, sin errores. Solo se bloquean, como corresponde, las sub-acciones de dominio sin un dominio abierto.
## 1.95.1 - Intercambios, efectos de técnicas y controles de ficha

- Boogie usa el token del lanzador y conserva el objetivo elegido al pagar. Clap Back aplica el descuento y amplía el alcance a 45 pies. Round of Applause lo amplía a 60 pies.
- Standing Ovation permite repetir Boogie gratis durante el turno del lanzador si ambos tokens están dentro de su dominio.
- Golden Week aplica una sola vez la bonificación de CA y velocidad. Detener el tiempo vuelve a estar disponible al terminar el efecto. En personajes existentes, usa la actualización de automatizaciones del módulo para aplicar los nuevos datos de compendio.
- Los efectos conservan sus prioridades y operadores al migrar a dnd5e. Activar de nuevo una sección de Sealed Ink mantiene el foco del teclado.
- Cada nueva release incluye un archivo de recuperación con el manifiesto, el módulo instalable y las sumas SHA-256 de la versión publicada anterior.

## 1.95.0 — Ficha Sealed Ink con pestaña JJK integrada
- Ficha Sealed Ink integrada (#23): la cabecera duplicada desaparece. La ficha abre en su propia pestaña de D&D 5e, con retrato, CA, iniciativa, movimiento, PG, Dados de Golpe y EM en su sitio nativo. Las herramientas JJK son una pestaña más de la barra derecha («Jujutsu (JJK)», solo para propietarios): lista de secciones a la izquierda (9 en PJ, 7 en PNJ) y contenido a la derecha, en una columna si la ventana es estrecha. «Volver a la ficha» y Escape regresan a la última pestaña nativa usada. La sección elegida se recuerda por actor.

## 1.94.0 — Actividades Sealed Ink, historial de EM y ajustes de avisos y medidor
- Avisos Sealed Ink en ventanas estrechas (Issue #19, punto 4): por debajo de 700 px de ancho, los avisos, el botón «Controles JJK» y su panel se pegaban a 12 px del borde y quedaban bajo la barra lateral. Ahora mantienen la separación de la barra y se encogen.
- Altura del medidor de EM (Issue #19, punto 5): el relleno y el campo de edición fijan su propia altura, así que una regla de un tema como `.meter .progress { height: 12px }` o `.meter { display: block }` ya no los recorta.
- Sealed Ink: las pestañas Combate y Técnica permiten buscar y ejecutar actividades compatibles, ordenar sus botones y compartir favoritos con el HUD. Muestran coste base estimado y alcance cuando está disponible.
- Historial de EM en Combate: muestra los ajustes registrados, reservas, confirmaciones y devoluciones, con acceso a la tarjeta de chat cuando está vinculada.

## 1.93.0 — Energía maldita en la ficha y espacio de trabajo Sealed Ink
- Espacio de trabajo Sealed Ink (PR #13): las fichas «Sealed Ink — Personaje» y «Sealed Ink — PNJ / Invocación» suman un panel de trabajo con pestañas Combate, Técnica, Progresión, Cuerpo y alma, Inventario, Votos, Invocaciones, Dominio y Efectos; cada botón abre la herramienta JJK correspondiente. Solo aparece en esas fichas, no en la ficha estándar de D&D, y oculta la franja de resumen para no repetir botones.
- Modo compacto e inversión de columnas del espacio de trabajo (PR #13): se puede plegar a la cabecera con PG, EM y CA, o invertir sus dos columnas; recuerda la pestaña y el estado por actor. Se baja bajo la barra de título de la ventana y la pestaña Cuerpo muestra las extremidades traducidas.
- Energía maldita en el formato de la ficha: la EM ya no vive solo en la tarjeta JJK. Es un medidor como los de PG y Dados de Golpe: en personajes va bajo los Dados de Golpe; en PNJ, bajo los PG de la cabecera. Al hacer clic se escribe el valor (15 fija, +3 recupera, -2 gasta) usando las mismas reglas y autoridad del DJ que el resto de la EM; − / + y el engranaje (controles JJK) quedan junto al título. La EM reservada pendiente se ve rayada con un candado y bloquea la edición con un aviso; con la EM baja (umbral Sealed Ink) el borde pasa a rojo. En Sealed Ink el medidor es violeta de energía y los Dados de Golpe pasan a gris hueso para no confundirse. La fila de EM de la tarjeta JJK y la casilla del resumen se ocultan cuando el medidor está visible. Ajuste de cliente «Medidor de energía maldita en las fichas».
- Avisos Sealed Ink: los avisos, el botón «Controles JJK» y el panel no detectaban la barra lateral de Foundry cuando usa posición fija y quedaban debajo de ella. Ahora miden su posición real, abierta o plegada.
- Medidor de EM robusto: ocupa toda su altura aunque otro módulo cambie el estilo base de los medidores. Verificado en navegador real (Chrome) con 41 comprobaciones de interacción (medidor de EM, teclado, tablas adaptables, ventanas fluidas) y 19 del centro de avisos.

## 1.92.0 — Sealed Ink, herramientas de mesa y compatibilidad opcional
- Tidy 5e Sheets: acceso al panel JJK desde las fichas de personaje compatibles. Quick Insert: abre la búsqueda externa con la consulta escrita en Sealed Ink.
- El diagnóstico del GM detecta los módulos opcionales y muestra sus versiones.
- Item Piles: cancela transferencias que incluyan reservas de EM o RCT u objetos JJK vinculados a una invocación del mundo. El botín ordinario sigue su flujo habitual.
- La validación conjunta en una partida real de Foundry sigue pendiente.
- Centro del GM: versiones, dependencias, estado de ajustes, actores con automatizaciones desactualizadas y acceso al diagnóstico de recursos pendientes.
- Actualización de fichas: vista previa por objeto, selección de cambios y reversión durante la sesión para objetos que no hayan cambiado desde la actualización.
- HUD: favoritos por mundo, usuario y actor; filtro de favoritos, tipo de acción, coste de EM y alcance cuando están disponibles.
- Invocaciones: recursos y enlaces a la ficha y los controles existentes desde el HUD. El invocador sigue resolviendo el coste de las órdenes según su técnica.
- Consulta de técnicas y reglas por nombre en los compendios disponibles, incluidos los nombres originales cuando existen.
- Avisos: filtro por tipo, acceso al actor o dominio y sonido local urgente opcional.

- Auditoría de botones y pestañas: se revisaron todos los botones del panel (5 pestañas, como DJ y como jugador), de votos, carrera, HUD de dominio, menú JJK, atajos, tarjeta de la ficha, tarjetas de chat, ajustes y reglas opcionales; todos tienen acción y textos en inglés y español. Correcciones: «Emoción negativa» ya no queda en silencio con la EM llena o sin reserva de EM; «Descanso corto» avisa si falta la reserva, hay reservas de EM pendientes o un voto lo bloquea. El botón de descanso no disponible ya no está desactivado (eso ocultaba su explicación): se ve atenuado, muestra el motivo al pasar el cursor y al pulsarlo. Las filas y fichas clicables (misiones, alumnos y profesores, cerrar estados con «×») se activan con Tab y Enter/Espacio. La ayuda de atajos muestra 1–5 para el DJ.
- Ventanas fluidas: las ventanas JJK y las fichas Sealed Ink de personaje y PNJ se redimensionan desde cualquier borde o esquina, no solo desde la esquina inferior derecha. Recuerdan su último tamaño por tipo de ventana (ficha de personaje, de PNJ, panel, carrera…) y vuelven a la pantalla si se achica el navegador. Las fichas bajan a 560 px (personaje) y 460 px (PNJ) de ancho, y las ventanas JJK a 300 px. Por debajo de 700 px y de 560 px, la columna lateral se estrecha, las características pasan a dos filas de tres y los detalles a una columna; el inventario de D&D 5e oculta sus columnas por prioridad. Se puede desactivar con el ajuste de cliente «Ventanas fluidas». En fichas estrechas, las etiquetas de la tarjeta JJK (grado, escuela, votos) pasan a otra línea en vez de encimarse.
- Tablas adaptables: cada tabla del módulo (ventanas JJK, fichas y superficies Sealed Ink, tablas de tirada, diarios con tablas de tinta y tarjetas de chat) se ajusta al ancho de su ventana. Ancha: más espacio. Media: compacta. Estrecha: una tarjeta por fila con el nombre de la columna junto a cada valor; las tablas de dos columnas y las que tienen campos editables conservan sus columnas. Nuevo ajuste de cliente «Vista de tablas»: Automática, Amplia, Compacta, Tarjetas o Desplazamiento horizontal (primera columna fija). Nunca se modifica una tabla mientras se edita su texto.

## 1.91.0 — Sealed Ink 2: fichas, tablas, animaciones y avisos
- Ficha de personaje: D&D 5e define su tema oscuro con `@scope`, que ganaba a los colores de Sealed Ink. Por eso aparecían textos azul grisáceo, dorados y fondos «denim». Ahora Sealed Ink sustituye los tokens del sistema en la propia ficha: fondos tinta, cabeceras de tarjeta con el rojo del sello, texto hueso, PG en rojo y Dados de Golpe en violeta de EM. La cabecera, la tarjeta lateral, las pestañas verticales, las características y las tiradas de salvación siguen la misma estructura sin bordes redondeados.
- Ficha de PNJ: cabecera compacta, retrato enmarcado con sombra de sello, tarjeta lateral con borde rojo y la misma paleta que la ficha de personaje. Sin el estandarte del sistema, que no encajaba con Sealed Ink.
- Tablas: inventario, rasgos, conjuros y efectos usan la misma tabla tinta, con cabecera roja, filas alternas, número tabular y marca roja al pasar el cursor. Las tablas del módulo, del chat, de diarios y de compendios comparten cabecera fija al desplazarse y alineación numérica. Las tablas de papel (`jjk-ink-table`) conservan su diseño, con sombra de sello y cabecera fija.
- Animaciones y correcciones: la transición de pestaña solo se reproduce al cambiar de pestaña, no en cada actualización de la ficha, y el resumen aparece con animación una sola vez. Al cambiar PG o EM, la barra muestra un breve anillo rojo, hueso o violeta. Todo respeta «Movimiento» y «reducir movimiento». El resumen ya no repite PG, CA, características ni EM, que ya muestran la ficha nativa y la tarjeta JJK; solo deja lo que falta: Dominio y los objetos de almacenamiento (y los controles JJK en PNJ). Bajo 620 px de ancho, la tarjeta lateral se apila sobre el contenido.
- Avisos: las notificaciones Sealed Ink muestran icono y tipo (crítico, energía maldita, estado), una barra con el tiempo restante que se pausa al pasar el cursor o con el foco, y una salida animada. Al hacer clic se abre el historial. El botón «Controles JJK» muestra un contador de no leídos. El panel se cierra con Escape, devuelve el foco y muestra un estado vacío. Los avisos, el botón y el panel siguen el ancho real de la barra lateral de Foundry (abierta o plegada) en lugar de un margen fijo de 325 px que los tapaba o los dejaba flotando.
- Validación: 175 pruebas, sintaxis y ESLint sin avisos. Sin prueba visual dentro de Foundry; conviene revisar las fichas abiertas y plegar la barra lateral.

## 1.90.0 — Auditoría de Sealed Ink 1.89
- Hoja Sealed Ink: corrección en este mismo release; el botón «Carrera» ya estaba disponible (se retiró una clave duplicada en la API).
- Hoja Sealed Ink: los botones del resumen (Controles JJK, Dominio, Votos, Carrera y almacenamiento) usan el actor actual de la ficha; con tokens no vinculados ya no actúan sobre una copia vieja.
- Cursed Inventory, Technique Storage, Insect Storage y Cursed Battery se detectan también por nombre, así que el acceso rápido aparece con copias del mundo, compendios importados u objetos traducidos.
- El resumen de recursos (PG, CA, características y EM) ya no se muestra a quien solo tiene permiso limitado sobre el actor.
- Contraste: las ventanas con Sealed Ink activan el tema oscuro de Foundry y D&D 5e, para que las partes nativas de la hoja no queden con texto claro sobre fondo claro; al desactivar Sealed Ink se restaura el tema original.

## 1.89.0 — Interfaz unificada Sealed Ink
- Sealed Ink es el diseño predeterminado para quienes todavía no han guardado una preferencia. Se amplía a herramientas JJK, chat, ajustes, editores y compendios con controles de animación por cliente.
- Registro independiente de las fichas de personaje y PNJ. Las fichas seleccionables añaden un resumen de recursos y accesos a herramientas JJK según los permisos del actor.
- Acceso desde la ficha a Cursed Inventory, Insect Storage, Technique Storage y Cursed Battery cuando el actor posee el recurso correspondiente.
- Quedan pendientes las plantillas completas de Sealed Ink 2.1–2.8, la minihoja, el reordenamiento de acciones y rasgos, y la automatización del almacenamiento y la transferencia de EM. Validación visual y multijugador en Foundry pendiente.

## 1.88.0 — Cierre de dominio, dotes por técnica/raza/clase y ventanas redimensionables
- Cerrar dominio: el HUD usaba una copia vieja del actor (pasa con tokens no vinculados), así que el botón no cerraba nada. Ahora siempre lee el actor actual, el cierre funciona aunque el HUD tenga un id de apertura viejo, avisa si no se pudo y cierra la ventana.
- Recuadro negro: la animación de oscuridad al abrir el dominio (jb2a.darkness) ahora dura 2,5 s con desvanecido y tiene nombre, así que también se elimina al cerrar el dominio.
- Dotes al subir de nivel y en la creación: agrupadas primero por «Tu técnica», «Tu raza» y «Tu clase», y luego por categoría JJK. El filtro de Sealed Ink respeta ese orden.
- Todas las ventanas JJK (panel, menú, votos, carrera, HUD de dominio, creación, reglas opcionales y diálogos) y la ventana de avances de D&D 5e se pueden redimensionar; el contenido se desplaza en vez de cortarse.
- Sealed Ink, aumento de característica: el contador de puntos ocupa toda la fila en lugar de una casilla de la cuadrícula.

## 1.87.0 — Motores Sealed Ink de creación y combate
- Character Creation Engine: añade una revisión visual, no destructiva, de los avances nativos, atributos, clase, raza, trasfondo, técnica, atributo de EM y mentalidad, con avisos de duplicados o recursos vinculados ausentes.
- La compra de puntos ya no sobrescribe silenciosamente bonificaciones de avances existentes: cuando el personaje ya tiene clase, raza o trasfondo, el creador pide revisar y confirmar los atributos en la hoja nativa.
- Combat Interaction Engine: muestra PG, EM y economía de acciones, permite buscar y filtrar actividades propias y delega su uso una sola vez al flujo nativo de D&D 5e/JJK5e.
- Las reacciones, actividades de dominio, objetivos, disparadores, costes variables y acciones adicionales permanecen bajo sus motores nativos; el panel no duplica tiradas, pagos ni registros de turno.
- Auditoría automatizada: 165 pruebas, sintaxis, ESLint sin advertencias del repositorio, JSON, revisión de técnicas y compendios, y construcción de los 11 packs. No se realizó una prueba de ejecución dentro de Foundry.

## 1.86.0 — Correcciones de automatización y compatibilidad
- Emoción negativa: el jugador ya no se queda bloqueado; su botón envía la petición al GM, que confirma el desencadenante y concede la EM (requiere «Peticiones de jugadores al GM»).
- Intercambio de dados de golpe por EM: el botón del panel se desactiva y explica por qué cuando no hay un descanso corto completado, hay combate o el intercambio espera la conciliación del GM.
- Traducidos los 21 textos de 1.84 que solo existían en inglés y español dentro del código (descanso, conciliación, shikigami a 0 PG, avances, mentalidad, dote adicional); ahora están en los archivos de idioma.
- Sealed Ink: la sección de invocaciones vinculadas solo se redibuja en las hojas afectadas por el cambio, en lugar de en todas las hojas abiertas cada vez que cambia cualquier actor.
- Sealed Ink: cada renderizado se procesa una sola vez (antes, hasta tres veces por los ganchos de la cadena de clases).

## 1.85.0 — Historial de Sealed Ink y correcciones
- Opción para conservar el historial de avisos y su estado de lectura entre sesiones en el mismo navegador, por mundo y usuario. Está desactivada por defecto y vuelve a comprobar los permisos al restaurar los avisos.
- El HUD conserva el filtro de búsqueda y comprueba que el actor y la actividad sigan disponibles antes de iniciar la acción nativa de D&D 5e.
- Los controles de invocaciones vuelven a comprobar la escena, el vínculo y los permisos antes de actuar.
- El despertar de RCT se puede reintentar si faltó conceder la reserva de curación, sin duplicar el avance.
- Sigue pendiente la validación multijugador en Foundry con Midi-QOL y DAE.

## 1.84.0 — Sealed Ink y mejoras de automatización
- Amplía Sealed Ink a progresión, dotes, combate y descansos, editores, compendios y herramientas JJK, con preferencias por categoría y por usuario.
- Añade un centro de avisos y un HUD de combate opcionales. Muestra recursos y estados del actor, abre actividades nativas y presenta cambios con animaciones locales que respetan la preferencia de movimiento reducido.
- Mejora la creación y progresión de personajes con selección de mindset, controles de requisitos y confirmación para dotes.
- Refuerza las comprobaciones de descansos y energía maldita, economía de acciones, invocaciones, Simple Domain, Falling Blossom Emotion, RCT, daño al alma y requisitos de reversión de técnicas.
- Sealed Ink sigue en desarrollo. Quedan pendientes los diseños completos de las hojas y las pruebas de integración en una partida multijugador real de Foundry con Midi-QOL y DAE.

## 1.83.0 — Hoja Sealed Ink (vista preliminar)
- Añade Sealed Ink como opción visual para personajes y PNJ. El diseño nativo de D&D 5e sigue siendo el predeterminado. Cada usuario puede elegir el diseño en los ajustes del módulo y también se puede seleccionar la hoja Sealed Ink desde la configuración del actor.
- Conserva las tiradas, actividades, inventario y permisos de las hojas nativas. Para los dueños del personaje, muestra las invocaciones vinculadas visibles de la escena actual y permite abrir sus fichas.
- Añade ventanas redimensionables y cuatro modos de animación que respetan la preferencia de movimiento reducido.
- Recuperación por emoción negativa requiere confirmación del GM. Buscar un espíritu maldito, Maldito al morir y Percepción del alma de objetos quedan desactivadas en mundos que todavía no hayan elegido un valor.
- La hoja es una vista preliminar sobre el diseño nativo. La validación multijugador en Foundry con Midi-QOL y DAE sigue pendiente.

## 1.82.1 — Auditoría de los motores de dominio y EM
Auditoría del motor de dominios y del motor de transacciones de EM. Puntos débiles: desde dentro del dominio la barrera solo se puede dañar si el atacante encontró su punto débil (Percepción CD 30), como dice el manual; antes el punto débil se guardaba pero no se usaba. Traducidos los textos que seguían en inglés: tarjeta de choque múltiple de dominios, descripciones de Falling Blossom Emotion (ofensiva) y Simple Domain, y nombre del marcador de barrera. La revisión periódica de ventanas de reacción solo recorre las escenas activas o vistas por algún jugador (menos carga en mundos grandes). Limpieza de 27 avisos del lint. Sin errores encontrados en el motor de EM.

## 1.82.0 — Escuela de jujutsu
Nuevo apartado Escuela de jujutsu. Cada personaje puede ser alumno (1.º, 2.º o 3.º año) o profesor de Tokio o Kioto, y el alumno elige a su profesor. La ficha de personaje muestra una etiqueta con el año o el rol (clic para editar). En la pestaña Herramientas del panel aparece el apartado con el profesor del alumno o la lista de alumnos del profesor (clic para abrir su ficha). El GM puede pasar de año al alumno; tras 3.º se gradúa, y con la regla opcional Progresión anual se ofrece también la mejora. Un profesor no puede recomendar a sus propios alumnos para ascender de grado.

## 1.81.0 — Reglas generales, reglas opcionales y avances
Nuevos diarios 15.1 Reglas generales (Rules of Thumb) y 15.2 Reglas opcionales, en inglés y español; faltaban en el compendio. Technique Burnout: terminan las formas y efectos mágicos de la técnica y sus invocaciones quedan inertes (aturdidas; derribadas si volaban) hasta que acaba. Recuperar Burnout: la CD baja 5 por cada minuto transcurrido. Dominio incompleto: las criaturas dentro tiran con desventaja las salvaciones contra la Técnica Innata. Acción de turno completo: la Expansión de Dominio no se puede usar si ya gastaste la acción o la acción adicional en tu turno, y con Midi-QOL marca ambas como usadas. Nueva herramienta de daño por caída según el tamaño. Daño al alma: con 6+ niveles de Soul Awareness y RCT se puede sanar gastando de la reserva. Avances: al alcanzar 1, 4 u 8 el GM recibe una tarjeta para conceder la Comprensión despertada. Espíritus malditos: despiertan la Fisiología maldita en lugar de la RCT. Restricción Celestial no puede tomar dotes que usan energía maldita. Solo un Pacto Celestial por criatura. Requisitos verificables en 10 dotes más. Los 12 shikigami del compendio son inmunes al daño no mágico.

## 1.80.1 — Tablas y pestañas Sealed Ink
Ventana Carrera del hechicero en Sealed Ink: pestañas Grado/Misiones/Reputación como botones (contador de misiones activas, flechas, Inicio/Fin, foco conservado). Reputación como tabla con encabezados, valor, barra −5…+5 y botones −/+ que se desactivan en los límites. Las misiones con diario se abren con clic o Enter. Pestañas del panel accesibles y navegables con flechas. Tablas de diarios de reglas, descripciones de objetos y tablas de tirada del módulo en tinta sobre papel (cabecera negra con línea roja, filas alternas, resaltado al pasar el ratón, columna de tirada en rojo); solo afecta a documentos del módulo. Diagnóstico de integración JJK traducido y presentado como tabla Sealed Ink; botones y avisos del marcador de barrera traducidos.

## 1.80.0 — Engine hardening: recuperación de CE, diagnóstico y antidominio
- Identidad de transacción por actor, objeto y actividad; autorización de inicio persistente, confirmación idempotente y recuperación periódica de reservas.
- Reembolso automático limitado a reservas expiradas que nunca recibieron autorización de ejecución; operaciones inciertas quedan en revisión del GM. Asociación de tarjetas Midi-QOL para auditoría, no para repetir flujos.
- JJK Integration Diagnostics: dependencias, versiones, adaptadores, autoridad de expiración y resolución explícita de transacciones pendientes.
- Marcador de barrera seleccionable experimental, creación desde HUD, ataque mediante el sistema de barreras de JJK5e, sincronización de PG y limpieza al cerrar el dominio.
- Simple Domain: PG independientes, absorción y daño sobrante, invalidación al mover el token y protección compartida en perfiles de dominio compatibles; compendio migrado.
- Falling Blossom Emotion: acción defensiva por 5 CE y preparación ofensiva por 4 CE, de un solo uso.
- Domain Amplification: función de comparación de refinamiento frente a Maximum Output.
- Validación: 117/117 pruebas superadas (GitHub Actions 45459063536 y 45459137995); sintaxis, ESLint, revisiones, JSON, auditorías y construcción de compendios. 939 objetos, 1557 actividades, 78 aperturas de dominio.
- Limitaciones: motor transaccional desactivado por defecto; marcador de barrera experimental y no equivalente a pared física ni daño nativo Midi-QOL. Reanudación de actividades, absorción de ataques ordinarios mediante Midi-QOL, contraataque completo de Falling Blossom, neutralización automática de Domain Amplification y aceptación real multicliente pendientes. Consultar docs/design/engine-hardening-roadmap.md.

## 1.76.1 — Auditoría 1.74–1.76
Auditoría de las versiones 1.74.0–1.76.0. Se tradujeron al español los textos que estaban en inglés: aviso de Quick Recovery, aviso de reservas de EM antes de descansar, descripciones de Falling Blossom Emotion, Hollow Wicker Basket y Domain Amplification, opciones del editor de perfil de dominio y estados de respuesta a la reacción. Los 13 diálogos nuevos ahora usan el estilo Sealed Ink. El HUD de dominio y los diálogos de ataque a barrera y perfil personalizado tienen estilos propios. La ventana de reacción de choque de dominios usa la hora del servidor, así que el desfase del reloj de un jugador ya no la cierra antes de tiempo. El jugador que abre un dominio vuelve a ver el HUD automáticamente.

## 1.76.0 — Cursed Energy Transaction Engine (experimental) y compatibilidad Midi-QOL / DAE
- Corrige restricciones de actividades de dominio, apertura repetida, limpieza de reacciones, expiración entre escenas y revalidación espacial.
- Unifica cálculo y pago de CE, validación de escalado y Reduced Output, descuentos de un solo uso, CE fraccionario, ajustes exactos del GM y recuperación.
- Corrige Quick Recovery: reserva propia del Strategist y recuperación mediante consumo nativo verificado.
- Motor transaccional experimental (desactivado por defecto): autoridad del GM activo, reserva persistente, permisos, identificador por operación y resolución manual de transacciones inciertas.
- Adaptador de consumo mediante libWrapper y comprobaciones del flujo Midi-QOL para ataque, daño, salvaciones, utilidad, teleportación y aplicación de efectos; no reutiliza el pago de otra actividad.
- Evita repetir determinadas comprobaciones de Black Flash y acciones posteriores; conserva objetivos aliados de curación.
- DAE V14/Times Up administran expiración cuando corresponda; JJK5e conserva limpieza de ciclo de vida y excluye efectos suprimidos o expirados.
- Diagnóstico de adaptadores, dependencias y transacciones; documentación técnica en docs/design/ce-transaction-engine.md.
- Validación: 110/110 pruebas superadas (GitHub Actions 45455954596), sintaxis, ESLint, revisiones, JSON, auditoría de compendios y construcción de packs. Inventario CE: 939 objetos, 1556 actividades y 78 aperturas de dominio.
- Limitaciones: el modo experimental requiere libWrapper funcional y pruebas reales multicliente con Foundry, Midi-QOL y DAE antes de activarse en producción. Persistencia de flujos tras reconexión, actividades enlazadas, concentración, invocaciones y duraciones especiales pendientes de validación integral. No certifica todos los costes semánticos ni la automatización individual de cada dominio.

## 1.75.0 — Advanced Domain Engine (ampliación incremental)
- Autoridad del GM activo para el ciclo de vida de dominios, regiones, cambios de barrera y respuestas; validación de permisos y cola secuencial.
- Geometría por escena, token y nivel; ataques a barreras con alcance, CA, tirada de daño, lado interior/exterior y deduplicación.
- Ventanas de reacción persistentes por expansión, reclamación exclusiva, resolución agrupada y caducidad.
- Protección por objetivo frente a golpes garantizados: Hollow Wicker Basket selectivo, Falling Blossom Emotion defensivo, Celestial Body y Domain Amplification.
- Domain Amplification: activación, CE, desactivación, reanudación y bloqueo del uso de técnica innata.
- HUD ampliado con estado, duración, participantes visibles, respuestas y actividades del objeto de dominio activo.
- Editor homebrew del GM: formulario, importación/exportación JSON validada, salvación, daño, condiciones, ejecución manual sobre objetivos elegibles y limpieza.
- Inventario estático de 77 entradas de dominio para QA individual.
- 87 pruebas automatizadas superadas en GitHub Actions (run 45451017664, código de esta ampliación).
- Límites: todavía faltan absorción compartida completa de Simple Domain, ofensiva de Falling Blossom, interacciones de Maximum Output, integración de ataques contra barreras con actividades Midi-QOL, ejecución automática individual en iniciativa 20 y pruebas reales de Foundry multijugador. La caducidad de 120 segundos/cambio de turno es una política provisional. No es una certificación de automatización total.

## 1.74.0 — Advanced Domain Engine (fase inicial)
- Sure-hit: exige coordenadas válidas y que el objetivo pertenezca a la escena del dominio.
- Detección de choques según la escena real de la expansión, incluidos actores sintéticos de tokens.
- Identificador por expansión: las reacciones del chat y los avisos se revalidan; se evita la duplicación local y las reacciones asociadas a expansiones anteriores.
- Las decisiones de PNJ se envían solo al GM activo.
- Barrera equilibrada: exige pagar CE antes de activarla y no cobra de nuevo al seleccionar el mismo modo.
- El avance de los choques queda limitado al combate correspondiente y no se repite al actualizar o retroceder una ronda.
- Seis nuevas pruebas de regresión (78 en total en la validación del código de la rama).
- Fase inicial: faltan la autoridad distribuida, el HUD avanzado, las barreras atacables y las interacciones específicas de técnicas antidominio. La validación automatizada no sustituye las pruebas multijugador reales de Foundry.

## 1.73.1 — Revisión de textos de reglas (EN/ES)
- Las 30 reglas opcionales están reescritas en inglés y en español siguiendo el texto del manual. Se añadieron condiciones que faltaban:
  - Recibir el golpe: alcance de movimiento.
  - Choque: el excedente lo recibe el atacante; daño psíquico solo con un rasgo psíquico.
  - Sin técnica: el reparto exacto por nivel.
  - Ventaja acumulada: pruebas de habilidad y la acción Ayudar.
  - Evasión de la ejecución: la criatura debe conocer la Espada del Verdugo.
  - Percepción del alma de objetos: cómo se sube de nivel.
- Mismo vocabulario que el resto del módulo en español: Cortina (no «Velo»), Technique Burnout, Reduced Output, Soul Awareness, Espíritu maldito (vengativo), Creatividad técnica, distancias en pies.
- Nombres de técnicas como en los compendios: Rot, Blood Manipulation, Infinity, Lapse Blue, Reversal Red, Hollow Purple.
- Comprensión de Juggernaut: se quitó «en lugar de 5», que no está en el manual. Maestro de la energía positiva: traducción más fiel.

## 1.73.0 — Choque de dominios como reacción
- Cuando alguien expande su dominio, cada criatura de la escena que tenga Expansión de Dominio y pueda responder recibe la oferta de **expandir el suyo como reacción** e iniciar un choque de dominios, según la regla *Domain Clashes* del manual.
  - Se avisa a los jugadores dueños del personaje. Para los PNJ se avisa al GM.
  - El aviso llega como ventana emergente y también como tarjeta privada en el chat con el botón *Expandir dominio (reacción)*.
- El panel JJK (pestaña Combate) muestra el mismo botón mientras haya un dominio rival abierto en la escena.
- No se ofrece la reacción si el personaje:
  - ya tiene un dominio abierto;
  - está en burnout;
  - no tiene EM suficiente;
  - ya gastó su reacción (si usas Midi-QOL);
  - tiene un dominio letal y el rival es no letal (regla de dominios no letales).
- Al reaccionar se usa la actividad de dominio del personaje: se aplican como siempre el costo de EM, el burnout y el choque por refinamiento. Con Midi-QOL se marca la reacción como usada.
- 1 prueba nueva (72 en total).

## 1.72.1 — Reglas opcionales: desplazamiento
- La ventana de reglas opcionales ahora tiene barra de desplazamiento: la lista de 30 reglas se puede recorrer con la rueda o la barra, y *Guardar* queda siempre visible abajo.

## 1.72.0 — Dotes al subir de nivel y automatización completa con Midi
- **Dotes al subir de nivel**: elegir una dote JJK en la lista de la mejora de característica ya funciona. Antes, al elegirla el formulario del sistema se volvía a dibujar y la lista volvía a «—» antes de pulsar *Tomar dote*. Ahora la dote se toma al elegirla, se comprueban sus requisitos y sale un aviso de confirmación.
- **Automatización completa con Midi (JJK)**: nuevo botón en la pestaña GM del panel, en la ventana de reglas opcionales y en el menú JJK. Configura Midi-QOL para que al usar una técnica se tire el ataque, se compruebe si impacta, se tire el daño al impactar, se tiren las salvaciones de los objetivos (también las de los jugadores) y se apliquen daño y efectos. Antes de cambiar nada muestra la lista de cambios y guarda los valores anteriores; *Deshacer automatización de Midi* los restaura. Solo cambia opciones que existan en tu versión de Midi y que sean del mismo tipo.
- 1 prueba nueva (71 en total).

## 1.71.0 — Pestañas, ficha de creación, compra de puntos y hoja de personaje
- **Pestañas del panel JJK y de Carrera**: vuelven a funcionar. Foundry tiene su propia acción `tab`, que pisaba la del módulo.
- **Ficha de creación de personaje** (botón *Crear personaje* en la hoja, menú JJK o **Alt+W**): una sola ventana con todos los pasos y su estado, en el orden que quieras: características (compra de puntos), clase, técnica innata, característica de EM, raza, trasfondo, dote adicional y barra JJK. Indica el progreso y el siguiente paso.
- **Compra de puntos** (**Alt+P**): botones −/+, columna de modificador, contador grande de puntos libres y botón Reiniciar. Si te pasas del presupuesto, *Aplicar* se desactiva y se explica por qué.
- **Elegir dotes**: en las reglas modernas de dnd5e ya no se oculta el selector propio del sistema (mejora de característica o dote). El selector de dotes JJK muestra solo las que cumples, agrupadas por categoría.
- **Hoja de personaje**: nueva tarjeta JJK con estilo Sealed Ink: EM con barra y −/+, grado, votos, avances, Salida reducida y Burnout, y accesos a Crear personaje, Compra de puntos, Técnica, Subir nivel, Descanso de EM y Barra JJK.
- **Atajos nuevos**: Alt+P (compra de puntos), Alt+W (ficha de creación), Alt+E (subir de nivel) y Alt+O (reglas opcionales, GM).

## 1.70.0 — Claves de efecto al día y más dotes automatizadas
- Claves de efecto: en dnd5e 6.x, los efectos nuevos o editados se guardan con las claves actuales del sistema (velocidades, sentidos, bonos de tiradas, bonos de característica y habilidad). Para traducirlas se usa la propia tabla de compatibilidad de dnd5e. En dnd5e 5.3 no cambia nada, así que sigue siendo compatible.
- 6 dotes manuales pasan a automatizadas o parciales:
  - *Judicial Amputation* tira en la tabla de extremidades para el objetivo.
  - *Blackened Blood* aplica +1 de agotamiento.
  - *Subtle Constructs* tiene prueba de Juego de manos y ventaja en el primer uso.
  - *Cursed Tactician* y *Flash Regress* gastan EM escalable.
  - *Spatial Skirmishing* tiene un ataque desarmado con modificador de EM.
- 1 prueba nueva (70 en total).

## 1.69.1 — Corrección de 21 errores de la auditoría
- Six Eyes (Dormida / Despertando): *Perfect CE Manipulation* vuelve a aplicar el descuento de CE ÷10.
- Percepción del alma y Daño al alma ya no se pisan: cada una tiene su propio efecto. Los efectos que ya tenías se separan solos.
- Cancelar *Fijar CE* o *Dinero* ya no deja el valor en 0.
- Reglas opcionales:
  - Recibir el golpe, Choque y Salvación crítica se usan una sola vez, en el cliente que aplica el daño.
  - Las salvaciones de concentración y de muerte ya no cuentan como Salvación crítica.
  - Mejora con dote solo da dote por las mejoras de característica de clase.
- Invocaciones: una petición de jugador ya no puede darle la propiedad de un personaje ni de un actor ajeno. El GM ve qué criatura se pide.
- Choque de dominios contra un PNJ: ahora lo resuelve el GM, así que funciona también cuando el dominio lo abre un jugador.
- Totalidad: también detecta y bloquea los shikigami invocados con la actividad de dnd5e.
- Black Flash: el ×3 se aplica también cuando el crítico se elige en el diálogo de daño (igual con Críticos contundentes), y ya no se pisa con Agotamiento de salida.
- Disparo dirigido:
  - ya no se gasta si se cancela el ataque;
  - solo afecta a los objetivos elegidos;
  - funciona sin Midi.
- Pruebas duras: al quitarlas ya no quedan PG de más.
- Texto de votos y del creador de técnicas: ahora se escapa (sin HTML inyectado). El creador de técnicas respeta un costo 0 de dominio.
- Animaciones y escrituras ya no se repiten en cada cliente.
- 5 pruebas nuevas (69 en total).

## 1.69.0 — Auditoría: traducción, automatización y aspecto
- 17 avisos y diálogos que salían siempre en inglés ahora están traducidos (votos, clon, intercambio de tokens, dados de golpe, Salida máxima, petición al GM, cambio de técnica).
- 15 dotes que no tenían nada automatizado ahora lo están, total o parcialmente: Observer, Cutting Edge, Dull Pain, Long Lasting Medicine, Spiderweb, Perfect Ritual, Maximum: Sakuga, Slasher, Crusher, Tool Versatility, Blessing of Resilience, Resilient, Reverse Cursed Technique Output, Flow Technique y Boogie Down.
- Otras 24 dotes y rasgos que dependen del juicio del GM quedan marcados como *manual*, con instrucciones.
- La hoja de cada objeto JJK muestra si está automatizado, en parte o es manual. Al usar un rasgo parcial o manual llega al usuario un recordatorio privado de lo que debe aplicar a mano.
- Ventana de reglas opcionales: el control queda a la derecha de cada regla y el desplegable ya no se sale.
- Percepción del alma de objetos usa ahora la misma maquetación que Percepción del alma.

## 1.68.1 — Revisión de las reglas opcionales
- Previsualizar el daño (bandeja de daño del chat o tarjeta de Midi) ya no gasta Recibir el golpe, Choque ni Salvación crítica. Ahora se gastan solo cuando el daño se aplica de verdad, y el aviso sale una vez.
- Salvaciones críticas: las salvaciones de concentración ya no cuentan. El 1 o el 20 natural también funciona cuando el GM aplica el daño desde otro cliente.
- Ventaja acumulada: ahora suma también las fuentes de JJK cuando hay Midi-QOL, y no da bonificador si el ataque además tiene desventaja.
- Flanquear: si Midi-QOL ya tiene su propio Flanquear activo, el de JJK no se aplica (para que no cuente dos veces), y se avisa al guardar.
- Despertar de la TMI: el jugador solo tira cuando el GM lo permite (tarjeta de casi muerte → *Permitir la tirada d100*). El GM puede tirar u otorgarla siempre. Los botones no aparecen para Restricción Celestial.
- Sin técnica / Mejora con dote: elegir una dote ya no reabre la pregunta de subida de nivel.
- Maldito al morir: solo las dotes cuentan para los Puntos Profanos (no los rasgos de clase) y se quitan los rasgos que daba la raza anterior.
- Menos sangre: funciona aunque la actividad no tenga actor directo.

## 1.68.0 — Reglas opcionales del manual, despertar de la TMI y comprensiones de clase
- **Reglas opcionales**: nueva ventana *Reglas opcionales* (Ajustes del módulo, menú JJK o pestaña GM). Las 30 reglas del manual están desactivadas por defecto y se activan una a una. Las activas se automatizan: Alternativa a la Totalidad, Menos sangre, Conversión de sangre, Precisión de la Bestia Mítica, Ventaja acumulada, Críticos contundentes, Salvaciones críticas, Disparo dirigido, Luchar por tu vida, Recibir el golpe, Choque, Flanquear, Sin técnica, Habilidades repetidas, Mejora con dote, Barrera pura, Evasión de la ejecución, Pruebas de alma, Agotamiento de salida, Afinidad aumentada, Dependencia de los Seis Ojos, PG aumentados, Pruebas duras, Acciones adicionales (Distraer, Romper objeto, Golpe de gracia, Carga), Formas de ganar dinero, Progresión anual, Encontrar un espíritu maldito, Maldito al morir y Percepción del alma de objetos.
- **Despertar de la TMI**: si la tirada d100 saca 90 o más, se añaden los rasgos de Técnica Maldita Inversa y +1 avance. Cuando un personaje pasa de PG máximos a 0 de un golpe, o saca un 20 natural tras dos salvaciones de muerte falladas, el GM recibe una tarjeta para otorgarla o pedir la tirada. Nuevos botones *Tirar por la TMI* y *Otorgar TMI*.
- **Comprensiones específicas de clase**: 6 rasgos nuevos, uno por clase, automatizados. Requieren 2 avances y solo se puede tener una. Cada clase los muestra en su descripción.
- Totalidad: un shikigami muerto ya no se puede volver a invocar. Con la regla alternativa vuelve tras un descanso largo.
- 15 pruebas nuevas (64 en total).

## 1.67.0 — Tema visual Sealed Ink (estilo Jujutsu Kaisen)
- Nuevo tema *Sealed Ink* inspirado en la serie: tinta sumi, papel de talismán, un único rojo de sello y energía maldita en violeta; dorado solo para el GM. El marco de las ventanas de Foundry no se toca: solo cambia el contenido.
- Cabecera con sello 呪 y nombre en tipografía condensada (Big Shoulders, OFL, incluida en el módulo); marca de agua 呪 muy tenue.
- Pestañas como tiras de talismán: la activa es papel con banda roja; la del GM, dorada.
- Medidor de CE con número grande y barra con marcas cada 10 %; se vuelve roja con 25 % o menos.
- Estados como etiquetas de papel con banda de color (rojo peligro, dorado Zone/Black Flash, violeta energía).
- Extremidades con banda lateral naranja (rota) o roja tachada (perdida); botones OK/Rota/Perdida como control segmentado.
- El panel se adapta al ancho de la ventana (pestañas y gasto rápido compactos en ventanas estrechas).
- Guía de diseño en `docs/design/`.

## 1.66.0 — Rediseño visual de la interfaz
- Nuevo tema visual *cursed ink* para el panel JJK, el menú, los votos, la carrera, el HUD de dominio, el creador de técnicas y la ayuda de atajos: fondo oscuro, energía maldita en violeta, rojo para lo peligroso y dorado para el GM y la Zone.
- Medidor de CE grande: valor, máximo y porcentaje; se pone rojo con 25 % o menos.
- Pestañas como control segmentado; botones con estados de foco, pulsado y desactivado consistentes.
- Estados con color según su tipo: Burnout y daño al alma en rojo; Zone y Black Flash en dorado; extremidades rotas en naranja y perdidas en rojo (también en la vista del jugador).
- Pestaña GM reordenada: valores, breakthroughs con contador y efectos a terminar.
- Textos de botones más cortos (Gastar / Recuperar).

## 1.65.0 — Vista de jugador y vista de GM
- **Panel según el rol**: el jugador ve su personaje y lo que puede usar; los ajustes manuales (terminar Burnout, Zone o Black Flash, subir o bajar Reduced Output y Soul Awareness, marcar extremidades, aplicar o quitar daño al alma) quedan solo para el GM. Etiqueta *Jugador* o *GM* en la cabecera.
- **Pestaña GM** (solo la ve el GM): fijar CE, refinamiento de dominio, breakthroughs, daño al alma, terminar efectos, cerrar dominio y actualizar la automatización de todos los actores. Atajo 5.
- Las acciones del GM se rechazan aunque un jugador intente llamarlas.
- **Mensajes de CE privados** (ajuste de mundo, activo por defecto): las líneas de CE gastado o recuperado solo las ven los dueños del personaje y el GM.
- **HUD de dominio ajeno**: un jugador que mira el dominio de otro solo ve el porcentaje de la barrera, sin PG, CA ni refinamiento exactos. Editar el refinamiento es solo del GM.
- Votos y carrera solo se abren para personajes propios.

## 1.64.0 — Panel JJK más rápido, con pestañas y atajos
- **Panel JJK rediseñado** en 4 pestañas: Combate, Cuerpo, Invocaciones y Herramientas. La pestaña Combate muestra un contador de estados activos (dominio, Burnout, Zone, Black Flash, daño al alma, Reduced Output).
- **Gasto rápido de CE**: −5, −1, +1 y +5, más un campo de cantidad con Gastar y Recuperar directos, sin ventana emergente. La barra se pone roja con 25 % o menos.
- **Atajos dentro del panel**: − y + (1 CE), Shift + − y + (5 CE), M Maximum Output, R descanso corto, N emoción negativa, L extremidad, 1–4 pestañas y ? ayuda.
- **Atajos globales nuevos**: Alt+R descanso corto, Alt+X Maximum Output, Alt+N emoción negativa, Alt+L extremidad, Alt+I creador de técnicas, Alt+U actualizar automatización y Alt+/ ayuda. Todos se pueden cambiar en *Configurar controles*.
- Todos los botones tienen descripción emergente con su atajo. El panel ignora clics repetidos mientras una acción está en curso, para evitar gastos dobles.
- Los errores ahora se muestran con un mensaje claro de qué acción falló.
- Corregido: invocar o descartar sin una escena abierta daba error; ahora avisa. También se corrigieron la tirada de extremidad de respaldo y los textos en inglés del HUD de dominio.
- Pruebas nuevas: cada botón del panel, del menú, de los votos, de la carrera y del HUD de dominio, y cada atajo, se ejecutan en la CI (48 pruebas).

## 1.63.0 — Soul Damage, creador de técnicas, tablas y efectos pasivos
- **Soul Damage**: reduce los PG máximos (no lo cura RCT ni la regeneración). Automático con Midi-QOL para Transfiguration, Soul Split Katana, Maximum: Instrumentalization, Heat Dissociation, Soulfire y Maximum: Soul Punch; termina en descanso largo salvo que la fuente diga lo contrario. Botón de GM en el panel y tarjeta para el GM cuando el objetivo no es del jugador.
- **Creador de técnicas propias** (macro *JJK: Technique Builder* y botón en el panel), según las pautas del manual: nivel 1 Lapse, 3 Lapse/Extension, 6 Extension, 11 Maximum, 18 Domain Expansion (opción de dominio a nivel 3). Crea los objetos en la carpeta *JJK: Custom Techniques* y se eligen como cualquier técnica.
- **Tablas nuevas**: Finding a Cursed Spirit, Mission Rewards, Employment Pay, Cursed Tool Sale Value, Average Cursed Energy y Cursed Upon Death.
- **Efectos pasivos**: Evasion, Resistant, Celestial Body (inmune al sure-hit), Sorcerous Restoration, Superhuman Might; razas: Skills, Warrior Training, Savage Attacks, Refined Study, Life Experience, Tool Proficiency, Tailored Appearance; feats: Curse Resistance, Cursed Armor, Multiple Eyes, Focused Attacks, Flight, Alternate Movement, Size Increase, Powerful Build, Survivor, Bottomless/Unending/Immense Cursed Energy, Blessed by Black Sparks, Pact Maker; Chosen by the Sparks (todo crítico es Black Flash).
- **Herramientas malditas**: Prayer Beads (Amplify Technique), Clockwork Amulet, Cursed Tattoo (CA por grado), Crystal Bracelet (3 usos). Nuevos objetos separados: Mind Sharpener Ring y Cursed Shot Ammunition (estaban dentro de otras descripciones).
- 7 pruebas nuevas (45 en total).

## 1.62.0 — Multiclase V.6
- Requisitos de multiclase: 13 en la característica de la clase actual y de la nueva (Warrior FUE, Scout DES, Juggernaut CON, Strategist INT, Support Specialist SAB, Shikigami User CAR). Aviso al añadir la clase; con *prerrequisitos estrictos* se bloquea para jugadores.
- Heavenly Restriction (Pure Body) no puede hacer multiclase.
- Cursed Energy: una sola reserva, la de la clase de mayor nivel, escalada con el nivel total del personaje (antes cada clase añadía su propia reserva con su propio nivel).
- Innate Technique, Cursed Strike, Cursesight, Unarmored Defense y Extra Attack no se duplican al subir en otra clase.
- 2 pruebas de ejecución nuevas (39 en total).

## 1.61.0 — Reglas del manual: Awakened Understanding, Cursed Physiology, dominios
- Awakened Understanding: Skilled añade Cursed Strike 1d8 y Cursed Reinforcement como PG temporales; Advanced: Reinforcement hasta mod CE + competencia como acción, acción adicional o reacción; Mastered: Cursed Strike 2d8 por CE y +CE al ataque.
- Efficiency (Advanced −1, Mastered −2): el coste base de las técnicas innatas baja automáticamente (mínimo 1).
- Cursed Physiology: Darkvision (60 ft, 120 ft a nivel 8), Increased Speed (+5/+10 ft), Ability Improvement, Horrifying Form, Ambush Predator y Curse Weapon (1d6/1d8/1d10) automatizados.
- Cursed Energy Affinity cura 5 PG por CE. Nuevo feat opcional Increased Affinity (10 PG por CE, acción adicional o reacción).
- Incomplete Domain: abre un dominio de 100 ft sin barrera ni sure-hit, con ventaja en ataques de técnica; Burnout de 5 rondas.
- Barrierless Domain (refinamiento 1000 + breakthrough): sin barrera ni límite de tiempo, 655 ft; recibir 1/3 de los PG máximos de un golpe pide salvación de CON (CD 15 + la mitad del daño).
- Burnout Recovery (RCT + refinamiento 750): botón en el panel; 4 CE y salvación de CON CD 5 (+5 por éxito, se reinicia en descanso largo); al fallar 8d6 psíquico.
- 4 pruebas de ejecución nuevas (37 en total).

## 1.60.0 — Pruebas de ejecución de reglas y dominios
- Nuevo banco de pruebas: `tests/harness/foundry-mock.mjs` ejecuta `scripts/jjk5e.js` sobre un Foundry simulado en memoria; `tests/runtime.test.mjs` (20 pruebas) cubre Black Flash, The Zone, dominios, choques, barrera, CE, RCT, Maximum/Reduced Output, descanso corto y bloqueos de uso. Corre en la CI.
- The Zone: +1 al rango de crítico sobre el rango propio del personaje (Improved Critical 19 → 18), antes se fijaba en 19 sin importar el rango previo.
- Anti-Domain Clash: un dominio no letal se destruye al instante contra un dominio con más refinamiento (y viceversa).

## 1.59.0 — Actualizador de automatización e infraestructura
Mejoras tomadas de módulos de referencia (Cauldron of Plentiful Resources, Gambit's Premades, Automated Conditions 5e):
- **Actualizador de automatización**: los objetos JJK que ya están en los personajes se pueden actualizar a la versión del compendio. Botón ⟳ en el panel JJK, menú *Actualizar automatización* en los ajustes y aviso al GM tras cada actualización del módulo. Conserva usos gastados, cantidad, equipado, elecciones de avance, shikigami personales y la habilidad de CE.
- Cada objeto del compendio lleva `flags.jjk5e.rev` (hash de su automatización); `tools/stamp-rev.py` lo genera y la CI lo verifica.
- Peticiones de jugador al GM con `CONFIG.queries` (Foundry 13+): el jugador recibe la respuesta y un aviso si el GM la rechaza. El socket queda como respaldo.
- API: `updateAutomation(actor)`, `updateAllAutomation()`, `outdatedItems(actor)`.
- Desarrollo: `hotReload` para estilos e idiomas, `eslint.config.mjs` en el repo y lint en la CI.

## 1.58.0 — Revisión de feats
- Auditados los 317 feats del manual contra su automatización; corregidos 49.
- Variantes de activación que faltaban: Hollow Wicker Basket (acción/reacción), Simple Domain (acción), Supernova (acción), Curse Restoration (acción/reacción), Minimum: Uzumaki (acción), Incarnation, Perfect Sphere (mover/embestir).
- Simple Domain: los PG de la barrera se aplican como PG temporales (prof × 2 × mod CE).
- Curaciones por CE: Curse Restoration y Soul Alteration (5 PG por CE), Healer (1d6 + 4), Chef (+1d8).
- Daño por nivel: Additional Formulae, Drill Claws, Adorable Poison Jar, Destructive Gaze, Chainsaw Dismantle.
- Hydrokinesis: ataque de CE 2d10 frío + 2d6 perforante; al impactar, salvación de CON o derribado y daño otra vez.
- Hands of Madness: ataques de Mano Derecha (1d12 psíquico) y Mano Izquierda (1d6 + miedo).
- Maximum: Clock Hand: invocación, ataque 1d10, Hour Hand +3d8 y Minute Hand (congelado).
- Nuevas reacciones con efecto: Blood Crystallization (+5 CA y resistencias), Gradient, Celestial Raiment, Destined One.
- Refined Domain: efectos por beneficio; Cost Reduction reduce a la mitad el coste de técnicas con el dominio abierto.
- Free Spirit: 1/día recupera CE igual a tu nivel. Repelling Forces: máximo 3 CE.
- Notas de automatización en feats puramente descriptivos.

## 1.57.0 — Reglas de refinamiento de dominio
- Revisadas las reglas de *Intricacies of Sorcery* frente al código: Black Flash, The Zone, RCT, recuperación de CE, Maximum/Reduced Output, Binding Vows, Limb Damage, Soul Awareness y choques de dominio.
- Domain Refinement 500/1000: el dominio dura 2/3 minutos (antes siempre 1).
- Refinement 700: coste −mod CE y Technique Burnout da 1 nivel de agotamiento (antes 2). Refinement 1000: coste −bono de competencia.
- Refinement 800 (Durable Barrier): el refinamiento cuenta doble en los PG de la barrera.
- RCT (Healing Pool): nueva actividad de reacción al recibir daño (1/ronda).

## 1.56.0 — Armas del manual
- Revisadas las 43 armas de la tabla del manual: todas presentes con daño, tipo, precio y propiedades correctos.
- Spear: ahora arrojadiza (20/60) además de alcance.
- Claws of Calamity: daño base 1d12 contundente, cortante o perforante (antes 1d6 + actividad aparte).
- Weighted Chain, Chain of 1000 Miles y Chains of Heaven: al impactar aplican Restrained (libera CD 14 FUE).
- Lance: desventaja automática contra objetivos a 5 ft o menos.
- Rifle, Handgun y Revolver: munición de recarga (30/15/6) como usos del arma y acción Reload.
- Defensive (Tonfa, War Fan, Gauntlets): solo un arma equipada da +1 CA.
- Festering Life Sword: la salvación de CON se lanza sola al impactar (Midi-QOL).
- Armas con propiedad Fist marcadas (flags.jjk5e.fist).
- Nuevo objeto Energy Tag (Explorer's Pack): romperlo devuelve 3 CE.
- Corregido aviso de lint de Token Magic FX.

## 1.55.0 — Reversals
- Verificados los 78 reversals de *CT Reversals*: todos presentes en el compendio de técnicas, con texto completo y automatización.
- Entropy (Reversal) de Vairocana ahora requiere nivel 6 para añadirse automáticamente.

## 1.54.1 — Compatibilidad con Foundry 14.368
- **Foundry 14.368**: el módulo ahora se puede activar desde 14.368 (antes exigía 14.369).
- En 14.368 hay que usar **dnd5e 5.3.x + Midi-QOL 14.0.20 + DAE 14.0.22** (las versiones del navegador de paquetes): todas las versiones de Midi para dnd5e 6.0.6+ piden Foundry 14.369, y dnd5e 6.0.0–6.0.5 eran pre-lanzamientos.
- Requisitos del manifiesto: dnd5e ≥ 5.3.0 (verificado 6.1.1), Midi-QOL ≥ 14.0.19 (verificado 14.7.1), DAE ≥ 14.0.19 (verificado 14.6.10). Se quitaron los enlaces de manifiesto forzados a la rama dnd6, que en 14.368 instalaban una versión incompatible.
- Comprobado contra el código de dnd5e 5.3.3: todos los hooks y campos que usa el módulo existen (preActivityConsumption, postUseActivity, preUseActivity, rollAttack, preCalculateDamage, advancementManagerComplete, restCompleted, ajuste allowSummoning, CA mínima, umbrales de crítico). Las claves `flags.midi-qol.*` de los compendios son las nativas de Midi 14.0.
- README con la tabla Foundry / dnd5e / Midi / DAE.
- Sin probar en Foundry real.

## 1.54.0 — Revisión técnica por técnica contra el manual
Revisé las 81 técnicas rasgo por rasgo contra el manual (salvaciones, tipos de daño, condiciones, áreas, alcances, acción/acción adicional/reacción, ataques, CE y dados). Corregido:
- **Antigravity**: faltaba Disorienting Gravity (CON: desventaja en ataques, sin concentración) y Nauseating Gravity (aturdido hasta el final de su siguiente turno).
- **Blood Manipulation**: Crimson Rain con Convergence derriba.
- **Comedian**: Powerful Punchline ahora tiene sus tres formas (esfera de 30 pies a 80, línea de 60, cono de 30); Comedic Foil tenía la salvación de EM sin automatizar (aura por turno).
- **Cursed Speech**: cono de 35 pies (+3 CE) a 11.º.
- **Esoteric Art**: Impasto Canvas solo tenía una trampa; ahora Pit (2d6 + derribo), Spike (2d10 perforante + derribo), Snare (apresado con escape) y Boulder (línea de 30, 4d10 + derribo).
- **Faceless God**: salvación de SAB para reducir la corrupción sin línea de visión.
- **G Warstaff**: la previsión también como reacción.
- **Idle Transfiguration**: Wings costaba 2 CE y daba vuelo = andar; el manual dice 4 CE y 60 pies. Añadidas Horse Hooves, Spiked Skin (reacción, 4× comp. perforante) y Size Change (agrandar/reducir).
- **Paralyzing Gaze**: mantener es acción adicional.
- **Straw Doll**: Hair Pin detona también por reacción.
- **Technique Extermination**: el ataque de 6 CE de Jacob’s Ladder no hace daño, destruye objetos/barreras a 30 pies; añadida la versión con Maximum Output (círculo de 30).
- **Ten Shadows**: Divine Dogs aparecen a 10 pies (no 30); el dominio permite cambiar de sitio con un clon de sombra por reacción.
- **Tool Manipulation**: reacción para dar ventaja con tu herramienta imbuida.
- **Vengeful Spirit**: tirada de Persuasión CD 20 para calmar al espíritu.
- Herramienta: elimina referencias de efecto duplicadas.
- Sin probar en Foundry real.

## 1.53.1 — Compatibilidad con los módulos que usa JJK 5e
- **Midi-QOL / DAE**: el navegador de paquetes de Foundry solo ofrece midi 14.0.x y DAE 14.0.x, que **no funcionan con dnd5e 6**. El manifiesto ahora enlaza las versiones para dnd5e 6 (`latest-dnd6`), y el README explica cuál usar: dnd5e 6.1 → Midi 14.7.0 + DAE 14.6.10; dnd5e 6.0 → Midi 14.6.x. Mínimos: Midi 14.6.5, DAE 14.6.4.
- **Foundry/dnd5e**: mínimo real Foundry 14.369 y dnd5e 6.0.6 (lo que exige Midi para dnd5e 6); antes decía Foundry 13 y dnd5e 5.3, que no pueden cargar las dependencias obligatorias.
- **Midi 14.7 (tokens como TokenDocument)**: la ventaja de Twice the Fun ya no depende de `MidiQOL.computeDistance` (mide con la cuadrícula si no existe) y las animaciones convierten documentos en tokens.
- **FXMaster 8**: el tinte de dominio se quitaba con un id que FXMaster no reconoce; ahora se guarda el id que devuelve `play()` y se detiene con `filters.stop()`.
- Versiones verificadas en el manifiesto: Sequencer 4.3.0, JB2A 0.9.4, Automated Animations 8.0.7, Token Magic FX 0.8.4, FXMaster 8.4.2, Dice So Nice 6.4.5, Visual Active Effects 14.0.3, Bar Brawl 1.9.4, Token Action HUD D&D 5e 2.2.0.
- Times Up no existe para Foundry 14; el módulo no lo necesita.
- Las claves `flags.midi-qol.fail/max.*` siguen funcionando: DAE 14.6.3+ las migra a los campos de tirada de dnd5e.

## 1.53.0 — Análisis profundo: manual V.6 vs módulo
Comparé el manual (V.6 + Creeps & Curses) con todos los compendios y revisé el código con ESLint.

- **Cobertura**: las 79 técnicas del manual (+ Vairocana y ████ and Light de C&C) y sus rasgos están en el módulo; los 317 dotes del manual existen; textos de técnicas y dotes coinciden ≥85–90 % con el manual. Clases: dados de golpe, salvaciones, ASI y nivel de cada rasgo coinciden con las tablas. Armas: daño, tipo, propiedades y precio ($100 = 1 po) correctos; armaduras: CA, DES máx. y desventaja en Sigilo correctas.
- **Dotes de técnica arreglados (43)**: salvaciones sin resultado (Aerokinesis, Air Bomber, Black Belt, Fox Fire, Funny Faces, Imbued Weapon, Improved Bindings, Black Hole, Hurricane, World Cutting Slash, Nail Volley, Shooting Star, Veil, Weapon Breaker, Weight of Judgment, Surprise Present, Shield Master…), ataques sin daño (Cadence, Block Strike, Elbow Blades, Minimum: Uzumaki, Sword of Michael, Spatial Shatter, Polearm Master, Charger, Sentinel, GWM con −5/+10…) y costes de CE del manual que faltaban (Flowing Red Scale: Stack 6/3, Crippling Neurotoxin +8, Immobilized Limbs +1, Tyrant Shikigami 1/2/4, Crippling Strikes +1, Blessing of Fortune 1, Maculation, Typhoon +2).
- **Pure Energy Efficiency**: ahora también se aplica a quien recibe tu Circuit (antes solo al lanzador).
- Equipo y rasgos de clase entran en la revisión automática: Comprehensive Monocle, Poison Jar, Cursed Tanto, Chains of Heaven, Fighting Style y Technique Creativity corregidos.
- `tools/technique-fixes.py` ya no reescribe campos vacíos ni cambia el fin de línea de los archivos.
- ESLint (no-undef y errores comunes): sin errores en el código.
- Sin probar en Foundry real.

## 1.52.1 — Revisión de errores de la automatización
- **@scaling corregido**: en dnd5e vale 1 + CE extra. Arreglados Dismantle (daba 1 dado de más), Cleave (1 dado de más), Ratio (1d10 de más antes de 11.º), tiradas de Idle Death Gamble/Luckiest y nivel de Chaos Bolt (ahora 1.º/3.º/5.º/8.º).
- **Efectos con CE escalable** (Virtual Mass, Earthen Armor, Epic Solo, Ritual Dance, Divebomb, Evening Moon, Mass Decrease, Store and Release): los efectos no pueden leer @scaling; ahora usan `JJKSCALING`, que el módulo sustituye por el escalado del último uso del objeto.
- **Salvaciones de EM en OverTime**: `saveAbility=wis|cha` no es válido en Midi; ahora `JJKCESAVE` usa la mejor salvación (SAB/CAR) del objetivo. También `JJKBEST_a_b` (Shadow Manipulation: FUE/DES).
- **Claves inválidas**: `system.traits.dm.amount.all` → `flags.midi-qol.DR.all` (Ley Line, Inverse Ratio, Amber, dominio de Dragon Vein); `critical.range` → umbral de crítico de dnd5e (Crescendo, DDR); quitadas `max.attack` (Five Clawed Dragon) e inmunidad a «healing» (Reverse Scale); Y-Axis Block usa `fail.attack.all` sobre el atacante.
- **@mod** en daños/curaciones sin ataque (Zero Hour, Merciful Shadow, etc.) → mejor de FUE/DES.
- Escalado por conteo (estrellas, cargas, pies, espíritus) habilitado sin coste de CE en 17 actividades; no se habilitó en las que escalarían gratis.
- Los marcadores `JJK…` solo se resuelven en efectos aplicados a actores (no se pierden en la plantilla del objeto).
- Nuevo `tools/validate-packs.py` en CI: tipos de actividad/daño/curación, plantillas, efectos referenciados, fórmulas, claves Midi y disparadores.
- Sin probar en Foundry real.

## 1.52.0 — Técnica por técnica: últimas 12 — 360/360
- **Star Rage**: Virtual Mass Increase (CE = masa, +1 daño por masa, impacto con derribo), mejoras, Mass Decrease, dominio Event Horizon (velocidad ¼, derribo con salvación).
- **Starlight Symphony**: Cursed Fog y Dark Fog (desventaja en Percepción/Investigación), reacción de niebla, zorros, Living Fog (vuelo, resistencias, asfixia Xd8), Inari, dominio con ceguera y 5d10.
- **Straw Doll Technique**: Nail Projectile (2 clavos), Resonance con tabla de 3 partes (desventaja, sin reacciones, aturdido), Hair Pin, Improved Resonance y dominio (Xd12), Cursed Doll Transformation.
- **Technique Extermination**: Extinguishment (2d12→5d12, sin CE con salvación por turno), Angel’s Blessing, Jacob’s Ladder (10d12), Garden of Eden, Technique Ignition.
- **Teleportation**: marcas como usos (2× mod. EM), teleporte con alcance escalable y por reacción, Mastered Teleport, dominio, Grounding.
- **Ten Shadows**: Shadow Storage y prisión de sombra, Light Manipulation (ceguera, Light Ridge, Summon Dispelling), dominio Chimera Shadow Garden, Well’s Unknown Abyss. Las invocaciones de shikigami no se tocaron.
- **Tool Manipulation**: imbuir herramienta (+2 ataque), Floating Tool, guardia de herramienta, Wind Scythe (3d10→6d10), dominio (armas ajenas fallan), Creature Manipulation.
- **Triple Core**: Unblockable Blows, Energy Blast (2d6/CE), Defensive Form y Offensive Form (según CE actual, recurso terciario), Divebomb, mejoras, Core Exhaustion, Core Reversal.
- **Vairocana**, **Vengeful Spirit Manipulation**, **Voracity**, **████ and Light**: Chaos Bolt escalable y tabla d100; garras del espíritu y Mimicry; devorar/regurgitar con efecto editable, Body of the Devourer, Indigestion; Light Constructs, Rain of Light (3d10→10d10), ████ of Dawn, Light Beam, Light Speed, dominio y reversiones oscuras.
- Repaso final: 19 salvaciones/ataques sin efecto ahora tienen efecto descriptivo o daño del arma.
- **Automatizados a mano: 360/360.** Sin probar en Foundry real.

## 1.51.0 — Técnica por técnica: Retrograde → Star Dictator (10)
- **Retrograde**: Reversion (+2→+5) por reacción y sobre otros, Regression con bloqueo, usos sin reacción por ronda, Invert Causality, dominio, Prograde (Certain Defeat/Victory).
- **Rockstar**: Sound Blast (2d10→6d10) con empuje automático; ráfagas extra; Resonating Music en cono; Epic Solo (+2d10 trueno, aura); dominio; Smooth Jazz.
- **Rot**: Rotten Blood (resistencias, +1d8→4d8); 8 técnicas de sangre con coste de CE y PG automático + Blood Shield; Decay con OverTime; Scarlet Rot (inmunidades, envenenado); Wing King; dominio; Lifeblood.
- **Schrift X**: Piercing Schrift (ignorar cobertura, mod. EM a distancia), X-Axis Shot (2d6→7d6), Critical/Multi-Mark, Intangibility, dominio, Schrift Y, Y-Axis Block.
- **Seance**: Seance con PG temp y salvación de alma, Blessing, ritual, Black Seance, dominio, Possession.
- **Shadow Killer**: Shadow Strike (×1→×4 mod. EM), Dark Binding (apresado), Void Steps (Pass Without Trace, invisible), Shadows of Mortality, dominio, Merciful Shadow, Shadow Release.
- **Shrine**: Dismantle (dados base 1→4 + 1d12/CE, 120/250 pies), Cleave (comp. + CE en d10) con adaptación, Divine Flame Open, dominio con Dismantle y Cleave máximos, Assemble.
- **Sky Manipulation**: Sky Shape (+4 CA) con redirección, Sky Armor (CA 11 + EM + comp., vuelo), Thin Ice Breaker, Heaven's Gate, Sky Destruction.
- **Solo Forbidden Zone**: Forbidden Zone (ventaja a aliados), Bless, Ritual Dance (+5 daño/CE), Maximize Output (daño máximo), Hallowed Zone, Depletion Zone.
- **Star Dictator**: estrellas menores, pseudodominio escalable (d6→d10), estrella mayor, dominio, Star Guardian.
- Automatizados a mano: 285/360. Sin probar en Foundry real.

## 1.50.0 — Técnica por técnica: Pain Killer → Regalia (7)
- **Pain Killer**: PG temp (mod. EM + nivel), versión en área, Medicina competente/pericia, Analgesic (mitad del daño por reacción), dominio, Killer Pain y Pain Maker.
- **Paralyzing Gaze**: Immobilizing Eyes (mitad de velocidad, −mod. EM a CA y ataques) con mantenimiento y PG de ojos como usos; Peripheral Vision; Reactive Eye Movement; paralizar con salvación de FUE por turno; dominio; Energizing Gaze.
- **Prayer Song**: Prayer por turnos (1–5) con beneficios acumulados; Marcado; Caesura; Crescendo (turnos 1, 3, 9); dominio con los 10 turnos; Sad Song.
- **Projection Sorcery**: Projection (+10 pies, mantenimiento), Acceleration acumulable y carga, 24 Frame Rule (aturdido, el siguiente golpe es crítico), Fastest Sorcerer, dominio 8d10, Replay Sorcery.
- **Puppet Manipulation**: imbuir y 3 niveles de marioneta, Energy Cannon/Volley con recarga 5–6, Deflect Missiles, dominio, Severed Strings.
- **Ratio**: +1 rango de crítico, tirada de Ratio (3 o 7 = crítico, escalable a 11.º), Collapse, dominio de críticos, Inverse Ratio.
- **Regalia**: manifestar con +1→+4, necrótico al impactar (1d8→6d8), Cursed Wave, reserva de PG de Divine Protection como usos, Soul Bound Treasure, dominio 8d10, Riches to Rags.
- Automatizados a mano: 239/360. Sin probar en Foundry real.

## 1.49.0 — Técnica por técnica: Love Rendezvous → Pachinko Fever (7)
- **Love Rendezvous**: marcas de las 5 estrellas (1 CE) como efectos, colisión escalable, dominio, Hate Separation.
- **Miracle**: Miracles y Calamity Marks como usos del objeto (máx. 6); Blind Luck (reducción como PG temp), Miraculous Outcome (d6→d10), Deadly Miracle (ventaja en salvaciones de muerte), dominio con coste 2d20.
- **Missile Fist**: puño a distancia que escala en alcance (20→90 pies) y dado (1d8→4d8); puños extra; agarrar/apresar con salvación de FUE; Unrelenting Fury; Brutal Bombardment con salpicadura; dominio 8d8 + derribo; Leg Aegis (10 PG temp por CE).
- **Moon Dregs**: invocación (gratis 1/descanso), veneno al impactar (2d6→6d10, sin crítico), Noxious Poison con agotamiento, dominio 8d6, Sun Dregs y +4d6 radiante.
- **Mythical Beast Amber**: Electric Energy (1d10→6d10), +mod. EM a iniciativa, cargas y descarga (1d12 por carga), Release con 5 etapas (FUE/DES/CON, velocidad, inmunidad, reducción, visión verdadera) y desactivación con CD 10–30 y agotamiento, Loud Blast, Cursed Beam, dominio.
- **New Shadow Style**: Simple Domain con usos = comp., Batto contra varios objetivos, intercepción de Evening Moon, Moonlight Veil (+mod. EM), Perfect Shadow Style.
- **Pachinko Fever**: Idle Death Gamble (1 gratis/descanso) con los 3 ataques, tiradas de evento, duración, multiplicador y jackpot (3dX); Jackpot; Great Luck; The Fever (puntos como usos); Luckiest Sorcerer; Joint Bankruptcy.
- Automatizados a mano: 210/360. Sin probar en Foundry real.

## 1.48.0 — Técnica por técnica: Heart Catch → Limitless (7)
- **Heart Catch**: Love Hands (golpe con alcance 15/30 pies, agarre con ventaja), restricción de Handy, Hand Shield (+5 CA), Cutie Honey al impactar, dominio (apresado + encantado), Fine Line.
- **Ice Formation**: cono de hielo (1d10→6d10) con apresado y salvación de FUE cada turno; Extreme Cold (agotamiento/velocidad); Frost Calm; Ice Fall (ataque + púas DES 6d8+6d8, tú derribado); White Abyss; Heat Dissociation con agotamiento. Eliminada una actividad suelta con veneno.
- **Idle Transfiguration**: Transfiguration (1d10→5d10) y +1d6 al tocar; 5 autoalteraciones (2 CE); Soul Multiplicity (Body Repel escalable, Isomer); dominio 10d10; Object Transfiguration y Soul Splitting Weapon.
- **Illusive Mirage**: Cursed Illusion con rastreo y confusión; Phase Fist, Blurring y Disguise; Object Distortion; Illusive Terrain; House of Mirrors (redirección); Materialization.
- **Inverse**: activar/extender (cálculo de umbral y límite a mano), reacción rápida, Synesthesia (d4 de sentido), Power Inversion.
- **Laplace’s Demon**: Demonic Intellect (+INT a CA y DES), tiradas de presagio con usos, Overload, Imaginary Demon Brain, Laplace Threshold (−2 acumulable), Butterfly Effect, Chaos Theory.
- **Limitless**: Infinity con tirada d6 por reacción; Lapse Blue escalable con agarre; Teleportation; Offensive Infinity (repulsión y aplastamiento); Unlimited Void (INT/SAB/CAR = 1, inconsciente); Reversal Red escalable.
- Herramienta: limpia costes de CE de actividades borradas.
- Automatizados a mano: 184/360. Sin probar en Foundry real.

## 1.47.0 — Técnica por técnica: Explosive Flesh → Hair Manipulation (7)
- **Explosive Flesh**: 4 tamaños de parte del cuerpo con coste de CE + PG automático, radio, dado y derribo; explosión instantánea por reacción; ensordecido/cegado con OverTime; Living Bomb; dominio.
- **Fa Jin**: cargas de Jin como usos del objeto (máx. comp. + nivel), gastar cargas para +2 ataque o +1 dado; movimiento instantáneo; Explosive Power cono/línea escalable; Negative Jin (−3d6 al siguiente daño); Absorbing Power; dominio.
- **Faceless God**: aura de Madness Inducement, efectos de Mental Corruption (+5/10/25%) con tabla, tirada de paranoia, Madness Enhancement al impactar, Rumination escalable, dominio, Face of Wisdom.
- **Fate**: unir dos criaturas con 7 Fates elegibles (Bonds +2 CA, etc.); Cursed Eyes; Strong Destiny (Xd8 + derribo); Road of Karma; Freedom.
- **G Warstaff**: invocar y golpear con alcance; marcas de tinta al impactar; previsión de 1 s (desventaja contra ti) y 3 s (ventaja tuya); crítico de Predictable Strikes; dominio.
- **Golden Hour**: detener el tiempo (ventaja, enemigos fallan FUE/DES), Majestic Pose con turnos extra y tensión, Golden Week, Samsara Rewind, The World, Blue Hour (lentitud con OverTime), Leisure Time.
- **Hair Manipulation**: Scorpion Hair (+1→+4), Drill Hair y explosión (3d6→10d6), Helicopter/Jet con aspas (6d8→10d8) y embestida, Hair Spray, dominio, Doll Hairs.
- Automatizados a mano: 154/360. Sin probar en Foundry real.

## 1.46.0 — Técnica por técnica: Vermin, Divergent Fist, Dragon Vein, Earth, Eight Heads, Esoteric Art
- **Disaster Vermin**: enjambres e insectos con bolsa, fusión, huevo de Parthenogenesis, dominio (3 objetivos, 6d10), aura de Stillbirth Colony.
- **Divergent Fist**: Divergent Flow al impactar (daño diferido), desorientación con CON, Manji Kick (CD propia, aturdido hasta su turno), One-Two, Weave como reacción de esquivar, Stance of the Sparks.
- **Dragon Vein**: +comp. al daño cuerpo a cuerpo en el suelo; Ley Line (−comp. al daño recibido) y resistencia por reacción; Earth Dragon Soul (1d8→3d8); World Anchor (PG temp y resistencia total); Ascetic Void (vuelo, curación por turno, súper salvación DES a 11.º); dominio.
- **Earth Manipulation**: cubos de piedra, Rock Blast, Earthen Armor (+CA por CE), Tremor (3d10→6d10), Wall of Stone, Stone Arms con aplastamiento, dominio con grieta y púas, Disintegration/Mass Disintegration/Dustify.
- **Eight Heads**: Eight Lives con usos por descanso (3/4/8) y revivir a mitad de PG; Collective Will (8 usos); Fangs; barrera de Sacrifice con OverTime 10d4; dominio; Reverse Scale.
- **Esoteric Art**: Cursed Painting con mantenimiento, Impasto Canvas, Sgraffito (Ink Wave, lobo mayor, cuervo), Panoramic Composition, dominio, Artistic Vandalism (50 + 25/CE), Sfumato (desventaja mutua y 2×nivel necrótico por turno).
- Nuevo marcador `JJKORIGINLEVEL` (nivel del lanzador) en efectos.
- Automatizados a mano: 125/360. Sin probar en Foundry real.

## 1.45.0 — Técnica por técnica: Disaster Flames, Storms, Tides y Verdure
- **Disaster Flames**: cono de 15 pies (2d8→5d8); volcanes (2 CE c/u) y erupción en línea con Xd10 = competencia y apresado con salvación de FUE; Meteor 120 pies (10d4 + 10d6, derribo) con vuelo; dominio 10d8; Heat Extinguishment (reducción 6d8) e Hypothermic Touch encadenado.
- **Disaster Storms**: cono cortante/trueno; Lightning (3d6→8d6) con salto a 10 pies; Storm Creation con derribo OverTime y desventaja a distancia; Divine Storm Sovereign 3d10 por turno; dominio 6d12; Sunny Day (resistencia a fuego y PG temporales) y Sunshine (6d6→12d6).
- **Disaster Tides**: ataque de agua (2d8→5d8); 2 dominios gratis y Death Swarm; Water Defensive Ring (15×mod PG temp, inmunidad a frío, resistencia física) también como reacción; Flash Flood; Tsunami; Dehydration.
- **Disaster Verdure**: Binding Plants, Piercing Roots (1d12→4d12), Wall of Roots como reacción; Root Bundle con vuelo; Flower Field (encantado, ventaja contra él, termina al recibir daño); Cursed Buds con drenaje automático; dominio; Decay y Withering Plant encadenado.
- Nuevo marcador `JJKORIGINCEMOD` en OverTime: se sustituye por el mod. de EM del lanzador.
- Automatizados a mano: 102/360. Sin probar en Foundry real.

## 1.44.0 — Técnica por técnica: Dark Claw y Deadly Sentencing
- **Dark Claw**: formar garra (1 hora) y ataque de garra con EM y dado por nivel (1d6→2d8); Absorbing y Barbed Claws al impactar (sangrado OverTime 1d6/2d6); Brutal como efecto activable; Zenith (3–10 CE); dominio con golpe crítico en iniciativa 20 y garras que siempre impactan; Soft Beats Hard con parada (+2/+3/+4) y repetición por 2 CE.
- **Deadly Sentencing**: tres formas del mazo como ataques; dominio con tirada de Evidencia, Persuasión enfrentada, Confiscación, Espada del Verdugo y bloqueo de ataques; mazo agrandado y golpe de área; Better Evidence (mejor de 2/3); usos gratis de Unstopping Justice; Proven Innocence 20 CE.
- Automatizados a mano: 83/360. Sin probar en Foundry real.

## 1.43.0 — Técnica por técnica: Cursed Spirit Manipulation y Cursed Transmutation
- **Cursed Spirit Manipulation**: absorción a 120 pies, sacrificio de espíritu como reacción al recibir daño (Xd20), invocación como acción adicional, Uzumaki en cono 30 pies con +1d12 por espíritu extra, Womb Profusion sin coste de absorción, Annihilation con estado muerto.
- **Cursed Transmutation**: transmutación básica en cubos con CE escalable; Transmute Explosion al impactar (2d6→6d6); Harden/Shell/Slick como reacciones; Areal Transmute (resbaladizo, explosivo 4d6→8d6, púas); Railgun con empuje y derribo automático al impactar, impacto y línea de 4d12; dominio con resbaladizo global; Cursed Immutation con PG temporales.
- Automatizados a mano: 75/360. Sin probar en Foundry real.

## 1.42.0 — Técnica por técnica: Cursed Corpse Creation
- **Cursed Corpse Creation**: acción de imbuir núcleo a un objetivo.
- **Corpse Tactics**: 5 tácticas como actividades sin coste (ventaja, +1 dado de daño, esquivar, retirada, carrera) hasta tu siguiente turno.
- **Cursed Corpse Mutation**: tiradas d20 y d12 de la tabla; quitado el efecto +3 CA suelto.
- **Perfect Creations / Prized Creation**: comando global y nota de aplicación.
- Automatizados a mano: 67/360. Sin probar en Foundry real.

## 1.41.0 — Técnica por técnica: Cursed Circuitry
- **Circuit / High Performance Circuit**: el módulo ahora rebaja el coste de CE del resto de rasgos mientras el circuito está activo (−1 o −3, mínimo 1); con **Pure Energy Efficiency** además se ahorra 1 CE por cada 5.
- Circuito en objetos: +2d4 necrótico (alto rendimiento: +2d6/2d10 y +3/+5 CA).
- **Circuit Breaker**: el siguiente golpe hace +5d10 necrótico.
- **Deus ex Machina**: circuito permanente en el dominio y drenaje de CE en iniciativa 20.
- **Open Circuit**: salvación de EM; 1 hora de daño por CE gastado.
- Automatizados a mano: 64/360. Sin probar en Foundry real.

## 1.40.0 — Técnica por técnica: Cursed Cannon
- **Granite Blast**: CE extra limitado a tu mod. de EM; disparo dividido de Grape Choux (+1 CE).
- **Dessert Deluge**: acciones +1 a +5 al siguiente ataque de EM (1–5 CE).
- **Granita Lusso**: línea de 60×10 pies, doble daño de Granite Blast (10d10/12d12 + 2×mod.), mitad al salvar, y Burnout automático hasta tu siguiente turno.
- **Il Gran Dolce**: Granite Blast gratis contra 3 objetivos en iniciativa 20.
- **Cursed Shield**: reacción ofrecida por Midi al ser atacado o al salvar (CD 10 + mitad del CE entrante).
- Automatizados a mano: 59/360. Sin probar en Foundry real.

## 1.39.0 — Técnica por técnica: Contractual Recreation
- **Recreation**: una acción por tamaño de recibo (2/4/6/8/10/20 CE) con el daño al caer sobre una criatura (2d6 por tamaño sobre Diminuto; derribado y apresado si es Enorme o mayor), reserva (4 CE) y estructura (20 CE).
- **Contractual Control**: carga de vehículo en línea de 60 pies, arma telequinética (5/7/10 dados por nivel) y mover objetos.
- **Black Friday**: recibo aleatorio (d4) en iniciativa 20.
- **Contractual Transformation**: acciones por tamaño.
- Automatizados a mano: 56/360. Sin probar en Foundry real.

## 1.38.0 — Técnica por técnica: Construction
- **Construct** y **Cursed Creation**: CE extra escalable (propiedades/tamaño; +2 por grado).
- **Liquid Metal**: 1–4 CE extra, alcance y dado mayor durante 1 minuto.
- **Insectoid Armor**: +4 FUE/DES/CA, resistencia física no mágica, vuelo = velocidad a pie, 1 hora.
- **Threefold Affliction**: crear objetos gratis en el dominio.
- **Deconstruction**: acciones por tamaño (1/2/4/8 CE) y prueba de EM para objetos mágicos (10 CE).
- Automatizados a mano: 52/360. Sin probar en Foundry real.

## 1.37.0 — Técnica por técnica: Comedian
- **Comedy**: activar (concentración, Interpretación); reacción *Gag dodge* (1 CE) al recibir daño anula ese golpe; recuperar el control con SAB CD 15.
- **Commit to the Bit**: Blasting Off, Props y Powerful Punchline ((competencia + mod. EM)d8 con salvación y tipo a elegir).
- **Peak Comedy**: efecto de 1 minuto, dados extra de Punchline (2 CE) y Cutaway (SAB).
- **Stand Up Comedy**: cutaway en iniciativa 20, abucheo 8d8 psíquico y chiste (Persuasión).
- **Straight Man**: inmunidad a asustado y hechizado en 20 pies; **Deadpan**: reacción 2d8 psíquico con salvación de EM.
- Automatizados a mano: 47/360. Sin probar en Foundry real.

## 1.36.0 — Técnica por técnica: Clone
- **Divide and Conquer**: el clon gratis (acción adicional) y el clon extra de iniciativa 20 crean tokens reales como One Man Army.
- **Four is a Party**: intercambio de cuerpo con un clon (1 CE).
- **Object Cloning**: cuatro acciones según el objeto (4/6/8/10 CE; +2 CE por tamaño sobre Mediano).
- One Man Army y Twice the Fun ya creaban clones (sin cambios).
- Automatizados a mano: 44/360. Sin probar en Foundry real.

## 1.35.0 — Técnica por técnica: Body Manipulation y Centipede Shroud
- **Graverobber**: transferencia durante descanso largo (1 CE), prueba de Perspicacia CD 30 para descubrirte.
- **Brain Manipulation**: 8d8 psíquico y disrupción neural 1 minuto con CON repetida al final de su turno.
- **Cursed Centipede**: el escudo da +1d10 en golpes cuerpo a cuerpo y +competencia a la CA.
- **Earthquake**: radio de 30 pies, mitad al salvar, escala 6d6/10d6/14d6; versión acción adicional con el ciempiés invocado.
- **Hundred Leg Catastrophe**: ahora son ataques a distancia (hasta 3) de 8d10; al impactar Midi tira la FUE para empujar/atraer y derribar.
- **Oomukade Banzai**: apresados con prueba de FUE al inicio de su turno.
- **Millipede Spear**: invocar da +2d10 en golpes y −competencia a la CA.
- Automatizados a mano: 40/360. Sin probar en Foundry real.

## 1.34.0 — Técnica por técnica: Blazing Courage
- **Ignition**: acciones de 1 a 6 CE; el arma cuerpo a cuerpo hace +N dados de fuego (d6/d8/d10/d12 por nivel) durante 1 minuto.
- **Mantle of Courage**: resistencia a fuego y frío; *burn* aplica a enemigos la salvación de CON con los dados de Ignition.
- **Conflagration**: cono de 30 pies, mitad al salvar, quemaduras severas (+competencia al daño de fuego) si fallan por 5+.
- **Fire of the Heart**: en iniciativa 20 el daño del Mantle a quien elijas.
- **Freezing Resolve / Mantle of Resolve**: versión de hielo (frío, velocidad 0 al fallar).
- Automatizados a mano: 35/360. Sin probar en Foundry real.

## 1.33.0 — Técnica por técnica: Cursed Speech
- **Power of Words**: cada palabra es su propia acción con su CE y CE extra: Sleep, Return, Run Away, Blast Away (6d8 +1d8/CE), Plummet ((mod)d10, derribado 1 min con FUE), Get Twisted, Get Crushed (paralizado, FUE), Don't Move (aturdido, CON), Explode (3d8 fuerza + (mod)d6 fuego en 5 pies) y Die.
- **Echo Chamber**: en iniciativa 20 una palabra gratis a todos.
- **Cursed Silence**: Silence (2 CE) y Cursed Silence (8 CE, concentración).
- Automatizados a mano: 31/360. Sin probar en Foundry real.

## 1.32.0 — Técnica por técnica: Boogie Woogie
- **Boogie**: alcance 30 pies, 1 objetivo (el intercambio lo hace el módulo).
- **Woogie**: acción para que el enemigo intercambiado pierda su reacción hasta tu turno.
- **Clap Back**: Boogie como acción libre por 1 CE a 45 pies (intercambio real).
- **Standing Ovation**: Boogie gratis e ilimitado a 175 pies dentro del dominio.
- **Slow Dance**: aturdidos (tú y dos más) hasta tu siguiente turno, salvación de EM al final de sus turnos; variantes acción adicional y reacción.
- Automatizados a mano: 28/360 spells. Sin probar en Foundry real.

## 1.31.0 — Técnica por técnica: Blood Manipulation
- Las técnicas de sangre ahora descuentan también sus **PG** (se puede desmarcar en el diálogo si usas otra
  fuente de sangre).
- **Blood Techniques**: cada técnica es su propia acción con su coste: Crimson Binding (apresado, repite FUE al
  inicio de su turno), Slicing Exorcism (ataque 1d10 + mod.), Blood Edge, Crimson Rain (3d10, 15 pies), Blood Burst
  (4d6 al impactar), Blood Meteorite (ataque 4d4 + mod.) y Blood Geyser (5d10). Antes Crimson Binding hacía el daño
  de Slicing Exorcism y Crimson Rain derribaba siempre.
- **Flowing Red Scale**: ventaja en salvaciones de DES y pruebas de FUE; se quitó el viejo efecto manual que
  duplicaba el +2 CA.
- **Convergence**: cargar da con Midi un bono opcional de +competencia dados de daño en tu siguiente técnica;
  versión rápida con CE.
- **Piercing Blood**: línea de 100 pies (5 PG) y barrido en cono de 130 pies.
- **Bloodbath**: 4d12 necrótico en iniciativa 20 a las criaturas que elijas.
- **Blood Puppet**: incapacitado mientras dure tu concentración, repite CON al inicio de su turno; orden como
  acción adicional.
- Automatizados a mano: 25/360 spells. Sin probar en Foundry real con Midi-QOL.

## 1.30.0 — Técnica por técnica: Black Box
- **Dark Cube**: cubo de 10 pies a 30 pies; salvación de DES o queda atrapado (cegado sin luz). El CE extra son
  los refuerzos (hasta tu mod. de EM). La descripción del efecto da CA/PG del cubo.
- **Perfect Cube**: nota de reglas (el cubo resiste todo daño; cuenta como 5 refuerzos).
- **Midnight Armor**: ya no es una tirada de daño. Da PG temporales = competencia × 2 × mod. EM (+10 por CE extra),
  CA = CD de EM + 5 durante 1 minuto, y un golpe desarmado 3d8 + mod. necrótico.
- **Primordial Gap**: en iniciativa 20 atrapa hasta 3 criaturas en Perfect Cubes (salvación de DES).
- **Glass Box**: acción (4 CE) o reacción (6 CE) atrapa con salvación de DES; nueva acción *Shatter*:
  (mod. EM + competencia)d8 cortante en 5 pies, mitad al salvar.
- **Glass Weakening**: estaba roto (daño vacío); ahora suma mod. de EM cortante por cada debilitamiento (2 CE).
- Automatizados a mano: 19/360 spells. Sin probar en Foundry real con Midi-QOL.

## 1.29.0 — Técnica por técnica: Auspicious Beast Summon y Black Bird Manipulation
- **Kaichi**: invocar cuesta 1 CE (1 minuto) y el cuerno ataca gratis como ataque extra (1d6 → 3d6 por nivel).
- **Reiki**: acción adicional duplica tu movimiento; reacción +5 CA al ser impactado (Midi la ofrece).
- **Kirin**: 5 PG temporales por CE y movimiento 0 hasta tu siguiente turno.
- **Ryu**: 8d10 perforante (FUE) a una criatura a 30 pies y efecto de Ryu invocado (10 minutos).
- **Auspicious Beasts' Realm**: en iniciativa 20 Kirin se recarga (5 × mod. EM PG temporales).
- **Inauspicious Beast Banishment**: salvación de EM en 60 pies; al fallar, sus invocaciones se deshacen.
- **Cursed Crows**: ver a través de un cuervo te deja cegado hasta que lo terminas.
- **Omen of Death**: asustado 1 minuto con salvación repetida (Midi) y ventaja en ataques contra asustados.
- **Raven's Eye**: +1 a Percepción pasiva por cuervo (flag `jjk5e.crows`).
- **Bird Strike**: mitad al salvar; al fallar, Midi tira el d6 de la extremidad dañada.
- **Black Mahakala**: en iniciativa 20, Bird Strike gratis a hasta 3 objetivos.
- **White Bird Manipulation**: sacrificar paloma cura 1d8 por CE (hasta 2 × mod. EM); protección de paloma.
- Automatizados a mano: 15/360 spells. Sin probar en Foundry real con Midi-QOL.

## 1.28.0 — Técnica por técnica: Antigravity System
- **Antigravity**: salvación de DES en cilindro de 10 pies (eliges a quién excluir, Focused System). Al fallar
  aplica *Lifted* hasta el inicio de tu siguiente turno. Con Midi-QOL, si tienes **Gravity Field** los afectados
  tiran automáticamente la salvación de CON de *Disorienting Gravity* (desventaja en ataques). Si además tienes
  **Boosted System**, fallarla también los aturde hasta el final de su siguiente turno (*Nauseating Gravity*).
  Nueva acción *Fall damage* que escala con el nivel (3d6 → 5d8 → 5d10 → 10d12 → 20d12).
- **Gravity Field**: *Light Fall* como reacción (1 CE) para ti y hasta tu bonificador de competencia en criaturas.
- **Antigravity Shield**: reacción al ser atacado (Midi la ofrece). Desventaja a los atacantes y reduce el daño no
  psíquico en tu mod. de EM + nivel hasta tu siguiente turno.
- **Boosted System**: *Lasting Field* gasta EM extra (+10 pies y +1 asalto por EM).
- **Zero Gravity**: en iniciativa 20 aplica Antigravity a las criaturas que elijas y fallan sus salvaciones.
- **Gravity System** (reversión): derribado y apresado al fallar, sus ataques cuerpo a cuerpo fallan; desventaja
  cuerpo a cuerpo dentro del área; daño escala 10d10 → 25d10; reacción ofrecida por Midi.
- Herramienta `tools/technique-fixes.py` para automatizar técnica por técnica; la auditoría cuenta las técnicas
  automatizadas a mano (5/360 spells).
- Sin probar en Foundry real con Midi-QOL.

## 1.27.0 — Hoja de personaje y técnicas innatas
- Reorganiza el panel JJK de la hoja y separa el contador de energía maldita.
- One Man Army y Twice the Fun crean copias en escena. Twice the Fun permite gastar 3 CE por copia e incorpora la ventaja de ataque cuerpo a cuerpo junto a un clon mediante Midi-QOL.
- Piercing Blood incorpora el daño del barrido de Convergence. Divine Flame Open incorpora el área y el daño por CE. Resonating Music incorpora daño y sordera, y Blood Spit incorpora ceguera.
- Validación local de sintaxis, reglas e integridad del compendio. La cobertura de los 360 spells es parcial. El uso en una sesión real de Foundry con Midi-QOL y el aspecto de la hoja siguen pendientes de validación.

## 1.26.0 — Combat dependencies and table usability
- Foundry now declares Midi-QOL and DAE as required combat dependencies. Visual integrations remain recommended. The GM receives an activation warning if either combat module is inactive.
- Check Boogie's target, ownership and horizontal range before charging CE. A GM can perform swaps involving other players' tokens.
- Domain detection considers overlapping barriers in the same scene, including already engaged opponents. Closing a domain removes its references from surviving participants.
- Release builds run syntax, regression and compendium audit checks before packaging.
- Verification covers automated checks. Live multiplayer play, interrupted swaps, and redistribution of clash roles after a leader leaves remain unverified.

## 1.25.0 — Multi-domain clashes and executable Boogie Woogie
- Replaced the former three-or-more-domain GM-only warning with deterministic V.6 clash tracking for every participating domain. Tied leaders remain tied; each weaker domain receives its own countdown and shrinks each round while sure-hit effects remain disabled.
- Added a pure multi-domain resolver and regression coverage for unique and tied leaders.
- Boogie Woogie now exposes its action, bonus-action and reaction variants at the documented CE costs (1/1/3) and executes a real same-scene token-position swap after a successful use.
- Token swaps use the privileged-operation gate, validate the source token against the actor and never let a player move a token they do not own without explicit GM approval.
- Extended the per-spell audit so declarative runtime mechanics such as swaps count as configured mechanics while remaining explicitly unverified in live Foundry.

### Validation boundary
- Static JSON/source parity, JavaScript syntax and Node regression tests pass locally.
- The official Foundry pack compiler is exercised by GitHub Actions; it could not be run locally because npm is unavailable in this workstation image.
- No claim is made that all 360 spells have been functionally tested in Foundry V14. The audit still distinguishes native/declarative mechanics from unresolved utility, save, attack and domain behavior.

## 1.24.1 — Review of 1.23/1.24
- Fixed: while a domain was open, every activity of the domain item was blocked, including the domain's own in-domain activities. Only the "Expand Domain" activity is blocked now.
- Fixed: strict feat prerequisites blocked feats gained during level-up when their prerequisite feature arrived in the same level. Advancement now only warns.
- Fixed: a Black Flash pending from an older version (no linked activity) was never applied.

## 1.24.0 — Innate spell coverage audit and first mechanical corrections
- Audited the full library (586 innate-technique records; 360 spells in 81 named technique groups) with a reproducible static audit script and a [per-spell inventory](docs/INNATE_SPELL_AUDIT.md).
- Added source vs fallback consistency checks, activity/effect/CE reference validation and a CI gate to catch stale spell coverage reports.
- Corrected a core issue: Cursed Energy is now charged before activating domain side effects or tagged self-buffs. An unaffordable activity cannot apply these benefits.
- Added explicit mechanical ActiveEffects for the AC bonus and walking-speed multiplier of **Flowing Red Scale** and **Golden Week** (with expiration). Their extra-action and conditional advantage restrictions remain GM-managed; they are NOT fully automated.
- Fixed the action economy of **Cursed Centipede** (bonus-action summon) and **Major Star Shikigami** (action summon); note these skills still require a valid summon actor/profile and manual shikigami management.
- **Collective Will** now tracks eight long-rest uses, costs 1 CE and provides a d20 replacement roll. Applying the replacement to the triggering roll remains a player/GM action.
- **Manji Kick** now attaches the Stunned condition on a failed save. Multiplying its originating unarmed strike damage still requires manual adjudication.
- **Unrelenting Fury** now rolls the base saving-throw damage and applies Prone on failure; extra attacks and optional CE-powered damage require selection and review by the GM.
- Added regression tests for these high-confidence rule mappings and the 360-spell inventory.

### Coverage and remaining work (NOT a full certification)
- 124 spells have a mechanical activity configuration and no obvious static warning, but gameplay correctness is **not verified**.
- 114 utility-only spells have no embedded effects and need individual design reviews (some may be passive or narrative rather than broken).
- 18 utility-only spells include effects that require activation verification.
- 57 domain spells use generic domain behavior whose unique effects are not fully automated.
- 35 spells have a save with no configured damage or effect; 12 have attack activities with no own damage.
- A full verification still needs manual-by-manual semantic checks and live Foundry V14, D&D5e 6.1 and optional Midi-QOL testing of each of the 360 spells. This release does not claim that all spells work automatically.


## 1.23.0 — V6 audit hardening (partial remediation)
- Security: player-sent privileged GM socket operations disabled by default. Optional GM approval with action allowlist; client-reported identity remains untrusted.
- CE: reject unaffordable costs; validate scaling before activity consumption; serialize same-client CE updates; prevent vow-prohibited spending.
- Six Eyes: implement the next-CE 90% discount and permanent Awakened discount. Store fractional CE separately because D&D5e 6.1 item-use counters require integers.
- Black Flash: use the second d20's natural face; link pending triple-critical dice to the originating activity; restore the RCT healing pool when The Zone is gained.
- Short rests: recover 1 CE per actually expended class Hit Die (maximum half total hit dice). Manual confirmation required.
- Binding vows: block CE and innate-technique activities while the corresponding penalty applies; track and expire the ten-day exhaustion punishment on world-time updates.
- Domains: constrain sure-hit to inside eligible targets with Midi-QOL; permit lethal/non-lethal status via domain HUD; avoid falsely resolving 3+ domain clashes as a two-person duel.
- Requirements: configurable strict feat prerequisite enforcement for players; confirm a change of innate technique and remove old technique items.
- Maximum Output: enforce CE score >= 20 and reject unaffordable bonus costs (benefit modifiers still require manual handling).
- Content corrections (also synced to JSON fallback data): Creeps and Curses Overgeneration fixed DC 20 / 60 ft charm without incapacitation; Cursed Lover Dormant summoning is an action; Vengeful Spirit Partial Manifestation uses an additional attack in the Attack action.
- Quality: a pure mechanics helper module, Node regression tests, GitHub Actions JSON/syntax validation, and compendium build smoke test.

IMPORTANT — KNOWN LIMITATIONS IN 1.23.0
- This release is a limited, auditable corrective update, NOT a full-rule automation or validation of all 1,401 compendium entries.
- Full Maximum Output benefits, Reduced Output die/area/duration effects, GM-guided outside-domain displacement, 3+ domain clash automation, all unique cursed techniques, and remaining Creeps and Curses special rules are still pending.
- The safe multi-clash behavior is to stop automatic resolution and ask the GM; it is not automated yet.
- Per-client CE serialization is not cross-client atomicity. Multiplayer concurrency and Foundry UI integration still require in-world tests.
- Foundry 14 / D&D5e 6.1 / Midi-QOL actual gameplay testing has not been performed in this CI environment.
- With D&D5e's integer UsesField, the item-use UI may display rounded CE; the module tracks fractional spending in flags and its own CE display.
- The module still uses a prototype override for spell-slot behavior and has not been fully refactored.


## 1.22.2
- Fixed: techniques that spend extra Cursed Energy ("1+ CE") asked for spell slots instead of the extra CE, so the
  extra damage could not be chosen. Technique spells no longer use spell slots at all.
- Fixed: 186 technique and feat activities that target other creatures had range "self" (Midi-QOL targeted the
  caster); their range now comes from the text.
- Fixed techniques: Granite Blast (damage was missing), Tides of Disaster, Nail Projectile and Dismantle (now attack
  rolls), Lapse Blue (damage, area and CE cost), Wing King lines of blood, Railgun, Sound Amplification, Rotten Blood
  Beam and Cleave (attack roll first, then the save; with Midi-QOL the save follows the hit automatically),
  Aircraft Hair, Hypothermic Touch, Wing King Imitation, Cursed Strike.
- Added missing rolls: Unrelenting Ring of Spirit and Cursed Soul Armory initiative 20 damage, Manji Kick save,
  Womb Profusion absorb save.

## 1.22.1
- Fixed: technique feats with the same name in two techniques (Blood Production, Shooting Star, Shadow User) were
  shown for the wrong technique.
- Fixed: duplicated feats (Tavern Brawler) appeared twice in the level-up feat list.
- Fixed: with several GMs connected, world automation (effect expiry, domain clashes, RCT pool regeneration, vows at
  the end of combat, first-load setup) ran once per GM.
- Fixed: an effect deleted by two clients or modules at once (Foundry 14 expiry, DAE, Midi) raised a permanent
  error popup.
- Midi-QOL: domain sure-hit is now decided inside Midi's per-target hit check, so the hit card and reactions agree.
- Default shortcuts changed to avoid browser menus: spend CE Alt+G (was Alt+E), domain HUD Alt+B (was Alt+D).

## 1.22.0
- Recommended modules updated for Foundry 14 / dnd5e 6.1: Midi-QOL 14.7.0+, DAE 14.6.0+, Sequencer 4+, JB2A,
  Automated Animations, Token Magic FX, FXMaster 8+, Dice So Nice, Visual Active Effects, Bar Brawl, Token Action HUD.
- Token Magic FX: red glow while in the Zone (Black Flash), purple glow while your domain is open (setting).
- FXMaster: the scene is tinted purple while a domain expansion is open, removed when it closes (setting).
- Visual Active Effects: buttons on JJK effects (close domain, domain HUD, binding vows, short rest CE).
- Automated Animations: JJK animations are skipped for items that Automated Animations recognises by name, so the
  same use is never animated twice.
- OverTime save DC placeholder made safe with DAE's value evaluation.

## 1.21.0
- Midi-QOL integration (optional, Midi-QOL 14.7.0+ for dnd5e 6.1):
  - Black Flash is checked inside Midi's workflow, after the attack roll and before damage, so its triple-dice
    damage and resistance bypass apply with Midi's automatic damage.
  - JJK reaction abilities have Midi reaction conditions: those used when you take damage, are attacked, are hit or
    make/fail a saving throw are offered automatically; the rest stay manual.
  - Conditions from techniques that allow a repeat saving throw (frightened, charmed, blinded, restrained…) get a Midi
    OverTime save at the end of each turn, with the caster's save DC.

## 1.20.0
- Character sheet: the JJK bar (CE, grade, vows, tools) moved into the sidebar card and its buttons now work in play mode.
- New character creation guide (button on sheets without a class, macro and JJK menu): ability scores → class and
  Innate Technique → race → background.
- Level-up Ability Score Improvement: explicit choice between *Improve ability scores* and *Take a feat*.
- Technique feats only show those of your Innate Technique (background feat choice and level-up feat list).
- Human (Superhuman): the racial bonus (+2 and +1/+1) can go to any ability.
- Human (Jujutsu Sorcerer): *Trained Cursed Energy* now lets you choose a Cursed Energy feat.
- Shikigami: *Customize shikigami* (macro and JJK menu) makes your own editable copy that your technique summons.
  Module updates no longer overwrite the shikigami actors in the world.

## 1.19.0
- Compendiums now ship inside the module (`packs/`), built from JSON sources with the official Foundry CLI.
  No more world import for English data; they load instantly and update with the module.
- Packs declare their dnd5e item types and the **JJK5e** source book, grouped in a *JJK 5e V.6* compendium folder.
- Updating from older versions: characters are re-linked from the old world compendiums to the module ones, and the
  GM is offered to delete the old copies.
- Spanish data still uses translated world copies (built-in translation planned).
- Versioned GitHub releases with this changelog.

## 1.18.1
- Bug fixes after an error sweep against dnd5e 6.1.

## 1.18.0
- Cursed Technique Reversals (granted automatically with the feat) and Mahoraga adaptation examples.

## 1.17.0
- Full manual review: breakthroughs, RCT awakening and pools, Black Flash ignores resistance, missing feats and rules.

## 1.16.0
- Feat audit: prerequisites, refinement and profane-point budgets.

## 1.15.0
- Innate Technique audit: levels, costs and effects for all techniques.

## 1.14.0
- Class and race audit; Heavenly Restriction ability maximums.

## 1.13.0
- Fixes for dnd5e 6 / Foundry 14; keybindings and token HUD button; recommended modules.

## 1.12.0
- Domain expansions with scene regions, barriers, clashes and the Domain HUD; curse generator; Dice So Nice colours.

## 1.11.0
- Binding vows, sorcerer career and grade promotion, missions, sheet strip, hotbar and turn summary.

## 1.10.0
- Bilingual rules manual (English + Spanish) and Spanish compendium names and descriptions.
