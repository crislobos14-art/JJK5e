## 00 — Guía del módulo JJK5e

Esta guía explica qué hace el módulo por ti, qué tienes que aplicar a mano y dónde está cada botón. Las reglas completas están en los capítulos del manual V.6 de este mismo compendio.

### Inicio rápido

**Jugadores**

- Abre tu ficha: arriba verás el medidor de **Energía maldita (EM)** junto a los PG y los dados de golpe.
- Pulsa la pestaña **JJK** (yin-yang) para ver tu técnica, tus dominios, tus votos y tu carrera. **Volver a la ficha** te devuelve a la pestaña nativa.
- Usa tus técnicas como cualquier actividad de dnd5e: el módulo cobra la EM, aplica los descuentos y avisa si no te alcanza.
- El botón **Controles JJK** (abajo a la derecha) abre los avisos y la consulta rápida.

**DJ**

- Instala y activa **Midi-QOL**, **DAE**, **Sequencer** y, si quieres ambiente de escena, **FXMaster**. El módulo avisa al iniciar si falta alguno.
- Las cosas que cambian a varios personajes a la vez (choques de dominio, golpes de expansión) las resuelve el DJ activo.
- Si algo quedó colgado en el mapa, ejecuta en una macro: `game.modules.get("jjk5e").api.cleanupDomains()`.

### La ficha y la pestaña JJK

- **Medidor de EM:** pulsa la barra para escribir un valor; los botones − y + gastan o recuperan 1.
- **Sellos:** cada técnica, dominio, voto, clase u objeto JJK lleva un sello junto al nombre. El color y el icono indican la familia; el dibujo, el giro y los anillos distinguen un objeto de otro. Los dominios son redondos, los votos en rombo y Heavenly Restriction en octágono.
- **Pestaña JJK:** técnica innata, estado del dominio, votos, carrera del hechicero y atajos. En pantallas estrechas pasa a una sola columna.

### Energía maldita

| Qué | Cómo funciona en el módulo |
|---|---|
| Gasto de técnicas | Automático al usar la actividad. Si no tienes EM suficiente, la acción se cancela. |
| Cursed Strike | Eliges cuánta EM gastar (hasta tu BC); suma d6, d8, d12 o 2d8 necróticos según tu dominio de la EM. |
| Descanso corto | Botón en el panel: cambias dados de golpe por EM (hasta la mitad de tus DG). |
| Emoción negativa | Lo pides desde el panel y el DJ lo confirma: recuperas tu BC en EM. |
| Máxima potencia | Botón **Máxima potencia** (puntuación de EM 20). Si lo usas dos veces en la misma ronda, tirada CD 15 +2 por nivel o subes Reduced Output. |
| Reduced Output | Baja 1 nivel por cada minuto sin gastar EM y con cada Black Flash. |
| RCT | Reserva de curación; recupera 10 PG cada dos rondas y se llena con The Zone. |
| Black Flash | Tras un crítico, el módulo tira el segundo d20: con un 20 natural, daño ×3 que ignora resistencias. Activa The Zone. |
| The Zone | Ventaja, +1 al crítico y al Black Flash; quita el burnout y −1 Reduced Output. |

### Dominios

- **Abrir:** usa la actividad del dominio. Cuesta 20 EM (menos con refinamiento 700 y 1000). Se abre con turno completo, con una acción a partir de 200 y con una acción adicional a partir de 1000.
- **En el mapa:** el alcance de las reglas sigue en pies (175 ft; 655 ft sin barrera; 100 ft el incompleto). La zona dibujada nunca sale del mapa.
- **Tarjeta de apertura:** PG, CA, refinamiento y alcance. El DJ marca a las criaturas que no quedaron atrapadas y pulsa **Golpe de expansión**: Xd6 contundente y empuje hasta el borde.
- **Impacto garantizado:** solo contra objetivos elegidos dentro del dominio. Simple Domain lo absorbe.
- **Panel de dominio (HUD):** cerrar, cambiar a no letal, invertir o equilibrar la barrera, amplificación (600) y asistente de dominio propio (DJ).
- **Botones del panel JJK:** Expansión de 0,2 s (400), Comprimir dominio (900), Entrenar refinamiento, Diario de refinamiento, Atacar la barrera y Abrir punto débil.
- **Al cerrar:** Technique Burnout durante 1 minuto (5 rondas el incompleto) y 2 niveles de agotamiento (1 a partir de 700). Black Flash o The Zone lo terminan antes.

### Choques de dominio

- Cuando alguien abre un dominio, quien pueda responder recibe un aviso para abrir el suyo como reacción.
- Gana quien tiene más refinamiento. Con 10 a 90 puntos de diferencia, el perdedor se rompe en 9 a 1 rondas y encoge 15 ft por ronda; con 100 o más, se rompe al instante.
- **Empate:** ambos se mantienen. A 1/3 de PG, tirada CD 15 sin modificadores o el dominio cae.
- Mientras dura el choque, el mapa muestra en rojo el área compartida y el impacto garantizado queda suspendido en ambos.
- Ganar un choque da +100 de refinamiento (una vez al mes y nunca dos veces contra el mismo rival).

### Refinamiento

| Refinamiento | Beneficio | En el módulo |
|---|---|---|
| 100 | Barrera invertida o equilibrada (+5 EM) | Botones en el HUD |
| 200 | Expansión con una acción | Automático |
| 300 | Potencia aumentada | Dados extra automáticos |
| 400 | Expansión de 0,2 s | Botón en el panel |
| 500 | Dominio de 2 minutos | Automático |
| 600 | Amplificación de dominio | Botón en el HUD |
| 700 | −mod de EM al coste y 1 nivel de agotamiento | Automático |
| 750 + RCT | Recuperar el burnout | Botón en el panel |
| 800 | Barrera duradera (PG ×2) | PG automáticos; inmunidad a daño no mágico a mano |
| 900 | Compresión | Botón en el panel; desventaja automática |
| 1000 | Total Mastery, dominio sin barrera | Automático; cambios de acción de las técnicas a mano |

Se gana refinamiento entrenando (una vez al día), con víctimas dentro del dominio (+20) y ganando choques (+100). Todo queda en el **Diario de refinamiento**.

### Votos vinculantes

- Botón **Votos vinculantes** en el panel. Plantillas o voto propio, con restricción, beneficio y bloqueo hasta el descanso largo.
- El módulo avisa si superas tu límite (tu BC).
- Al romper un voto mutuo eliges: 5 niveles de agotamiento durante 10 días o una tirada en la tabla de desgracias.

### Avisos

- Avisos emergentes para PG a 0, EM baja, burnout, The Zone, dominios, nivel de salida, RCT, turno y descanso pendiente.
- Se ven 3 como máximo; se pausan al pasar el ratón y se cierran con la ×.
- En **Configuración del módulo** cada jugador puede activar el centro de notificaciones, el sonido de los urgentes y el historial, y ajustar el umbral de EM baja.

### Qué se aplica a mano

- Quién puede reaccionar a una expansión de 0,2 s, si el DJ no usa el aviso del módulo.
- La inmunidad de la barrera duradera (800) al daño no mágico.
- Los cambios de tipo de acción de las técnicas con Total Mastery (1000).
- La tirada de Reduced Output si sigue activa una técnica con máxima potencia.
- Las desgracias de la tabla de votos que no son efectos (perder un sentido, una extremidad…).

### Sonido, efectos y fondos

- **Sonidos:** cada una de las 81 técnicas tiene su propio sonido al usarse. Los impactos suenan según la familia de la técnica, y hay sonidos propios para dominio, choque, Black Flash, The Zone y burnout. Cada jugador los activa y ajusta su volumen en sus ajustes.
- **Efectos:** cada técnica dibuja un sello de tinta de su color al usarse. Sin JB2A, el módulo dibuja también sus propios impactos. Necesita Sequencer.
- **Fondos de dominio:** al abrirse un dominio, su barrera se rellena con el fondo de su técnica. El dueño puede elegir otro, o ninguno, con el botón «Fondo de dominio» del panel JJK.
- **Registro de combate:** bajo cada nombre aparece una barra fina de EM. Muestra también el nivel de Reduced Output, el burnout y The Zone. El DJ elige quién ve la EM de quién.
- **Recursos de técnica:** las técnicas con cargas, puntos o listas propias los muestran en la pestaña de combate del panel JJK. Por ejemplo, Fa Jin, Cursed Speech, Miracle o Ten Shadows. El módulo aplica los descansos, el fin del combate y el inicio de turno.

### Para el DJ

- **Ajustes de refinamiento y avances:** panel JJK del actor, sección del DJ. Los cambios quedan en el diario.
- **Peticiones de jugadores:** atacar barreras, abrir puntos débiles o recuperar EM por emoción negativa llegan como confirmación al DJ.
- **Limpieza:** al iniciar la partida y al cerrar cada dominio, el módulo borra zonas, tintes, marcadores y animaciones de dominios ya cerrados.
- **Tutorial:** se muestra la primera vez. Para verlo de nuevo, en una macro: `game.modules.get("jjk5e").api.showTutorial()`.
